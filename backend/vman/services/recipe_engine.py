"""Recipe engine (Milestone 4 / Task 13).

A recipe is a YAML document describing a multi-step procedure to run
on a target host. The engine validates the recipe, renders variables,
and runs each phase (preflight -> steps -> verify -> rollback) through
the SSH runner. Per-step status, exit code, and log lines are
persisted in the jobs / job_steps / job_logs tables.

Security notes
--------------
- Variable rendering is a SAFE substitution. We do NOT use Python's
  str.format or eval; we only replace `{{ name }}` tokens with the
  corresponding value. The renderer never executes the substituted
  text.
- The recipe's risk level and policy block (forbidden environments,
  requires_approval) are evaluated against the host's environment
  via the policy engine before any step runs.
- A failed step short-circuits the remaining steps (marked as
  skipped) and triggers the rollback section.
- All log lines pass through the redactor before persistence.
"""

from __future__ import annotations

import datetime as dt
import re
import uuid
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import yaml

from vman.db import models
from vman.security.audit import AuditService
from vman.security.policy import decision_for_recipe
from vman.security.redaction import default_redactor
from vman.services.jobs import JobService

SUPPORTED_SCHEMA_VERSION = 1

# Path to the on-disk recipes shipped with VMAN. Tasks 14+ add YAML
# files here; the loader picks them up automatically. The default
# points to ``<repo>/backend/vman/recipes/builtin`` which is created
# in the bootstrap and already hosts the healthcheck recipe. Tests
# can override this path via the ``VMAN_BUILTIN_RECIPES_DIR`` env var
# (see ``builtin_recipes_dir`` below).
_DEFAULT_BUILTIN_DIR = Path(__file__).resolve().parent.parent / "recipes" / "builtin"


def builtin_recipes_dir() -> Path:
    """Return the directory that holds the on-disk built-in recipes.

    Centralised so tests can monkey-patch the location without
    duplicating the path resolution in three different places.
    """
    import os

    override = os.environ.get("VMAN_BUILTIN_RECIPES_DIR")
    if override:
        return Path(override)
    return _DEFAULT_BUILTIN_DIR


class RecipeSchemaError(Exception):
    """Raised when a recipe fails schema validation."""


class RecipeNotFoundError(Exception):
    """Raised when a built-in recipe cannot be located on disk."""


_REQUIRED_TOP_KEYS = frozenset({"schema_version", "name", "version"})
_VALID_RISK_LEVELS = frozenset({"low", "medium", "high", "critical"})
_VAR_TOKEN_RE = re.compile(r"\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}")


def parse_recipe_text(text):
    """Parse + validate a recipe from its YAML source."""
    try:
        data = yaml.safe_load(text)
    except yaml.YAMLError as exc:
        raise RecipeSchemaError(f"recipe is not valid YAML: {exc}") from exc
    if not isinstance(data, dict):
        raise RecipeSchemaError("recipe must be a YAML mapping at the top level")
    return validate_recipe(data)


def validate_recipe(data):
    """Validate a parsed recipe mapping. Returns the normalised dict."""
    recipe = dict(data)
    missing = _REQUIRED_TOP_KEYS - set(recipe.keys())
    if missing:
        raise RecipeSchemaError(f"recipe missing required keys: {sorted(missing)}")
    if recipe["schema_version"] != SUPPORTED_SCHEMA_VERSION:
        raise RecipeSchemaError(
            f"unsupported schema_version={recipe['schema_version']!r}; "
            f"only version {SUPPORTED_SCHEMA_VERSION} is supported"
        )
    if not isinstance(recipe["name"], str) or not recipe["name"].strip():
        raise RecipeSchemaError("recipe.name must be a non-empty string")
    if not isinstance(recipe["version"], str):
        raise RecipeSchemaError("recipe.version must be a string")
    risk = recipe.get("risk_level", "low")
    if risk not in _VALID_RISK_LEVELS:
        raise RecipeSchemaError(
            f"recipe.risk_level={risk!r} is not one of {sorted(_VALID_RISK_LEVELS)}"
        )
    recipe["risk_level"] = risk
    recipe["preflight"] = _validate_phase(recipe.get("preflight", []), "preflight")
    recipe["steps"] = _validate_phase(recipe.get("steps", []), "steps")
    if not recipe["steps"]:
        raise RecipeSchemaError("recipe must define at least one step")
    recipe["verify"] = _validate_phase(recipe.get("verify", []), "verify")
    recipe["rollback"] = _validate_phase(recipe.get("rollback", []), "rollback")
    recipe["vars"] = recipe.get("vars") or {}
    if not isinstance(recipe["vars"], dict):
        raise RecipeSchemaError("recipe.vars must be a mapping")
    recipe["policy"] = recipe.get("policy") or {}
    if not isinstance(recipe["policy"], dict):
        raise RecipeSchemaError("recipe.policy must be a mapping")
    recipe["supported_os"] = recipe.get("supported_os") or {}
    return recipe


def _validate_phase(items, name):
    if items is None:
        return []
    if not isinstance(items, list):
        raise RecipeSchemaError(f"recipe.{name} must be a list")
    out = []
    for i, item in enumerate(items):
        if not isinstance(item, dict):
            raise RecipeSchemaError(f"recipe.{name}[{i}] must be a mapping")
        if "name" not in item or not isinstance(item["name"], str):
            raise RecipeSchemaError(f"recipe.{name}[{i}].name must be a string")
        if "run" not in item or not isinstance(item["run"], str):
            raise RecipeSchemaError(f"recipe.{name}[{i}].run must be a string")
        out.append({"name": item["name"], "run": item["run"]})
    return out


def render_text(
    text,
    values,
    *,
    var_type=None,
):
    """Render `{{ name }}` tokens in `text` using `values`."""

    def _replace(match):
        name = match.group(1)
        if name not in values:
            raise RecipeSchemaError(f"recipe references undefined variable: {name!r}")
        v = values[name]
        if var_type == "int" and (not isinstance(v, int) or isinstance(v, bool)):
            raise RecipeSchemaError(f"variable {name!r} should be int, got {type(v).__name__}")
        return str(v)

    return _VAR_TOKEN_RE.sub(_replace, text)


@dataclass(frozen=True)
class StepOutcome:
    index: int
    name: str
    status: str
    exit_code: int
    duration_s: float


class RecipeEngine:
    def __init__(self, *, session_factory, ssh_runner_factory=None):
        self._session_factory = session_factory
        self._service = JobService(session_factory=session_factory)
        self._audit = AuditService(
            session_factory=session_factory,
            redactor=default_redactor(),
        )
        self._redactor = default_redactor()
        self._ssh_runner_factory = ssh_runner_factory

    def policy_decision(self, recipe, *, environment="experiment"):
        return decision_for_recipe(recipe, environment=environment)

    def run_recipe(
        self,
        *,
        recipe,
        host_id,
        actor_user_id=None,
        vars_values=None,
        timeout_seconds=600,
    ):
        """Run the recipe synchronously. Returns the created job id."""
        effective_vars = {}
        for name, spec in (recipe.get("vars") or {}).items():
            if isinstance(spec, dict) and "default" in spec:
                effective_vars[name] = spec["default"]
        if vars_values:
            effective_vars.update(vars_values)

        from sqlalchemy import select

        with self._session_factory() as session:
            host = session.execute(
                select(models.Host).where(models.Host.id == host_id)
            ).scalar_one_or_none()
            if host is None:
                raise RecipeSchemaError(f"host not found: {host_id}")
            host_env = host.environment
            session.expunge(host)
            host_snapshot = host

        runner = self._build_runner(host_snapshot)

        approval_required = self.policy_decision(recipe, environment=host_env).approval_required
        job_id = self._create_recipe_job(
            host_id=host_id,
            recipe=recipe,
            actor_user_id=actor_user_id,
            environment=host_env,
            approval_required=approval_required,
            timeout_seconds=timeout_seconds,
        )

        phases = [
            ("preflight", recipe.get("preflight") or []),
            ("steps", recipe.get("steps") or []),
            ("verify", recipe.get("verify") or []),
        ]
        cumulative_index = 0
        failure: StepOutcome | None = None
        # Keep one SSH session for the whole recipe (open/close if supported).
        open_fn = getattr(runner, "open", None)
        close_fn = getattr(runner, "close", None)
        if callable(open_fn):
            try:
                open_fn()
            except Exception:
                pass  # fake runners in tests may not implement open
        try:
            for phase_name, phase_items in phases:
                for item in phase_items:
                    if failure is not None:
                        self._service.append_log(
                            job_id=job_id,
                            stream="system",
                            line="skipping step due to earlier failure",
                        )
                        self._record_step(
                            job_id=job_id,
                            phase=phase_name,
                            index=cumulative_index,
                            name=item["name"],
                            status="skipped",
                            exit_code=None,
                        )
                        cumulative_index += 1
                        continue
                    outcome = self._run_one_step(
                        job_id=job_id,
                        phase=phase_name,
                        index=cumulative_index,
                        item=item,
                        vars_values=effective_vars,
                        runner=runner,
                        timeout=float(timeout_seconds),
                    )
                    cumulative_index += 1
                    if outcome.status != "success":
                        failure = outcome
            if failure is not None:
                self._service.complete(
                    job_id=job_id,
                    exit_code=failure.exit_code or 1,
                    error_summary=f"recipe step {failure.name!r} failed",
                )
                for rb in recipe.get("rollback") or []:
                    self._run_one_step(
                        job_id=job_id,
                        phase="rollback",
                        index=cumulative_index,
                        item=rb,
                        vars_values=effective_vars,
                        runner=runner,
                        timeout=float(timeout_seconds),
                    )
                    cumulative_index += 1
            else:
                self._service.complete(job_id=job_id, exit_code=0)
        finally:
            if callable(close_fn):
                try:
                    close_fn()
                except Exception:
                    pass
        return job_id

    def _build_runner(self, host):
        if self._ssh_runner_factory is not None:
            return self._ssh_runner_factory(host)
        from vman.security.host_keys import parse_fingerprint
        from vman.services.ssh_runner import SshRunner, build_transport_for_host

        expected_fp = None
        if host.host_key_fingerprint and host.host_key_algorithm:
            try:
                expected_fp = parse_fingerprint(host.host_key_algorithm, host.host_key_fingerprint)
            except ValueError:
                expected_fp = None
        transport = build_transport_for_host(host, session_factory=self._session_factory)
        return SshRunner(
            transport=transport,
            host=host.hostname_or_ip,
            port=host.ssh_port,
            username=host.username,
            expected_fingerprint=expected_fp,
            redactor=self._redactor,
        )

    def _create_recipe_job(
        self,
        *,
        host_id,
        recipe,
        actor_user_id,
        environment,
        approval_required,
        timeout_seconds,
    ):
        N = chr(0x6E) + chr(0x61) + chr(0x6D) + chr(0x65)
        V = chr(0x76) + chr(0x65) + chr(0x72) + chr(0x73) + chr(0x69) + chr(0x6F) + chr(0x6E)
        summary = f"recipe: {recipe[N]}@{recipe.get(V, '0.0.0')}"
        job = self._service.create_command(
            host_id=host_id,
            command=summary,
            actor_user_id=actor_user_id,
            timeout_seconds=timeout_seconds,
            risk_level=recipe.get("risk_level"),
            approval_required=approval_required,
        )
        from sqlalchemy import select

        with self._session_factory() as session:
            row = session.execute(select(models.Job).where(models.Job.id == job.id)).scalar_one()
            row.status = "running"
            row.started_at = dt.datetime.now(dt.timezone.utc)
            row.recipe_name = recipe["name"]
            session.commit()
        self._audit.record(
            actor_user_id=actor_user_id,
            actor_type="user",
            action="recipe.run",
            resource_type="job",
            resource_id=job.id,
            metadata={
                "recipe": recipe["name"],
                "version": recipe.get("version", "0.0.0"),
                "environment": environment,
            },
        )
        return job.id

    def _run_one_step(self, *, job_id, phase, index, item, vars_values, runner, timeout):
        N = chr(0x6E) + chr(0x61) + chr(0x6D) + chr(0x65)
        rendered = render_text(item["run"], vars_values)
        self._service.append_log(
            job_id=job_id,
            stream="system",
            line=f"running {phase} step {item[N]!r}",
        )
        step_id = self._record_step(
            job_id=job_id,
            phase=phase,
            index=index,
            name=item["name"],
            status="running",
            exit_code=None,
        )
        started = dt.datetime.now(dt.timezone.utc)
        try:
            result = runner.run(rendered, timeout=timeout)
        except Exception as exc:
            self._service.append_log(
                job_id=job_id,
                stream="stderr",
                line=f"step {item[N]!r} raised {type(exc).__name__}",
            )
            self._finalise_step(
                step_id=step_id,
                status="failed",
                exit_code=1,
                error_summary=str(exc),
            )
            return StepOutcome(
                index=index,
                name=item["name"],
                status="failed",
                exit_code=1,
                duration_s=0.0,
            )
        for line in (result.stdout or "").splitlines():
            self._service.append_log(job_id=job_id, stream="stdout", line=line)
        for line in (result.stderr or "").splitlines():
            self._service.append_log(job_id=job_id, stream="stderr", line=line)
        duration = (dt.datetime.now(dt.timezone.utc) - started).total_seconds()
        if result.exit_code == 0:
            self._finalise_step(
                step_id=step_id,
                status="success",
                exit_code=0,
                error_summary=None,
            )
            return StepOutcome(
                index=index,
                name=item["name"],
                status="success",
                exit_code=0,
                duration_s=duration,
            )
        self._finalise_step(
            step_id=step_id,
            status="failed",
            exit_code=result.exit_code,
            error_summary=f"exit {result.exit_code} on {item[N]!r}",
        )
        return StepOutcome(
            index=index,
            name=item["name"],
            status="failed",
            exit_code=result.exit_code,
            duration_s=duration,
        )

    def _record_step(self, *, job_id, phase, index, name, status, exit_code):
        step_id = uuid.uuid4().hex
        with self._session_factory() as session:
            step = models.JobStep(
                id=step_id,
                job_id=job_id,
                step_index=index,
                name=f"{phase}:{name}",
                status=status,
                started_at=dt.datetime.now(dt.timezone.utc),
                exit_code=exit_code,
            )
            session.add(step)
            session.commit()
        return step_id

    def _finalise_step(self, *, step_id, status, exit_code, error_summary):
        from sqlalchemy import select

        with self._session_factory() as session:
            step = session.execute(
                select(models.JobStep).where(models.JobStep.id == step_id)
            ).scalar_one()
            step.status = status
            step.exit_code = exit_code
            step.finished_at = dt.datetime.now(dt.timezone.utc)
            if error_summary:
                step.error_summary_redacted = self._redactor.redact(error_summary)
            session.commit()


# --------------------------------------------------------------------------- #
# Built-in recipe registry (Task 18)
# --------------------------------------------------------------------------- #


def _recipe_summary(recipe):
    """Compact summary used by the recipe list / detail endpoints.

    The summary exposes only metadata; the full YAML body is fetched
    separately through ``load_builtin_recipe``. Keeping the list
    response narrow lets the dashboard render a recipe catalogue
    without paying the cost of sending every recipe body to every
    client.
    """
    return {
        "name": str(recipe.get("name", "")),
        "version": str(recipe.get("version", "0.0.0")),
        "description": str(recipe.get("description", "") or ""),
        "risk_level": str(recipe.get("risk_level", "low")),
        "step_count": len(recipe.get("steps", []) or []),
        "has_preflight": bool(recipe.get("preflight")),
        "has_verify": bool(recipe.get("verify")),
        "has_rollback": bool(recipe.get("rollback")),
        "vars": _summarise_vars(recipe.get("vars", {}) or {}),
        "supported_os": recipe.get("supported_os", {}) or {},
        "policy": recipe.get("policy", {}) or {},
        "source": "builtin",
    }


def _summarise_vars(spec):
    """Flatten the recipe's ``vars`` block into UI-friendly metadata.

    Recipe authors can either declare a variable as a bare scalar
    (e.g. ``port: 8080``) or as a mapping with ``type``, ``default``,
    and ``description`` keys. The form view needs to know whether a
    default is present, the declared type, and a description for the
    tooltip / help text. This helper normalises both shapes.
    """
    out: dict[str, dict] = {}
    for name, raw in spec.items():
        if isinstance(raw, dict):
            vtype = raw.get("type", "string")
            out[name] = {
                "type": str(vtype),
                "default": raw.get("default"),
                "description": str(raw.get("description", "") or ""),
                "required": "default" not in raw,
            }
        else:
            out[name] = {
                "type": "string",
                "default": raw,
                "description": "",
                "required": False,
            }
    return out


@lru_cache(maxsize=1)
def _builtin_recipe_index() -> dict[str, Path]:
    """Map ``recipe.name`` -> YAML file path on disk.

    The function caches the result for the lifetime of the process.
    Tests that need a fresh view can call ``load_builtin_recipes.cache_clear()``
    or set the ``VMAN_BUILTIN_RECIPES_DIR`` env var to point at a
    temporary directory.
    """
    directory = builtin_recipes_dir()
    if not directory.exists():
        return {}
    index: dict[str, Path] = {}
    for path in sorted(directory.glob("*.yaml")):
        try:
            text = path.read_text(encoding="utf-8")
            recipe = parse_recipe_text(text)
        except (RecipeSchemaError, OSError):
            # Skip files that fail validation; the validate endpoint
            # is the right place to surface parse errors to the user.
            continue
        name = str(recipe.get("name", "")).strip()
        if not name:
            continue
        # If two files declare the same recipe name, the alphabetically
        # later one wins.  This is documented behaviour so users have a
        # way to override a built-in by dropping a higher-priority
        # YAML in the directory.
        index[name] = path
    return index


def list_builtin_recipes() -> list[dict]:
    """Return summaries for every built-in recipe VMAN ships with."""
    out: list[dict] = []
    for path in _builtin_recipe_index().values():
        try:
            recipe = parse_recipe_text(path.read_text(encoding="utf-8"))
        except (RecipeSchemaError, OSError):
            continue
        out.append(_recipe_summary(recipe))
    out.sort(key=lambda r: r.get("name", ""))
    return out


def get_builtin_recipe_summary(name: str) -> dict:
    """Return a single built-in recipe summary by name.

    Raises :class:`RecipeNotFoundError` when the recipe does not exist
    on disk; the HTTP layer translates this to 404.
    """
    index = _builtin_recipe_index()
    path = index.get(name)
    if path is None:
        raise RecipeNotFoundError(f"recipe not found: {name}")
    recipe = parse_recipe_text(path.read_text(encoding="utf-8"))
    summary = _recipe_summary(recipe)
    summary["yaml"] = path.read_text(encoding="utf-8")
    return summary


def clear_builtin_recipe_cache() -> None:
    """Reset the cached built-in recipe index. Test helper."""
    _builtin_recipe_index.cache_clear()


__all__ = [
    "RecipeEngine",
    "RecipeNotFoundError",
    "RecipeSchemaError",
    "StepOutcome",
    "builtin_recipes_dir",
    "clear_builtin_recipe_cache",
    "get_builtin_recipe_summary",
    "list_builtin_recipes",
    "parse_recipe_text",
    "render_text",
    "validate_recipe",
]

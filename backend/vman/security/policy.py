"""Policy engine (Milestone 3 / Task 12).

Classifies commands and recipes by risk level and decides whether
an approval gate is required. The policy is deliberately
conservative: false positives (asking for approval on a safe
command) are far better than false negatives (running a destructive
command without confirmation).

Design notes
------------
- ``classify_command`` is a pure function over a single string. It
  does NOT touch the filesystem, database, or any external service.
  That makes it trivially testable and re-usable from the policy
  gate in the JobService, the MCP server, and the CLI.
- ``RiskLevel`` is a strict ordering: LOW < MEDIUM < HIGH < CRITICAL.
- ``decision_for_command`` / ``decision_for_recipe`` take the
  environment into account. Production hosts always require approval
  for MEDIUM or higher; experiment hosts require approval only at
  HIGH and above; CRITICAL always requires typed confirmation.
- Unknown environment strings are treated as the most conservative
  case (production) so a typo in the route or CLI never bypasses a
  policy gate.
"""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from enum import Enum


class RiskLevel(str, Enum):
    """Risk ordering, lowest to highest."""

    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"

    def __lt__(self, other: RiskLevel) -> bool:  # type: ignore[override]
        order = [RiskLevel.LOW, RiskLevel.MEDIUM, RiskLevel.HIGH, RiskLevel.CRITICAL]
        return order.index(self) < order.index(other)

    def __le__(self, other: RiskLevel) -> bool:  # type: ignore[override]
        return self == other or self < other

    def __ge__(self, other: RiskLevel) -> bool:  # type: ignore[override]
        return self == other or self > other

    def __gt__(self, other: RiskLevel) -> bool:  # type: ignore[override]
        return not self <= other


# --------------------------------------------------------------------------- #
# Command classifier
# --------------------------------------------------------------------------- #


# Each rule is a (compiled_pattern, risk_level) pair. The first match
# wins; the list is ordered from least to most severe.
# fmt: off
_COMMAND_RULES: list[tuple[re.Pattern[str], RiskLevel]] = [
    # CRITICAL first
    (re.compile(r"\brm\s+-rf?\s+/(\s|\*|$)"), RiskLevel.CRITICAL),
    (re.compile(r"\bmkfs\b"), RiskLevel.CRITICAL),
    (re.compile(r"\bdd\s+.*\bof=/dev/"), RiskLevel.CRITICAL),
    (re.compile(r"\b(systemctl\s+(disable|stop|masks?)\s+ssh)"), RiskLevel.CRITICAL),
    (re.compile(r"\bchmod\s+-R\s+0+\s+/"), RiskLevel.CRITICAL),
    # HIGH
    (re.compile(r"\b(systemctl\s+(restart|reload))\b"), RiskLevel.HIGH),
    (re.compile(r"\b(reboot|poweroff|halt|shutdown)\b"), RiskLevel.HIGH),
    (re.compile(r"\b(passwd|chpasswd)\b"), RiskLevel.HIGH),
    (re.compile(r"\b(useradd|userdel|usermod|groupadd|groupdel)\b"), RiskLevel.HIGH),
    (re.compile(r"\b(ufw|firewalld|iptables|nft)\b"), RiskLevel.HIGH),
    (re.compile(r"/etc/ssh/(sshd_config|ssh_config)"), RiskLevel.HIGH),
    (re.compile(r"\b(visudo|sudoers)\b"), RiskLevel.HIGH),
    (re.compile(r"\b(curl|wget)\b.*\|\s*(sh|bash|zsh)\b"), RiskLevel.HIGH),
    (re.compile(r"\b(systemctl\s+(enable|mask))\b"), RiskLevel.HIGH),
    # MEDIUM
    (re.compile(r"\b(apt-get|apt)\s+install\b"), RiskLevel.MEDIUM),
    (re.compile(r"\b(dnf|yum)\s+install\b"), RiskLevel.MEDIUM),
    (re.compile(r"\bapk\s+add\b"), RiskLevel.MEDIUM),
    (re.compile(r"\b(pacman)\s+-S\b"), RiskLevel.MEDIUM),
    (re.compile(r"\b(systemctl\s+start)\b"), RiskLevel.MEDIUM),
    (re.compile(r"\b(systemctl\s+stop)\b"), RiskLevel.MEDIUM),
    # LOW (explicit) -- used for read-only commands we want to flag as
    # LOW regardless of what's in the string.
    (re.compile(r"\b(uptime|whoami|uname|df|free|ls|cat|systemctl\s+status)\b"), RiskLevel.LOW),
]
# fmt: on


def classify_command(command: str, risk_level: str | None = None) -> RiskLevel:
    """Return the highest-severity risk level matched in ``command``.

    If ``risk_level`` is provided, the explicit value wins (used when
    the caller -- typically a recipe -- has already declared the
    risk). Otherwise the command is matched against the rule table.
    """
    if risk_level is not None:
        try:
            return RiskLevel(risk_level)
        except ValueError:
            pass
    cmd = (command or "").strip()
    if not cmd:
        return RiskLevel.LOW
    best = RiskLevel.LOW
    for pattern, level in _COMMAND_RULES:
        if pattern.search(cmd) and level > best:
            best = level
    return best


def classify_recipe(recipe: Mapping[str, object]) -> RiskLevel:
    """Return the recipe's declared risk level (low if missing)."""
    raw = recipe.get("risk_level")
    if isinstance(raw, str):
        try:
            return RiskLevel(raw)
        except ValueError:
            return RiskLevel.LOW
    return RiskLevel.LOW


# --------------------------------------------------------------------------- #
# Decision
# --------------------------------------------------------------------------- #


@dataclass(frozen=True)
class PolicyDecision:
    """Result of a policy evaluation.

    Attributes:
        risk_level: the classified risk level.
        approval_required: True iff the action must be approved before
            running.
        requires_typed_confirmation: True iff the operator must type
            the host name (or a similar confirmation string) to
            proceed. Always paired with approval_required.
        blocked: True iff the action is forbidden in this
            environment (e.g. a recipe marked
            ``forbidden_on_environments: [production]`` on a
            production host).
        reason: human-readable explanation for the audit log.
    """

    risk_level: RiskLevel
    approval_required: bool
    requires_typed_confirmation: bool
    blocked: bool
    reason: str = ""

    def __repr__(self) -> str:
        return (
            f"PolicyDecision(risk={self.risk_level.value}, "
            f"approval={self.approval_required}, "
            f"confirmation={self.requires_typed_confirmation}, "
            f"blocked={self.blocked})"
        )


_KNOWN_ENVIRONMENTS: frozenset[str] = frozenset({"experiment", "staging", "production"})


def decision_for_command(
    command: str,
    *,
    environment: str = "experiment",
    risk_level: str | None = None,
) -> PolicyDecision:
    """Compute the policy decision for a single command.

    Unknown environment strings are treated as the most conservative
    case (production) so a typo never bypasses a gate.
    """
    level = classify_command(command, risk_level=risk_level)
    return _decide(level, environment, reason_extra=command[:200])


def decision_for_recipe(
    recipe: Mapping[str, object],
    *,
    environment: str = "experiment",
) -> PolicyDecision:
    """Compute the policy decision for a recipe."""
    level = classify_recipe(recipe)
    # Check the recipe's policy block for environment restrictions.
    policy = recipe.get("policy") or {}
    if isinstance(policy, Mapping):
        forbidden = policy.get("forbidden_on_environments") or []
        if (
            isinstance(forbidden, Sequence)
            and not isinstance(forbidden, (str, bytes))
            and environment in forbidden
        ):
            return PolicyDecision(
                risk_level=level,
                approval_required=False,
                requires_typed_confirmation=False,
                blocked=True,
                reason=(f"recipe forbids environment={environment!r}"),
            )
        if policy.get("requires_approval") is True:
            # Explicit override: even LOW risk on experiment needs approval.
            return PolicyDecision(
                risk_level=level,
                approval_required=True,
                requires_typed_confirmation=(level >= RiskLevel.CRITICAL),
                blocked=False,
                reason="recipe requires explicit approval",
            )
    return _decide(level, environment, reason_extra=str(recipe.get("name", "")))


def _decide(
    level: RiskLevel,
    environment: str,
    *,
    reason_extra: str = "",
) -> PolicyDecision:
    env = environment if environment in _KNOWN_ENVIRONMENTS else "production"
    approval = False
    confirmation = False
    reason_bits: list[str] = [f"risk={level.value}", f"env={env}"]
    if level == RiskLevel.LOW:
        pass
    elif level == RiskLevel.MEDIUM:
        if env == "production":
            approval = True
            reason_bits.append("medium risk on production needs approval")
    elif level == RiskLevel.HIGH:
        approval = True
        reason_bits.append("high risk always needs approval")
    elif level == RiskLevel.CRITICAL:
        approval = True
        confirmation = True
        reason_bits.append("critical / destructive action needs typed confirmation")
    if reason_extra:
        reason_bits.append(f"context={reason_extra}")
    return PolicyDecision(
        risk_level=level,
        approval_required=approval,
        requires_typed_confirmation=confirmation,
        blocked=False,
        reason="; ".join(reason_bits),
    )


# --------------------------------------------------------------------------- #
# Engine facade
# --------------------------------------------------------------------------- #


class PolicyEngine:
    """A thin wrapper that callers can mock in tests."""

    def decide_command(
        self,
        command: str,
        *,
        environment: str = "experiment",
        risk_level: str | None = None,
    ) -> PolicyDecision:
        return decision_for_command(command, environment=environment, risk_level=risk_level)

    def decide_recipe(
        self,
        recipe: Mapping[str, object],
        *,
        environment: str = "experiment",
    ) -> PolicyDecision:
        return decision_for_recipe(recipe, environment=environment)


__all__ = [
    "PolicyDecision",
    "PolicyEngine",
    "RiskLevel",
    "classify_command",
    "classify_recipe",
    "decision_for_command",
    "decision_for_recipe",
]

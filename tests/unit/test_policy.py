"""Unit tests for the policy engine (Milestone 3 / Task 12).

The policy engine classifies commands and recipes by risk level
and decides whether an approval gate is required.

Acceptance:
- detects dangerous commands (rm -rf /, mkfs, dd to block devices,
  firewall lockouts, ssh config changes, etc.)
- production hosts require stronger approval than experiment hosts
- the JobService blocks high/critical risk until approved
"""

from __future__ import annotations

from vman.security.policy import (
    PolicyEngine,
    RiskLevel,
    classify_command,
    classify_recipe,
    decision_for_command,
    decision_for_recipe,
)

# --------------------------------------------------------------------------- #
# Risk classification
# --------------------------------------------------------------------------- #


def test_classify_empty_command_is_low() -> None:
    assert classify_command("") == RiskLevel.LOW


def test_classify_read_only_commands_are_low() -> None:
    for cmd in ["uptime", "df -h", "free -m", "systemctl status nginx"]:
        assert classify_command(cmd) == RiskLevel.LOW, cmd


def test_classify_apt_install_is_medium() -> None:
    assert classify_command("apt-get install -y curl") == RiskLevel.MEDIUM


def test_classify_dnf_install_is_medium() -> None:
    assert classify_command("dnf install -y curl") == RiskLevel.MEDIUM


def test_classify_apk_add_is_medium() -> None:
    assert classify_command("apk add --no-cache curl") == RiskLevel.MEDIUM


def test_classify_pacman_install_is_medium() -> None:
    assert classify_command("pacman -S --noconfirm curl") == RiskLevel.MEDIUM


def test_classify_systemctl_restart_is_high() -> None:
    assert classify_command("systemctl restart nginx") == RiskLevel.HIGH
    assert classify_command("systemctl reload nginx") == RiskLevel.HIGH


def test_classify_firewall_change_is_high() -> None:
    assert classify_command("ufw allow 22/tcp") == RiskLevel.HIGH
    assert classify_command("iptables -A INPUT -j DROP") == RiskLevel.HIGH


def test_classify_ssh_config_change_is_high() -> None:
    assert classify_command("sed -i /etc/ssh/sshd_config") == RiskLevel.HIGH
    assert classify_command("echo X >> /etc/ssh/sshd_config") == RiskLevel.HIGH


def test_classify_user_management_is_high() -> None:
    assert classify_command("useradd -m deploy") == RiskLevel.HIGH
    assert classify_command("usermod -aG sudo deploy") == RiskLevel.HIGH
    assert classify_command("passwd root") == RiskLevel.HIGH


def test_classify_reboot_is_high() -> None:
    assert classify_command("reboot") == RiskLevel.HIGH
    assert classify_command("shutdown -r now") == RiskLevel.HIGH


def test_classify_rm_rf_root_is_critical() -> None:
    assert classify_command("rm -rf /") == RiskLevel.CRITICAL
    assert classify_command("rm -rf /*") == RiskLevel.CRITICAL


def test_classify_mkfs_is_critical() -> None:
    assert classify_command("mkfs.ext4 /dev/sda1") == RiskLevel.CRITICAL


def test_classify_dd_to_block_device_is_critical() -> None:
    assert classify_command("dd if=/dev/zero of=/dev/sda bs=1M") == RiskLevel.CRITICAL


def test_classify_disabling_ssh_is_critical() -> None:
    assert classify_command("systemctl disable sshd") == RiskLevel.CRITICAL
    assert classify_command("systemctl stop sshd") == RiskLevel.CRITICAL


def test_classify_curl_pipe_sh_is_high() -> None:
    assert classify_command("curl https://x.example.com/install.sh | sh") == RiskLevel.HIGH
    assert classify_command("wget -qO- https://x.example.com/install.sh | bash") == RiskLevel.HIGH


def test_classify_explicit_override() -> None:
    assert classify_command("ls", risk_level="critical") == RiskLevel.CRITICAL


def test_classify_recipe_uses_its_declared_risk() -> None:
    assert classify_recipe({"risk_level": "high"}) == RiskLevel.HIGH
    assert classify_recipe({"risk_level": "low"}) == RiskLevel.LOW
    assert classify_recipe({}) == RiskLevel.LOW


# --------------------------------------------------------------------------- #
# Decision: per-environment approval rules
# --------------------------------------------------------------------------- #


def test_decision_low_risk_on_experiment_does_not_require_approval() -> None:
    d = decision_for_command("uptime", environment="experiment")
    assert d.approval_required is False
    assert d.risk_level == RiskLevel.LOW


def test_decision_medium_risk_on_experiment_does_not_require_approval() -> None:
    d = decision_for_command("apt-get install curl", environment="experiment")
    assert d.approval_required is False
    assert d.risk_level == RiskLevel.MEDIUM


def test_decision_medium_risk_on_production_requires_approval() -> None:
    d = decision_for_command("apt-get install curl", environment="production")
    assert d.approval_required is True
    assert d.risk_level == RiskLevel.MEDIUM


def test_decision_high_risk_always_requires_approval() -> None:
    d = decision_for_command("ufw allow 22/tcp", environment="experiment")
    assert d.approval_required is True
    assert d.risk_level == RiskLevel.HIGH


def test_decision_critical_risk_requires_approval_and_confirmation() -> None:
    d = decision_for_command("rm -rf /", environment="experiment")
    assert d.approval_required is True
    assert d.requires_typed_confirmation is True


def test_decision_for_recipe_inherits_risk() -> None:
    d = decision_for_recipe({"risk_level": "high"}, environment="experiment")
    assert d.approval_required is True
    assert d.risk_level == RiskLevel.HIGH


def test_decision_for_recipe_with_forbidden_environment_blocks() -> None:
    recipe = {
        "risk_level": "low",
        "policy": {"forbidden_on_environments": ["production"]},
    }
    d = decision_for_recipe(recipe, environment="production")
    assert d.blocked is True
    assert d.approval_required is False  # blocked, not approval


def test_decision_for_recipe_with_forbidden_environment_allows_other_envs() -> None:
    recipe = {
        "risk_level": "low",
        "policy": {"forbidden_on_environments": ["production"]},
    }
    d = decision_for_recipe(recipe, environment="experiment")
    assert d.blocked is False
    assert d.approval_required is False


def test_decision_for_recipe_requires_approval_setting() -> None:
    recipe = {
        "risk_level": "low",
        "policy": {"requires_approval": True},
    }
    d = decision_for_recipe(recipe, environment="experiment")
    assert d.approval_required is True


def test_decision_exposes_reason() -> None:
    d = decision_for_command("rm -rf /", environment="experiment")
    assert d.reason  # non-empty
    assert "critical" in d.reason.lower() or "destructive" in d.reason.lower()


def test_policy_engine_decision_via_engine_class() -> None:
    engine = PolicyEngine()
    d = engine.decide_command("rm -rf /", environment="production")
    assert d.approval_required is True
    assert d.requires_typed_confirmation is True


def test_unknown_environment_falls_through_to_safer_default() -> None:
    # Unknown environment string -> treat as production (most conservative).
    d = decision_for_command("apt-get install curl", environment="unknown")
    assert d.approval_required is True


def test_decision_repr_does_not_leak_command_in_test() -> None:
    """The repr should be parseable but does not need to include the
    command itself; verify it is non-empty and looks like a status."""
    d = decision_for_command("uptime", environment="experiment")
    r = repr(d)
    assert r

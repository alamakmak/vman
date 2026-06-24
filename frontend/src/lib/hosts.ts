/**
 * Shared TypeScript types and small helpers for the host dashboard.
 *
 * The fields mirror the backend Pydantic schemas (see
 * backend/vman/schemas/hosts.py) but the wire shape is kept narrow on
 * purpose: we never accept nor display any plaintext credential
 * material. `credential_id` is an opaque reference to an entry in the
 * encrypted vault; the form lets the user create / pick one but never
 * shows the secret itself.
 */

export type AuthMethod = "password" | "key" | "key_with_passphrase";
export type SudoMode = "root" | "passwordless_sudo" | "sudo_password";
export type Environment = "experiment" | "staging" | "production";
export type RiskLevel = "low" | "medium" | "high" | "critical" | null;

export interface Host {
  id: string;
  name: string;
  hostname_or_ip: string;
  ssh_port: number;
  username: string;
  auth_method: AuthMethod;
  credential_id: string | null;
  sudo_mode: SudoMode;
  host_key_fingerprint: string | null;
  host_key_algorithm: string | null;
  os_family: string | null;
  os_name: string | null;
  os_version: string | null;
  package_manager: string | null;
  arch: string | null;
  cpu_cores: number | null;
  ram_mb: number | null;
  disk_total_mb: number | null;
  provider: string | null;
  region: string | null;
  environment: Environment;
  risk_level: RiskLevel;
  tags: string[];
  notes: string;
  last_seen_at: string | null;
  disabled_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * The shape the dashboard sends when creating a host. We deliberately
 * leave secret material out: `credential_id` references a vault entry
 * that the user must provision separately.
 */
export interface HostCreatePayload {
  name: string;
  hostname_or_ip: string;
  ssh_port: number;
  username: string;
  auth_method: AuthMethod;
  credential_id?: string | null;
  sudo_mode: SudoMode;
  environment: Environment;
  provider?: string | null;
  region?: string | null;
  tags: string[];
  notes: string;
}

export type HostUpdatePayload = Partial<HostCreatePayload> & {
  risk_level?: RiskLevel;
  host_key_fingerprint?: string | null;
  host_key_algorithm?: string | null;
  os_family?: string | null;
  os_name?: string | null;
  os_version?: string | null;
  package_manager?: string | null;
  arch?: string | null;
  cpu_cores?: number | null;
  ram_mb?: number | null;
  disk_total_mb?: number | null;
};

export const AUTH_METHODS: { value: AuthMethod; label: string; hint: string }[] = [
  { value: "key", label: "SSH key (recommended)", hint: "Authenticates with a public key on the target." },
  { value: "key_with_passphrase", label: "SSH key + passphrase", hint: "Key is encrypted with an additional passphrase." },
  { value: "password", label: "Password", hint: "Use only when keys are not possible. Stored encrypted." },
];

export const SUDO_MODES: { value: SudoMode; label: string; hint: string }[] = [
  { value: "root", label: "Root login", hint: "The SSH user is root. No sudo needed." },
  { value: "passwordless_sudo", label: "Passwordless sudo", hint: "User can run any command via sudo NOPASSWD." },
  { value: "sudo_password", label: "Sudo with password", hint: "User must enter a password for sudo." },
];

export const ENVIRONMENTS: { value: Environment; label: string; tone: "info" | "warning" | "destructive" }[] = [
  { value: "experiment", label: "Experiment", tone: "info" },
  { value: "staging", label: "Staging", tone: "warning" },
  { value: "production", label: "Production", tone: "destructive" },
];

export function environmentLabel(env: Environment): string {
  return ENVIRONMENTS.find((e) => e.value === env)?.label ?? env;
}

export function authMethodLabel(method: AuthMethod): string {
  return AUTH_METHODS.find((m) => m.value === method)?.label ?? method;
}

export function sudoModeLabel(mode: SudoMode): string {
  return SUDO_MODES.find((m) => m.value === mode)?.label ?? mode;
}

/**
 * Best-effort short tag for the OS column. We never claim more than
 * the server told us, so missing data renders as a dash.
 */
export function describeOs(host: Host): string {
  const parts: string[] = [];
  if (host.os_name) parts.push(host.os_name);
  if (host.os_version) parts.push(host.os_version);
  if (host.arch) parts.push(host.arch);
  return parts.length > 0 ? parts.join(" • ") : "—";
}

/**
 * The connection-test result shape returned by
 * ``POST /api/hosts/{id}/test`` (or the corresponding mock when the
 * backend endpoint is not yet wired up).
 */
export interface ConnectionTestResult {
  ok: boolean;
  reached: boolean;
  authenticated: boolean;
  host_key_fingerprint: string | null;
  host_key_algorithm: string | null;
  latency_ms: number | null;
  message: string;
  tested_at: string;
}

export const HOST_DETAIL_FIELD_LABELS: Record<string, string> = {
  name: "Name",
  hostname_or_ip: "Hostname / IP",
  ssh_port: "SSH port",
  username: "SSH user",
  auth_method: "Auth method",
  sudo_mode: "Sudo mode",
  environment: "Environment",
  provider: "Provider",
  region: "Region",
  tags: "Tags",
  notes: "Notes",
  host_key_fingerprint: "Host key fingerprint",
  host_key_algorithm: "Host key algorithm",
  os_family: "OS family",
  os_name: "OS name",
  os_version: "OS version",
  package_manager: "Package manager",
  arch: "Architecture",
  cpu_cores: "CPU cores",
  ram_mb: "RAM",
  disk_total_mb: "Disk",
  risk_level: "Risk level",
  credential_id: "Credential",
  last_seen_at: "Last seen",
  disabled_at: "Disabled at",
  created_at: "Created at",
  updated_at: "Updated at",
};

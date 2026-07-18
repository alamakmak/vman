import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  CheckCircle2,
  Edit3,
  KeyRound,
  Power,
  Server,
  ShieldCheck,
  Tag,
  Trash2,
  XCircle,
  Zap,
} from "lucide-react";
import {
  Box,
  Button,
  Flex,
  Grid,
  GridItem,
  HStack,
  Icon,
  Spinner,
  Text,
  VStack,
  Divider,
} from "@chakra-ui/react";
import { ApiError } from "@/lib/api";
import {
  deleteHost,
  getHost,
  HostApiError,
  testConnection,
} from "@/lib/hostsApi";
import {
  authMethodLabel,
  environmentLabel,
  HOST_DETAIL_FIELD_LABELS,
  sudoModeLabel,
  type ConnectionTestResult,
  type Host,
} from "@/lib/hosts";

// ─── helpers ────────────────────────────────────────────────────────────────

function formatBytes(mb: number | null | undefined): string {
  if (mb == null) return "—";
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb} MB`;
}

function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return iso;
  const diff = Date.now() - ts;
  if (diff < 0) return new Date(iso).toLocaleString();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleString();
}

function getEnvStyle(env: Host["environment"]): {
  bg: string;
  color: string;
  border: string;
} {
  if (env === "production")
    return {
      bg: "rgba(239,68,68,0.12)",
      color: "#F87171",
      border: "rgba(239,68,68,0.3)",
    };
  if (env === "staging")
    return {
      bg: "rgba(0,240,255,0.10)",
      color: "#00F0FF",
      border: "rgba(0,240,255,0.3)",
    };
  return {
    bg: "rgba(107,114,128,0.15)",
    color: "#9CA3AF",
    border: "rgba(107,114,128,0.3)",
  };
}

// ─── Sub-components ─────────────────────────────────────────────────────────

/** Obsidian-style card shell */
function ObsidianCard({ children }: { children: React.ReactNode }) {
  return (
    <Box
      bg="obsidian.surface"
      border="1px solid"
      borderColor="obsidian.border"
      borderRadius="md"
      overflow="hidden"
    >
      {children}
    </Box>
  );
}

/** Obsidian card header with dark strip */
function CardHeader({
  icon,
  title,
  subtitle,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
}) {
  return (
    <Box
      bg="#0E0E10"
      borderBottom="1px solid"
      borderColor="obsidian.border"
      px={5}
      py={3}
    >
      <HStack spacing={2}>
        {icon}
        <Text
          fontFamily="mono"
          fontSize="11px"
          fontWeight="bold"
          letterSpacing="widest"
          textTransform="uppercase"
          color="white"
        >
          {title}
        </Text>
      </HStack>
      {subtitle && (
        <Text
          fontSize="xs"
          color="obsidian.onSurfaceVariant"
          mt={0.5}
          fontFamily="mono"
        >
          {subtitle}
        </Text>
      )}
    </Box>
  );
}

/** Label + value pair used throughout detail cards */
function DetailRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <Box>
      <Text
        fontSize="10px"
        fontWeight="bold"
        color="obsidian.onSurfaceVariant"
        fontFamily="mono"
        letterSpacing="widest"
        textTransform="uppercase"
        mb={0.5}
      >
        {label}
      </Text>
      <Text fontSize="sm" color="white" fontFamily="mono">
        {value}
      </Text>
    </Box>
  );
}

/** Disable-confirm modal */
function DisableModal({
  host,
  deleting,
  onConfirm,
  onCancel,
}: {
  host: Host;
  deleting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Box
      position="fixed"
      inset={0}
      zIndex={50}
      bg="rgba(0,0,0,0.75)"
      display="flex"
      alignItems="center"
      justifyContent="center"
      p={4}
    >
      <Box
        bg="obsidian.surface"
        border="1px solid"
        borderColor="obsidian.border"
        borderRadius="md"
        p={6}
        w="full"
        maxW="420px"
        boxShadow="0 0 60px rgba(0,0,0,0.8)"
      >
        <HStack spacing={3} mb={3}>
          <Icon as={XCircle} color="#FF3131" w={5} h={5} />
          <Text fontWeight="bold" color="white" fontSize="sm" fontFamily="mono">
            Disable {host.name}?
          </Text>
        </HStack>
        <Text fontSize="xs" color="obsidian.onSurfaceVariant" mb={6}>
          Soft-delete keeps the audit trail and historical jobs but stops new
          commands from running against this host.
        </Text>
        <HStack justify="flex-end" spacing={3}>
          <Button
            size="sm"
            variant="outline"
            borderColor="obsidian.border"
            color="white"
            fontFamily="mono"
            _hover={{ bg: "obsidian.surfaceHigh" }}
            onClick={onCancel}
            isDisabled={deleting}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            bg="#FF3131"
            color="white"
            fontFamily="mono"
            _hover={{ bg: "#e02a2a" }}
            onClick={onConfirm}
            isLoading={deleting}
            loadingText="Disabling…"
          >
            Disable host
          </Button>
        </HStack>
      </Box>
    </Box>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export function HostDetailPage() {
  const { hostId } = useParams<{ hostId: string }>();
  const navigate = useNavigate();
  const [host, setHost] = useState<Host | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(
    null
  );
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const refresh = useCallback(async () => {
    if (!hostId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const row = await getHost(hostId);
      setHost(row);
    } catch (err) {
      if (err instanceof HostApiError) {
        setLoadError(err.detail);
      } else if (err instanceof ApiError) {
        setLoadError(err.message);
      } else if (err instanceof Error) {
        setLoadError(err.message);
      } else {
        setLoadError("Failed to load host.");
      }
    } finally {
      setLoading(false);
    }
  }, [hostId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const runConnectionTest = async () => {
    if (!host) return;
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testConnection(host.id);
      setTestResult(result);
      // Merge detected fields from the test response so Detected OS updates
      // immediately (no full page reload). Also re-fetch for full consistency.
      setHost((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          host_key_fingerprint:
            result.host_key_fingerprint ?? prev.host_key_fingerprint,
          host_key_algorithm:
            result.host_key_algorithm ?? prev.host_key_algorithm,
          os_family: result.os_family ?? prev.os_family,
          os_name: result.os_name ?? prev.os_name,
          os_version: result.os_version ?? prev.os_version,
          package_manager: result.package_manager ?? prev.package_manager,
          arch: result.arch ?? prev.arch,
          cpu_cores: result.cpu_cores ?? prev.cpu_cores,
          ram_mb: result.ram_mb ?? prev.ram_mb,
          disk_total_mb: result.disk_total_mb ?? prev.disk_total_mb,
          last_seen_at: result.last_seen_at ?? prev.last_seen_at,
        };
      });
      try {
        const row = await getHost(host.id);
        setHost(row);
      } catch {
        // Keep merged state if refresh fails.
      }
    } catch (err) {
      const msg =
        err instanceof HostApiError
          ? err.detail
          : err instanceof Error
            ? err.message
            : "Connection test failed.";
      setTestResult({
        ok: false,
        reached: false,
        authenticated: false,
        host_key_fingerprint: null,
        host_key_algorithm: null,
        latency_ms: null,
        message: msg,
        tested_at: new Date().toISOString(),
      });
    } finally {
      setTesting(false);
    }
  };

  const handleDelete = async () => {
    if (!host) return;
    setDeleting(true);
    try {
      await deleteHost(host.id);
      navigate("/hosts", { replace: true });
    } catch (err) {
      const msg =
        err instanceof HostApiError
          ? err.detail
          : err instanceof Error
            ? err.message
            : "Failed to disable host.";
      setLoadError(msg);
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  // ── Loading state ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <Flex
        align="center"
        justify="center"
        gap={3}
        py={20}
        color="obsidian.onSurfaceVariant"
        fontFamily="mono"
        fontSize="sm"
      >
        <Spinner color="obsidian.cyan" size="sm" />
        Loading host…
      </Flex>
    );
  }

  // ── Error state (no host loaded) ───────────────────────────────────────────
  if (loadError && !host) {
    return (
      <VStack align="start" spacing={4}>
        <Button
          size="sm"
          variant="outline"
          borderColor="obsidian.border"
          color="white"
          fontFamily="mono"
          leftIcon={<Icon as={ArrowLeft} w={4} h={4} />}
          _hover={{ bg: "obsidian.surfaceHigh" }}
          onClick={() => navigate("/hosts")}
        >
          Back to hosts
        </Button>
        <Box
          bg="rgba(255,49,49,0.08)"
          border="1px solid"
          borderColor="rgba(255,49,49,0.3)"
          borderRadius="md"
          p={4}
          w="full"
        >
          <Text
            fontFamily="mono"
            fontSize="xs"
            fontWeight="bold"
            color="#FF3131"
            letterSpacing="wide"
            textTransform="uppercase"
            mb={1}
          >
            Could not load host
          </Text>
          <Text fontSize="sm" color="obsidian.onSurfaceVariant">
            {loadError}
          </Text>
        </Box>
      </VStack>
    );
  }

  // ── Not found ──────────────────────────────────────────────────────────────
  if (!host) {
    return (
      <VStack align="start" spacing={4}>
        <Button
          size="sm"
          variant="outline"
          borderColor="obsidian.border"
          color="white"
          fontFamily="mono"
          leftIcon={<Icon as={ArrowLeft} w={4} h={4} />}
          _hover={{ bg: "obsidian.surfaceHigh" }}
          onClick={() => navigate("/hosts")}
        >
          Back to hosts
        </Button>
        <Box
          bg="obsidian.surface"
          border="1px solid"
          borderColor="obsidian.border"
          borderRadius="md"
          p={4}
          w="full"
        >
          <Text
            fontFamily="mono"
            fontSize="xs"
            fontWeight="bold"
            color="obsidian.onSurfaceVariant"
            letterSpacing="wide"
            textTransform="uppercase"
            mb={1}
          >
            Host not found
          </Text>
          <Text fontSize="sm" color="obsidian.onSurfaceVariant">
            The host you requested no longer exists. It may have been disabled.
          </Text>
        </Box>
      </VStack>
    );
  }

  const environment = host.environment;
  const envStyle = getEnvStyle(environment);
  const isProduction = environment === "production";

  return (
    <VStack spacing={5} align="stretch">
      {/* ── Header bar ─────────────────────────────────────────────────── */}
      <Flex
        align="center"
        justify="space-between"
        flexWrap="wrap"
        gap={3}
      >
        {/* Left: back + title */}
        <HStack spacing={4} flexWrap="wrap">
          <Button
            size="sm"
            variant="outline"
            borderColor="obsidian.border"
            color="white"
            fontFamily="mono"
            leftIcon={<Icon as={ArrowLeft} w={4} h={4} />}
            _hover={{ bg: "obsidian.surfaceHigh" }}
            onClick={() => navigate("/hosts")}
          >
            Hosts
          </Button>

          <VStack align="start" spacing={0.5}>
            <HStack spacing={2} flexWrap="wrap">
              <Text
                fontSize="xl"
                fontWeight="bold"
                color="white"
                fontFamily="mono"
                letterSpacing="tight"
              >
                {host.name}
              </Text>

              {/* Environment badge */}
              <Box
                px={2}
                py={0.5}
                borderRadius="sm"
                bg={envStyle.bg}
                border="1px solid"
                borderColor={envStyle.border}
                display="inline-flex"
                alignItems="center"
              >
                <Text
                  fontSize="10px"
                  fontWeight="bold"
                  color={envStyle.color}
                  fontFamily="mono"
                  letterSpacing="widest"
                  textTransform="uppercase"
                >
                  {environmentLabel(environment)}
                </Text>
              </Box>

              {/* Disabled badge */}
              {host.disabled_at ? (
                <Box
                  px={2}
                  py={0.5}
                  borderRadius="sm"
                  bg="rgba(255,49,49,0.12)"
                  border="1px solid"
                  borderColor="rgba(255,49,49,0.3)"
                  display="inline-flex"
                  alignItems="center"
                >
                  <Text
                    fontSize="10px"
                    fontWeight="bold"
                    color="#FF3131"
                    fontFamily="mono"
                    letterSpacing="widest"
                    textTransform="uppercase"
                  >
                    disabled
                  </Text>
                </Box>
              ) : null}
            </HStack>

            {/* SSH address line */}
            <Text
              fontSize="xs"
              color="obsidian.onSurfaceVariant"
              fontFamily="mono"
            >
              {host.username}@{host.hostname_or_ip}:{host.ssh_port}
            </Text>
          </VStack>
        </HStack>

        {/* Right: action buttons */}
        <HStack spacing={2}>
          <Button
            size="sm"
            variant="outline"
            borderColor="obsidian.border"
            color="white"
            fontFamily="mono"
            leftIcon={<Icon as={Edit3} w={3.5} h={3.5} />}
            _hover={{ bg: "obsidian.surfaceHigh" }}
            isDisabled={!!host.disabled_at}
            onClick={() => navigate(`/hosts/${host.id}/edit`)}
          >
            Edit
          </Button>
          <Button
            size="sm"
            bg="rgba(255,49,49,0.15)"
            color="#FF3131"
            border="1px solid"
            borderColor="rgba(255,49,49,0.3)"
            fontFamily="mono"
            leftIcon={<Icon as={Trash2} w={3.5} h={3.5} />}
            _hover={{ bg: "rgba(255,49,49,0.25)" }}
            isDisabled={!!host.disabled_at || deleting}
            onClick={() => setConfirmDelete(true)}
          >
            Disable
          </Button>
        </HStack>
      </Flex>

      {/* ── Action error banner ─────────────────────────────────────────── */}
      {loadError ? (
        <Box
          bg="rgba(255,49,49,0.08)"
          border="1px solid"
          borderColor="rgba(255,49,49,0.3)"
          borderRadius="md"
          px={4}
          py={3}
        >
          <Text
            fontFamily="mono"
            fontSize="10px"
            fontWeight="bold"
            color="#FF3131"
            letterSpacing="widest"
            textTransform="uppercase"
            mb={1}
          >
            Action failed
          </Text>
          <Text fontSize="sm" color="obsidian.onSurfaceVariant">
            {loadError}
          </Text>
        </Box>
      ) : null}

      {/* ── Two-column: Connection + Detected OS ──────────────────────── */}
      <Grid templateColumns={{ base: "1fr", lg: "65fr 35fr" }} gap={4}>
        {/* Connection card */}
        <GridItem>
          <ObsidianCard>
            <CardHeader
              icon={<Icon as={Server} w={3.5} h={3.5} color="obsidian.cyan" />}
              title="Connection"
              subtitle="SSH target, authentication and host identity."
            />
            <Grid
              templateColumns={{ base: "1fr", sm: "1fr 1fr" }}
              gap={4}
              p={5}
            >
              <DetailRow
                label={HOST_DETAIL_FIELD_LABELS.hostname_or_ip}
                value={`${host.hostname_or_ip}:${host.ssh_port}`}
              />
              <DetailRow
                label={HOST_DETAIL_FIELD_LABELS.username}
                value={host.username}
              />
              <DetailRow
                label={HOST_DETAIL_FIELD_LABELS.auth_method}
                value={authMethodLabel(host.auth_method)}
              />
              <DetailRow
                label={HOST_DETAIL_FIELD_LABELS.sudo_mode}
                value={sudoModeLabel(host.sudo_mode)}
              />
              <DetailRow
                label={HOST_DETAIL_FIELD_LABELS.credential_id}
                value={host.credential_id ?? "—"}
              />
              <DetailRow
                label={HOST_DETAIL_FIELD_LABELS.host_key_algorithm}
                value={host.host_key_algorithm ?? "—"}
              />
              <DetailRow
                label={HOST_DETAIL_FIELD_LABELS.host_key_fingerprint}
                value={host.host_key_fingerprint ?? "not verified yet"}
              />
              <DetailRow
                label={HOST_DETAIL_FIELD_LABELS.last_seen_at}
                value={formatRelative(host.last_seen_at)}
              />
            </Grid>
          </ObsidianCard>
        </GridItem>

        {/* Detected OS card */}
        <GridItem>
          <ObsidianCard>
            <CardHeader
              icon={
                <Icon as={ShieldCheck} w={3.5} h={3.5} color="obsidian.cyan" />
              }
              title="Detected OS"
              subtitle={
                host.last_seen_at
                  ? `Last refreshed ${formatRelative(host.last_seen_at)}`
                  : "No detection run yet."
              }
            />
            <Grid
              templateColumns="1fr 1fr"
              gap={4}
              p={5}
            >
              <DetailRow
                label={HOST_DETAIL_FIELD_LABELS.os_name}
                value={host.os_name ?? "—"}
              />
              <DetailRow
                label={HOST_DETAIL_FIELD_LABELS.os_version}
                value={host.os_version ?? "—"}
              />
              <DetailRow
                label={HOST_DETAIL_FIELD_LABELS.arch}
                value={host.arch ?? "—"}
              />
              <DetailRow
                label={HOST_DETAIL_FIELD_LABELS.package_manager}
                value={host.package_manager ?? "—"}
              />
              <DetailRow
                label={HOST_DETAIL_FIELD_LABELS.cpu_cores}
                value={host.cpu_cores != null ? `${host.cpu_cores} cores` : "—"}
              />
              <DetailRow
                label={HOST_DETAIL_FIELD_LABELS.ram_mb}
                value={formatBytes(host.ram_mb)}
              />
              <DetailRow
                label={HOST_DETAIL_FIELD_LABELS.disk_total_mb}
                value={formatBytes(host.disk_total_mb)}
              />
              <DetailRow
                label={HOST_DETAIL_FIELD_LABELS.risk_level}
                value={host.risk_level ?? "—"}
              />
            </Grid>
          </ObsidianCard>
        </GridItem>
      </Grid>

      {/* ── Connection test card ────────────────────────────────────────── */}
      <ObsidianCard>
        <CardHeader
          icon={<Icon as={Zap} w={3.5} h={3.5} color="obsidian.cyan" />}
          title="Connection test"
          subtitle="Probe the host over SSH to verify reachability, host key, and authentication. Secrets are not displayed in the result."
        />
        <VStack align="start" spacing={4} p={5}>
          <HStack spacing={3} flexWrap="wrap">
            <Button
              size="sm"
              bg="rgba(0,240,255,0.12)"
              color="obsidian.cyan"
              border="1px solid"
              borderColor="rgba(0,240,255,0.3)"
              fontFamily="mono"
              leftIcon={
                testing ? (
                  <Spinner size="xs" color="obsidian.cyan" />
                ) : (
                  <Icon as={Power} w={3.5} h={3.5} />
                )
              }
              _hover={{ bg: "rgba(0,240,255,0.22)" }}
              isDisabled={testing || !!host.disabled_at}
              onClick={runConnectionTest}
            >
              {testing ? "Testing…" : "Run connection test"}
            </Button>
            {host.disabled_at ? (
              <Text fontSize="xs" color="obsidian.onSurfaceVariant" fontFamily="mono">
                Disabled hosts cannot be tested.
              </Text>
            ) : null}
          </HStack>

          {/* Test result */}
          {testResult ? (
            <Box
              w="full"
              bg={
                testResult.ok
                  ? "rgba(57,255,20,0.06)"
                  : "rgba(255,49,49,0.08)"
              }
              border="1px solid"
              borderColor={
                testResult.ok
                  ? "rgba(57,255,20,0.25)"
                  : "rgba(255,49,49,0.3)"
              }
              borderRadius="md"
              p={4}
            >
              <HStack spacing={2} mb={2}>
                <Icon
                  as={testResult.ok ? CheckCircle2 : XCircle}
                  w={4}
                  h={4}
                  color={testResult.ok ? "#39FF14" : "#FF3131"}
                />
                <Text
                  fontFamily="mono"
                  fontSize="xs"
                  fontWeight="bold"
                  color={testResult.ok ? "#39FF14" : "#FF3131"}
                  letterSpacing="wide"
                >
                  {testResult.ok ? "Connection succeeded" : "Connection failed"}
                </Text>
              </HStack>
              <Text fontSize="sm" color="obsidian.onSurfaceVariant" mb={3}>
                {testResult.message}
              </Text>
              <Grid
                templateColumns={{ base: "1fr", sm: "1fr 1fr" }}
                gap={2}
              >
                <DetailRow label="Reached" value={testResult.reached ? "yes" : "no"} />
                <DetailRow
                  label="Authenticated"
                  value={testResult.authenticated ? "yes" : "no"}
                />
                <DetailRow
                  label="Latency"
                  value={
                    testResult.latency_ms != null
                      ? `${testResult.latency_ms} ms`
                      : "—"
                  }
                />
                <DetailRow
                  label="Host key"
                  value={
                    testResult.host_key_fingerprint ??
                    host.host_key_fingerprint ??
                    "—"
                  }
                />
              </Grid>
              <Text
                mt={3}
                fontSize="10px"
                color="obsidian.onSurfaceVariant"
                fontFamily="mono"
              >
                Tested at {new Date(testResult.tested_at).toLocaleString()}
              </Text>
            </Box>
          ) : null}
        </VStack>
      </ObsidianCard>

      {/* ── Metadata card ──────────────────────────────────────────────── */}
      <ObsidianCard>
        <CardHeader
          icon={<Icon as={Tag} w={3.5} h={3.5} color="obsidian.cyan" />}
          title="Metadata"
          subtitle="Tags, provider, and free-form notes."
        />
        <VStack align="start" spacing={4} p={5}>
          {/* Tags */}
          <Box w="full">
            <Text
              fontSize="10px"
              fontWeight="bold"
              color="obsidian.onSurfaceVariant"
              fontFamily="mono"
              letterSpacing="widest"
              textTransform="uppercase"
              mb={2}
            >
              Tags
            </Text>
            <HStack flexWrap="wrap" spacing={2}>
              {host.tags.length > 0 ? (
                host.tags.map((tag) => (
                  <Box
                    key={tag}
                    px={2}
                    py={0.5}
                    borderRadius="sm"
                    bg="rgba(0,240,255,0.08)"
                    border="1px solid"
                    borderColor="rgba(0,240,255,0.2)"
                  >
                    <Text
                      fontSize="11px"
                      fontFamily="mono"
                      color="obsidian.cyan"
                    >
                      {tag}
                    </Text>
                  </Box>
                ))
              ) : (
                <Text fontSize="sm" fontFamily="mono" color="obsidian.onSurfaceVariant">
                  —
                </Text>
              )}
            </HStack>
          </Box>

          {/* Provider / Region / Timestamps */}
          <Grid
            templateColumns={{ base: "1fr", sm: "1fr 1fr" }}
            gap={4}
            w="full"
          >
            <DetailRow
              label={HOST_DETAIL_FIELD_LABELS.provider}
              value={host.provider ?? "—"}
            />
            <DetailRow
              label={HOST_DETAIL_FIELD_LABELS.region}
              value={host.region ?? "—"}
            />
            <DetailRow
              label={HOST_DETAIL_FIELD_LABELS.created_at}
              value={formatRelative(host.created_at)}
            />
            <DetailRow
              label={HOST_DETAIL_FIELD_LABELS.updated_at}
              value={formatRelative(host.updated_at)}
            />
          </Grid>

          <Divider borderColor="obsidian.border" />

          {/* Notes */}
          <Box w="full">
            <Text
              fontSize="10px"
              fontWeight="bold"
              color="obsidian.onSurfaceVariant"
              fontFamily="mono"
              letterSpacing="widest"
              textTransform="uppercase"
              mb={2}
            >
              Notes
            </Text>
            <Text
              fontSize="sm"
              color={host.notes?.trim() ? "white" : "obsidian.onSurfaceVariant"}
              fontFamily="mono"
              whiteSpace="pre-wrap"
            >
              {host.notes?.trim() ? host.notes : "No notes recorded."}
            </Text>
          </Box>
        </VStack>
      </ObsidianCard>

      {/* ── Credential reference card ──────────────────────────────────── */}
      <ObsidianCard>
        <CardHeader
          icon={<Icon as={KeyRound} w={3.5} h={3.5} color="obsidian.cyan" />}
          title="Credential reference"
          subtitle="VMAN only stores a reference to the credential entry; the underlying secret is sealed in the encrypted vault."
        />
        <Box p={5}>
          <Box
            bg="#0E0E10"
            border="1px solid"
            borderColor="obsidian.border"
            borderRadius="sm"
            px={3}
            py={2}
            wordBreak="break-all"
          >
            <Text fontSize="xs" fontFamily="mono" color="obsidian.onSurface">
              {host.credential_id ?? "no credential attached"}
            </Text>
          </Box>
          {isProduction ? (
            <Text mt={2} fontSize="xs" color="#F59E0B" fontFamily="mono">
              Production host: jobs that touch this machine require extra
              approval.
            </Text>
          ) : null}
        </Box>
      </ObsidianCard>

      {/* ── Disable confirm modal ───────────────────────────────────────── */}
      {confirmDelete ? (
        <DisableModal
          host={host}
          deleting={deleting}
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      ) : null}
    </VStack>
  );
}

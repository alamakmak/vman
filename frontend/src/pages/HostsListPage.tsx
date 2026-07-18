import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Server,
  Plus,
  Filter,
  Columns,
  Search,
  RefreshCcw,
  Terminal,
  Trash2,
  ChevronRight,
  Cpu,
  Activity,
  XCircle,
} from "lucide-react";
import {
  Box,
  Flex,
  Text,
  Heading,
  Button,
  Input,
  InputGroup,
  InputLeftElement,
  Badge,
  Icon,
  Spinner,
  HStack,
  VStack,
  Tooltip,
  IconButton,
  useToast,
} from "@chakra-ui/react";
import { ApiError } from "@/lib/api";
import { HostApiError, listHosts, deleteHost } from "@/lib/hostsApi";
import {
  authMethodLabel,
  describeOs,
  environmentLabel,
  type Host,
} from "@/lib/hosts";

// ─── helpers ───────────────────────────────────────────────────────────────

function getStatusInfo(host: Host): { color: string; label: string; dot: string } {
  if (host.disabled_at) return { color: "#FF3131", label: "Disabled", dot: "#FF3131" };
  if (!host.last_seen_at) return { color: "#6B7280", label: "Never seen", dot: "#6B7280" };
  const ageHours = (Date.now() - new Date(host.last_seen_at).getTime()) / 3_600_000;
  if (ageHours < 24) return { color: "#39FF14", label: "Online", dot: "#39FF14" };
  if (ageHours < 24 * 7) return { color: "#F59E0B", label: "Stale", dot: "#F59E0B" };
  return { color: "#FF3131", label: "Unreachable", dot: "#FF3131" };
}

function getEnvStyle(env: Host["environment"]): { bg: string; color: string; border: string } {
  if (env === "production") return { bg: "rgba(239,68,68,0.12)", color: "#F87171", border: "rgba(239,68,68,0.25)" };
  if (env === "staging") return { bg: "rgba(0,240,255,0.10)", color: "#00F0FF", border: "rgba(0,240,255,0.25)" };
  return { bg: "rgba(107,114,128,0.15)", color: "#9CA3AF", border: "rgba(107,114,128,0.25)" };
}

function OsIcon({ os }: { os: string }) {
  const label = os.toLowerCase();
  if (label.includes("ubuntu")) return <Text fontSize="14px">🟠</Text>;
  if (label.includes("debian")) return <Text fontSize="14px">🔴</Text>;
  if (label.includes("alpine")) return <Text fontSize="14px">🔵</Text>;
  if (label.includes("centos") || label.includes("rhel")) return <Text fontSize="14px">🟣</Text>;
  if (label.includes("windows")) return <Text fontSize="14px">🪟</Text>;
  return <Icon as={Cpu} w={3.5} h={3.5} color="obsidian.onSurfaceVariant" />;
}

// ─── Delete confirm modal ──────────────────────────────────────────────────

function DeleteModal({
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
      bg="rgba(0,0,0,0.7)"
      display="flex"
      alignItems="center"
      justifyContent="center"
      p={4}
    >
      <Box
        bg="obsidian.surface"
        border="1px solid"
        borderColor="obsidian.border"
        borderRadius="lg"
        p={6}
        w="full"
        maxW="420px"
        boxShadow="0 0 40px rgba(0,0,0,0.6)"
      >
        <HStack spacing={3} mb={3}>
          <Icon as={XCircle} color="#FF3131" w={5} h={5} />
          <Text fontWeight="bold" color="white" fontSize="sm">
            Disable {host.name}?
          </Text>
        </HStack>
        <Text fontSize="xs" color="obsidian.onSurfaceVariant" mb={6}>
          Soft-delete keeps the audit trail but marks the host as disabled. Jobs in flight may still reference it.
        </Text>
        <HStack justify="flex-end" spacing={3}>
          <Button
            size="sm"
            variant="outline"
            borderColor="obsidian.border"
            color="white"
            fontFamily="mono"
            fontSize="xs"
            _hover={{ borderColor: "obsidian.cyan" }}
            onClick={onCancel}
            isDisabled={deleting}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            bg="rgba(239,68,68,0.15)"
            color="#F87171"
            border="1px solid rgba(239,68,68,0.3)"
            fontFamily="mono"
            fontSize="xs"
            _hover={{ bg: "rgba(239,68,68,0.25)" }}
            onClick={onConfirm}
            isLoading={deleting}
          >
            Disable Host
          </Button>
        </HStack>
      </Box>
    </Box>
  );
}

// ─── Main component ────────────────────────────────────────────────────────

export function HostsListPage() {
  const navigate = useNavigate();
  const toast = useToast();

  const [hosts, setHosts] = useState<Host[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showDisabled, setShowDisabled] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Host | null>(null);
  const [deleting, setDeleting] = useState(false);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await listHosts({ includeDisabled: showDisabled });
      setHosts(rows);
    } catch (err) {
      const msg =
        err instanceof HostApiError
          ? err.detail
          : err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Failed to load hosts.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, [showDisabled]); // eslint-disable-line

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return hosts;
    return hosts.filter(
      (h) =>
        h.name.toLowerCase().includes(q) ||
        h.hostname_or_ip.toLowerCase().includes(q) ||
        h.username.toLowerCase().includes(q) ||
        (h.provider ?? "").toLowerCase().includes(q) ||
        h.tags.some((t) => t.toLowerCase().includes(q)),
    );
  }, [hosts, search]);

  const handleDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await deleteHost(pendingDelete.id);
      setPendingDelete(null);
      await refresh();
      toast({ title: "Host disabled", status: "success", duration: 3000, isClosable: true });
    } catch (err) {
      const msg =
        err instanceof HostApiError ? err.detail : err instanceof Error ? err.message : "Failed to delete host.";
      setError(msg);
    } finally {
      setDeleting(false);
    }
  };

  // Stats
  const onlineCount = hosts.filter((h) => {
    if (!h.last_seen_at || h.disabled_at) return false;
    return (Date.now() - new Date(h.last_seen_at).getTime()) / 3_600_000 < 24;
  }).length;

  return (
    <Flex direction="column" gap={6}>
      {/* ── Page header ── */}
      <Flex justify="space-between" align="flex-end" wrap="wrap" gap={3}>
        <VStack align="start" spacing={0.5}>
          <Heading as="h1" size="lg" color="white" fontWeight="bold" letterSpacing="-0.02em">
            Fleet Hosts
          </Heading>
          <Text fontSize="sm" color="obsidian.onSurfaceVariant">
            Manage and monitor your connected infrastructure nodes.
          </Text>
        </VStack>
        <Button
          leftIcon={<Icon as={Plus} w={4} h={4} />}
          bg="obsidian.cyan"
          color="black"
          fontFamily="mono"
          fontSize="xs"
          fontWeight="bold"
          px={5}
          h="36px"
          borderRadius="md"
          _hover={{ bg: "cyan.300" }}
          _active={{ transform: "scale(0.97)" }}
          onClick={() => navigate("/hosts/new")}
        >
          Add Host
        </Button>
      </Flex>

      {/* ── Telemetry banner ── */}
      <Box
        bg="linear-gradient(135deg, #0E1117 0%, #111318 100%)"
        border="1px solid"
        borderColor="obsidian.border"
        borderRadius="md"
        p={5}
        position="relative"
        overflow="hidden"
      >
        {/* Glow accent */}
        <Box
          position="absolute"
          top={0}
          left={0}
          right={0}
          h="1px"
          bg="linear-gradient(90deg, transparent, rgba(0,240,255,0.4), transparent)"
        />
        <Flex align="center" justify="space-between" wrap="wrap" gap={4}>
          <VStack align="start" spacing={0.5}>
            <HStack spacing={2}>
              <Icon as={Activity} color="obsidian.cyan" w={4} h={4} />
              <Text fontSize="sm" fontWeight="bold" color="white" fontFamily="mono" letterSpacing="wider">
                Global Fleet Telemetry
              </Text>
            </HStack>
            <HStack spacing={4} mt={1}>
              <HStack spacing={1.5}>
                <Box w={1.5} h={1.5} borderRadius="full" bg="#39FF14" />
                <Text fontSize="xs" color="obsidian.onSurfaceVariant" fontFamily="mono">
                  Nodes Active:{" "}
                  <Text as="span" color="white" fontWeight="bold">
                    {onlineCount}
                  </Text>
                </Text>
              </HStack>
              <HStack spacing={1.5}>
                <Box w={1.5} h={1.5} borderRadius="full" bg="obsidian.cyan" />
                <Text fontSize="xs" color="obsidian.onSurfaceVariant" fontFamily="mono">
                  Total Hosts:{" "}
                  <Text as="span" color="white" fontWeight="bold">
                    {hosts.length}
                  </Text>
                </Text>
              </HStack>
            </HStack>
          </VStack>
          <Button
            leftIcon={<Icon as={RefreshCcw} w={3.5} h={3.5} />}
            size="sm"
            variant="outline"
            borderColor="obsidian.border"
            color="obsidian.onSurfaceVariant"
            fontFamily="mono"
            fontSize="xs"
            h="32px"
            _hover={{ borderColor: "obsidian.cyan", color: "obsidian.cyan" }}
            onClick={refresh}
            isLoading={loading}
          >
            Refresh
          </Button>
        </Flex>
      </Box>

      {/* ── Error banner ── */}
      {error && (
        <Box
          bg="rgba(239,68,68,0.08)"
          border="1px solid rgba(239,68,68,0.25)"
          borderRadius="md"
          p={3}
          fontSize="xs"
          color="#F87171"
          fontFamily="mono"
        >
          ⚠ {error}
        </Box>
      )}

      {/* ── Table card ── */}
      <Box
        bg="obsidian.surface"
        border="1px solid"
        borderColor="obsidian.border"
        borderRadius="md"
        overflow="hidden"
      >
        {/* Toolbar */}
        <Flex
          px={5}
          py={3}
          borderBottom="1px solid"
          borderColor="obsidian.border"
          justify="space-between"
          align="center"
          wrap="wrap"
          gap={3}
          bg="#0E0E10"
        >
          <HStack spacing={2}>
            <Button
              leftIcon={<Icon as={Filter} w={3.5} h={3.5} />}
              size="xs"
              variant="outline"
              borderColor="obsidian.border"
              color={showDisabled ? "obsidian.cyan" : "obsidian.onSurfaceVariant"}
              fontFamily="mono"
              fontSize="10px"
              h="28px"
              px={3}
              _hover={{ borderColor: "obsidian.cyan", color: "obsidian.cyan" }}
              onClick={() => setShowDisabled((v) => !v)}
            >
              Filter
            </Button>
            <Button
              leftIcon={<Icon as={Columns} w={3.5} h={3.5} />}
              size="xs"
              variant="outline"
              borderColor="obsidian.border"
              color="obsidian.onSurfaceVariant"
              fontFamily="mono"
              fontSize="10px"
              h="28px"
              px={3}
              _hover={{ borderColor: "obsidian.cyan", color: "obsidian.cyan" }}
            >
              Columns
            </Button>
          </HStack>

          <HStack spacing={3}>
            <InputGroup size="sm" w="220px">
              <InputLeftElement pointerEvents="none" h="full">
                <Icon as={Search} w={3.5} h={3.5} color="obsidian.onSurfaceVariant" />
              </InputLeftElement>
              <Input
                placeholder="Search hosts…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                bg="#0A0A0C"
                border="1px solid"
                borderColor="obsidian.border"
                color="white"
                fontSize="xs"
                fontFamily="mono"
                h="28px"
                _placeholder={{ color: "obsidian.onSurfaceVariant" }}
                _focus={{ borderColor: "obsidian.cyan", boxShadow: "none" }}
                autoComplete="off"
              />
            </InputGroup>
            {filtered.length > 0 && (
              <Text fontSize="10px" color="obsidian.onSurfaceVariant" fontFamily="mono" whiteSpace="nowrap">
                Showing 1–{filtered.length} of {hosts.length}
              </Text>
            )}
          </HStack>
        </Flex>

        {/* Table */}
        {loading ? (
          <Flex align="center" justify="center" py={16}>
            <Spinner size="lg" color="obsidian.cyan" thickness="3px" />
          </Flex>
        ) : filtered.length === 0 ? (
          <Flex direction="column" align="center" justify="center" py={16} gap={3}>
            <Icon as={Server} w={8} h={8} color="obsidian.onSurfaceVariant" opacity={0.4} />
            <Text fontSize="sm" color="obsidian.onSurfaceVariant" fontFamily="mono">
              {hosts.length === 0 ? "No hosts yet. Add your first host." : "No hosts match your search."}
            </Text>
            {hosts.length === 0 && (
              <Button
                size="sm"
                bg="obsidian.cyan"
                color="black"
                fontFamily="mono"
                fontSize="xs"
                onClick={() => navigate("/hosts/new")}
              >
                + Add Host
              </Button>
            )}
          </Flex>
        ) : (
          <Box overflowX="auto" maxW="100%" sx={{ WebkitOverflowScrolling: "touch" }}>
            {/* Table header */}
            <Flex
              px={{ base: 3, md: 5 }}
              py={2.5}
              borderBottom="1px solid"
              borderColor="obsidian.border"
              bg="#0A0A0C"
              minW={{ base: "680px", md: "800px" }}
            >
              {[
                { label: "NAME", w: "18%" },
                { label: "ADDRESS", w: "18%" },
                { label: "USER", w: "10%" },
                { label: "AUTH", w: "10%" },
                { label: "OS", w: "12%" },
                { label: "ENV", w: "12%" },
                { label: "STATUS", w: "12%" },
                { label: "ACTION", w: "8%" },
              ].map((col) => (
                <Box key={col.label} w={col.w} flexShrink={0}>
                  <Text
                    fontSize="10px"
                    fontWeight="bold"
                    color="obsidian.onSurfaceVariant"
                    fontFamily="mono"
                    letterSpacing="widest"
                    textTransform="uppercase"
                  >
                    {col.label}
                  </Text>
                </Box>
              ))}
            </Flex>

            {/* Table rows */}
            {filtered.map((host) => {
              const status = getStatusInfo(host);
              const envStyle = getEnvStyle(host.environment);
              const osLabel = describeOs(host);

              return (
                <Flex
                  key={host.id}
                  px={{ base: 3, md: 5 }}
                  py={3.5}
                  borderBottom="1px solid"
                  borderColor="obsidian.border"
                  align="center"
                  minW={{ base: "680px", md: "800px" }}
                  _hover={{ bg: "rgba(255,255,255,0.02)", cursor: "pointer" }}
                  transition="background 0.15s"
                  onClick={() => navigate(`/hosts/${host.id}`)}
                >
                  {/* NAME */}
                  <Box w="18%" flexShrink={0}>
                    <HStack spacing={2.5}>
                      <Box
                        w="22px"
                        h="22px"
                        borderRadius="4px"
                        bg="rgba(0,240,255,0.08)"
                        border="1px solid rgba(0,240,255,0.15)"
                        display="flex"
                        alignItems="center"
                        justifyContent="center"
                        flexShrink={0}
                      >
                        <Icon as={Server} w={3} h={3} color="obsidian.cyan" />
                      </Box>
                      <VStack align="start" spacing={0}>
                        <Text fontSize="xs" fontWeight="semibold" color="white" fontFamily="mono" lineHeight="tight">
                          {host.name}
                        </Text>
                        {host.tags.length > 0 && (
                          <Text fontSize="9px" color="obsidian.onSurfaceVariant" fontFamily="mono">
                            {host.tags.slice(0, 2).join(", ")}
                          </Text>
                        )}
                      </VStack>
                    </HStack>
                  </Box>

                  {/* ADDRESS */}
                  <Box w="18%" flexShrink={0}>
                    <Text fontSize="xs" fontFamily="mono" color="obsidian.onSurfaceVariant">
                      {host.hostname_or_ip}
                      <Text as="span" color="obsidian.cyan">
                        :{host.ssh_port}
                      </Text>
                    </Text>
                  </Box>

                  {/* USER */}
                  <Box w="10%" flexShrink={0}>
                    <Text fontSize="xs" fontFamily="mono" color="white">
                      {host.username}
                    </Text>
                  </Box>

                  {/* AUTH */}
                  <Box w="10%" flexShrink={0}>
                    <Text fontSize="xs" fontFamily="mono" color="obsidian.onSurfaceVariant">
                      {authMethodLabel(host.auth_method)}
                    </Text>
                  </Box>

                  {/* OS */}
                  <Box w="12%" flexShrink={0}>
                    <HStack spacing={1.5}>
                      <OsIcon os={osLabel} />
                      <Text fontSize="xs" fontFamily="mono" color="obsidian.onSurfaceVariant">
                        {osLabel || "—"}
                      </Text>
                    </HStack>
                  </Box>

                  {/* ENV */}
                  <Box w="12%" flexShrink={0}>
                    <Badge
                      px={2}
                      py={0.5}
                      borderRadius="sm"
                      fontSize="9px"
                      fontFamily="mono"
                      fontWeight="bold"
                      letterSpacing="wider"
                      bg={envStyle.bg}
                      color={envStyle.color}
                      border="1px solid"
                      borderColor={envStyle.border}
                    >
                      {environmentLabel(host.environment).toUpperCase()}
                    </Badge>
                  </Box>

                  {/* STATUS */}
                  <Box w="12%" flexShrink={0}>
                    <HStack spacing={1.5}>
                      <Box
                        w={1.5}
                        h={1.5}
                        borderRadius="full"
                        bg={status.dot}
                        flexShrink={0}
                        boxShadow={status.dot === "#39FF14" ? `0 0 6px ${status.dot}` : "none"}
                      />
                      <Text fontSize="xs" fontFamily="mono" color={status.color}>
                        {status.label}
                      </Text>
                    </HStack>
                  </Box>

                  {/* ACTION */}
                  <Box w="8%" flexShrink={0}>
                    <HStack spacing={1} onClick={(e) => e.stopPropagation()}>
                      <Tooltip label="Open terminal" placement="top" hasArrow>
                        <IconButton
                          aria-label="terminal"
                          icon={<Icon as={Terminal} w={3.5} h={3.5} />}
                          size="xs"
                          variant="ghost"
                          color="obsidian.onSurfaceVariant"
                          _hover={{ color: "obsidian.cyan", bg: "rgba(0,240,255,0.08)" }}
                          onClick={() => navigate(`/terminal?host=${host.id}`)}
                        />
                      </Tooltip>
                      <Tooltip label="Disable host" placement="top" hasArrow>
                        <IconButton
                          aria-label="delete"
                          icon={<Icon as={Trash2} w={3.5} h={3.5} />}
                          size="xs"
                          variant="ghost"
                          color="obsidian.onSurfaceVariant"
                          _hover={{ color: "#F87171", bg: "rgba(239,68,68,0.08)" }}
                          onClick={() => setPendingDelete(host)}
                        />
                      </Tooltip>
                      <IconButton
                        aria-label="open"
                        icon={<Icon as={ChevronRight} w={3.5} h={3.5} />}
                        size="xs"
                        variant="ghost"
                        color="obsidian.onSurfaceVariant"
                        _hover={{ color: "white", bg: "rgba(255,255,255,0.05)" }}
                        onClick={() => navigate(`/hosts/${host.id}`)}
                      />
                    </HStack>
                  </Box>
                </Flex>
              );
            })}
          </Box>
        )}
      </Box>

      {/* ── Delete modal ── */}
      {pendingDelete && (
        <DeleteModal
          host={pendingDelete}
          deleting={deleting}
          onConfirm={handleDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </Flex>
  );
}

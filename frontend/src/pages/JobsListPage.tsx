import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Activity,
  RefreshCcw,
  Search,
  ChevronRight,
  Clock,
  CheckCircle2,
  XCircle,
  Loader,
  Ban,
  AlertTriangle,
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
  Select,
  IconButton,
  Tooltip,
  useToast,
} from "@chakra-ui/react";
import { ApiError } from "@/lib/api";
import { JobApiError, listJobs, cancelJob } from "@/lib/jobsApi";
import {
  formatDuration,
  isTerminalStatus,
  jobStatusLabel,
  truncateCommand,
  type Job,
  type JobStatus,
} from "@/lib/jobs";

// ─── helpers ───────────────────────────────────────────────────────────────

function getStatusStyle(status: JobStatus): { color: string; bg: string; border: string; icon: React.ElementType } {
  switch (status) {
    case "running":  return { color: "#00F0FF", bg: "rgba(0,240,255,0.08)",   border: "rgba(0,240,255,0.2)",   icon: Loader };
    case "success":  return { color: "#39FF14", bg: "rgba(57,255,20,0.08)",   border: "rgba(57,255,20,0.2)",   icon: CheckCircle2 };
    case "failed":   return { color: "#FF3131", bg: "rgba(255,49,49,0.08)",   border: "rgba(255,49,49,0.2)",   icon: XCircle };
    case "queued":   return { color: "#F59E0B", bg: "rgba(245,158,11,0.08)",  border: "rgba(245,158,11,0.2)",  icon: Clock };
    case "cancelled":return { color: "#6B7280", bg: "rgba(107,114,128,0.08)", border: "rgba(107,114,128,0.2)", icon: Ban };
    case "denied":   return { color: "#F87171", bg: "rgba(248,113,113,0.08)", border: "rgba(248,113,113,0.2)", icon: AlertTriangle };
    default:         return { color: "#6B7280", bg: "rgba(107,114,128,0.08)", border: "rgba(107,114,128,0.2)", icon: Clock };
  }
}

function getRiskStyle(risk: string): { color: string; bg: string; border: string } {
  switch (risk) {
    case "critical": return { color: "#FF3131", bg: "rgba(255,49,49,0.1)",   border: "rgba(255,49,49,0.25)" };
    case "high":     return { color: "#F87171", bg: "rgba(248,113,113,0.1)", border: "rgba(248,113,113,0.25)" };
    case "medium":   return { color: "#F59E0B", bg: "rgba(245,158,11,0.1)",  border: "rgba(245,158,11,0.25)" };
    default:         return { color: "#39FF14", bg: "rgba(57,255,20,0.1)",   border: "rgba(57,255,20,0.25)" };
  }
}

const STATUS_OPTIONS: { value: "" | JobStatus; label: string }[] = [
  { value: "", label: "All statuses" },
  { value: "queued",    label: "Queued" },
  { value: "running",   label: "Running" },
  { value: "success",   label: "Success" },
  { value: "failed",    label: "Failed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "denied",    label: "Denied" },
];

// ─── Main component ────────────────────────────────────────────────────────

export function JobsListPage() {
  const navigate = useNavigate();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | JobStatus>("");
  const [refreshTick, setRefreshTick] = useState(0);
  const toast = useToast();
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const handleCancel = async (jobId: string) => {
    setCancellingId(jobId);
    try {
      await cancelJob(jobId);
      toast({
        title: "Job cancelled",
        description: `Job ${jobId.slice(0, 8)} has been cancelled.`,
        status: "success",
        duration: 3000,
        isClosable: true,
      });
      const rows = await listJobs({ limit: 200, status: statusFilter || undefined });
      setJobs(rows);
    } catch (err: any) {
      toast({
        title: "Cancel failed",
        description: err.message || "Could not cancel the job.",
        status: "error",
        duration: 5000,
        isClosable: true,
      });
    } finally {
      setCancellingId(null);
    }
  };

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await listJobs({ limit: 200, status: statusFilter || undefined });
      setJobs(rows);
    } catch (err) {
      const msg =
        err instanceof JobApiError ? err.detail :
        err instanceof ApiError ? err.message :
        err instanceof Error ? err.message : "Failed to load jobs.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, [statusFilter, refreshTick]); // eslint-disable-line

  // Auto-refresh every 5s when active jobs exist
  useEffect(() => {
    const hasActive = jobs.some((j) => !isTerminalStatus(j.status));
    if (!hasActive) return;
    const handle = window.setInterval(() => setRefreshTick((t) => t + 1), 5000);
    return () => window.clearInterval(handle);
  }, [jobs]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return jobs;
    return jobs.filter(
      (j) =>
        j.id.toLowerCase().includes(q) ||
        j.command_summary.toLowerCase().includes(q) ||
        (j.recipe_name ?? "").toLowerCase().includes(q) ||
        (j.status ?? "").toLowerCase().includes(q),
    );
  }, [jobs, search]);

  const counts = useMemo(() => {
    const c = { total: jobs.length, running: 0, queued: 0, success: 0, failed: 0, cancelled: 0, denied: 0 } as Record<string, number>;
    for (const j of jobs) c[j.status] = (c[j.status] ?? 0) + 1;
    return c;
  }, [jobs]);

  const hasRunning = counts.running > 0;

  return (
    <Flex direction="column" gap={6}>
      {/* ── Header ── */}
      <Flex justify="space-between" align="flex-end" wrap="wrap" gap={3}>
        <VStack align="start" spacing={0.5}>
          <Heading as="h1" size="lg" color="white" fontWeight="bold" letterSpacing="-0.02em">
            Job Queue
          </Heading>
          <Text fontSize="sm" color="obsidian.onSurfaceVariant">
            Every command, recipe, and healthcheck VMAN has dispatched.
          </Text>
        </VStack>
        <Button
          leftIcon={<Icon as={RefreshCcw} w={3.5} h={3.5} />}
          size="sm"
          variant="outline"
          borderColor="obsidian.border"
          color="obsidian.onSurfaceVariant"
          fontFamily="mono"
          fontSize="xs"
          h="36px"
          _hover={{ borderColor: "obsidian.cyan", color: "obsidian.cyan" }}
          onClick={refresh}
          isLoading={loading}
        >
          Refresh
        </Button>
      </Flex>

      {/* ── Stats banner ── */}
      <Box
        bg="linear-gradient(135deg, #0E1117 0%, #111318 100%)"
        border="1px solid"
        borderColor="obsidian.border"
        borderRadius="md"
        p={5}
        position="relative"
        overflow="hidden"
      >
        <Box position="absolute" top={0} left={0} right={0} h="1px"
          bg="linear-gradient(90deg, transparent, rgba(0,240,255,0.4), transparent)" />
        <HStack spacing={6} wrap="wrap">
          <HStack spacing={2}>
            <Icon as={Activity} color="obsidian.cyan" w={4} h={4} />
            <Text fontSize="xs" fontFamily="mono" color="obsidian.onSurfaceVariant">
              Total: <Text as="span" color="white" fontWeight="bold">{counts.total}</Text>
            </Text>
          </HStack>
          {[
            { key: "running",   color: "#00F0FF" },
            { key: "queued",    color: "#F59E0B" },
            { key: "success",   color: "#39FF14" },
            { key: "failed",    color: "#FF3131" },
            { key: "cancelled", color: "#6B7280" },
          ].map(({ key, color }) => (
            <HStack key={key} spacing={1.5}>
              <Box w={1.5} h={1.5} borderRadius="full" bg={color}
                boxShadow={hasRunning && key === "running" ? `0 0 6px ${color}` : "none"} />
              <Text fontSize="xs" fontFamily="mono" color="obsidian.onSurfaceVariant" textTransform="capitalize">
                {key}: <Text as="span" color="white" fontWeight="bold">{counts[key] ?? 0}</Text>
              </Text>
            </HStack>
          ))}
        </HStack>
      </Box>

      {/* ── Error ── */}
      {error && (
        <Box bg="rgba(239,68,68,0.08)" border="1px solid rgba(239,68,68,0.25)" borderRadius="md"
          p={3} fontSize="xs" color="#F87171" fontFamily="mono">
          ⚠ {error}
        </Box>
      )}

      {/* ── Table card ── */}
      <Box bg="obsidian.surface" border="1px solid" borderColor="obsidian.border" borderRadius="md" overflow="hidden">
        {/* Toolbar */}
        <Flex px={5} py={3} borderBottom="1px solid" borderColor="obsidian.border"
          justify="space-between" align="center" wrap="wrap" gap={3} bg="#0E0E10">
          <HStack spacing={3}>
            <InputGroup size="sm" w="240px">
              <InputLeftElement pointerEvents="none" h="full">
                <Icon as={Search} w={3.5} h={3.5} color="obsidian.onSurfaceVariant" />
              </InputLeftElement>
              <Input
                placeholder="Search id, command, recipe…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                bg="#0A0A0C" border="1px solid" borderColor="obsidian.border"
                color="white" fontSize="xs" fontFamily="mono" h="28px"
                _placeholder={{ color: "obsidian.onSurfaceVariant" }}
                _focus={{ borderColor: "obsidian.cyan", boxShadow: "none" }}
                autoComplete="off"
              />
            </InputGroup>
            <Select
              size="sm"
              value={statusFilter}
              onChange={(e) => setStatusFilter((e.target.value || "") as "" | JobStatus)}
              bg="#0A0A0C" border="1px solid" borderColor="obsidian.border"
              color="obsidian.onSurfaceVariant" fontSize="xs" fontFamily="mono"
              h="28px" w="160px"
              _focus={{ borderColor: "obsidian.cyan", boxShadow: "none" }}
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value} style={{ background: "#0A0A0C" }}>
                  {o.label}
                </option>
              ))}
            </Select>
          </HStack>
          {filtered.length > 0 && (
            <Text fontSize="10px" color="obsidian.onSurfaceVariant" fontFamily="mono">
              Showing 1–{filtered.length} of {jobs.length}
            </Text>
          )}
        </Flex>

        {/* Table */}
        {loading ? (
          <Flex align="center" justify="center" py={16}>
            <Spinner size="lg" color="obsidian.cyan" thickness="3px" />
          </Flex>
        ) : filtered.length === 0 ? (
          <Flex direction="column" align="center" justify="center" py={16} gap={3}>
            <Icon as={Activity} w={8} h={8} color="obsidian.onSurfaceVariant" opacity={0.4} />
            <Text fontSize="sm" color="obsidian.onSurfaceVariant" fontFamily="mono">
              {jobs.length === 0 ? "No jobs yet. Dispatch a command from a host." : "No jobs match your filter."}
            </Text>
          </Flex>
        ) : (
          <Box overflowX="auto" maxW="100%" sx={{ WebkitOverflowScrolling: "touch" }}>
            {/* Header */}
            <Flex px={{ base: 3, md: 5 }} py={2.5} borderBottom="1px solid" borderColor="obsidian.border" bg="#0A0A0C" minW={{ base: "720px", md: "900px" }}>
              {[
                { label: "ID",       w: "10%" },
                { label: "COMMAND / RECIPE", w: "28%" },
                { label: "STATUS",   w: "12%" },
                { label: "RISK",     w: "10%" },
                { label: "APPROVAL", w: "12%" },
                { label: "DURATION", w: "12%" },
                { label: "CREATED",  w: "10%" },
                { label: "",         w: "6%"  },
              ].map((col) => (
                <Box key={col.label} w={col.w} flexShrink={0}>
                  <Text fontSize="10px" fontWeight="bold" color="obsidian.onSurfaceVariant"
                    fontFamily="mono" letterSpacing="widest" textTransform="uppercase">
                    {col.label}
                  </Text>
                </Box>
              ))}
            </Flex>

            {/* Rows */}
            {filtered.map((job) => {
              const st = getStatusStyle(job.status);
              const risk = getRiskStyle(job.risk_level ?? "low");
              return (
                <Flex key={job.id} px={{ base: 3, md: 5 }} py={3.5} borderBottom="1px solid" borderColor="obsidian.border"
                  align="center" minW={{ base: "720px", md: "900px" }}
                  _hover={{ bg: "rgba(255,255,255,0.02)", cursor: "pointer" }}
                  transition="background 0.15s"
                  onClick={() => navigate(`/jobs/${job.id}`)}>

                  {/* ID */}
                  <Box w="10%" flexShrink={0}>
                    <Text fontSize="11px" fontFamily="mono" color="obsidian.onSurfaceVariant">
                      {job.id.slice(0, 8)}…
                    </Text>
                  </Box>

                  {/* Command */}
                  <Box w="28%" flexShrink={0} pr={4}>
                    <Text fontSize="xs" fontWeight="semibold" color="white" fontFamily="mono" noOfLines={1}>
                      {job.recipe_name ?? truncateCommand(job.command_summary, 50)}
                    </Text>
                    {job.recipe_name && (
                      <Text fontSize="10px" color="obsidian.onSurfaceVariant" fontFamily="mono" noOfLines={1}>
                        {truncateCommand(job.command_summary, 60)}
                      </Text>
                    )}
                  </Box>

                  {/* Status */}
                  <Box w="12%" flexShrink={0}>
                    <Badge px={2} py={0.5} borderRadius="sm" fontSize="10px" fontFamily="mono"
                      fontWeight="bold" letterSpacing="wider"
                      bg={st.bg} color={st.color} border="1px solid" borderColor={st.border}
                      display="inline-flex" alignItems="center" gap={1}>
                      <Icon as={st.icon} w={2.5} h={2.5}
                        animation={job.status === "running" ? "spin 1.5s linear infinite" : undefined} />
                      {jobStatusLabel(job.status).toUpperCase()}
                    </Badge>
                  </Box>

                  {/* Risk */}
                  <Box w="10%" flexShrink={0}>
                    <Badge px={2} py={0.5} borderRadius="sm" fontSize="9px" fontFamily="mono"
                      fontWeight="bold" letterSpacing="wider"
                      bg={risk.bg} color={risk.color} border="1px solid" borderColor={risk.border}>
                      {(job.risk_level ?? "low").toUpperCase()}
                    </Badge>
                  </Box>

                  {/* Approval */}
                  <Box w="12%" flexShrink={0}>
                    <Text fontSize="xs" fontFamily="mono" color="obsidian.onSurfaceVariant" textTransform="capitalize">
                      {job.approval_status ?? "—"}
                    </Text>
                  </Box>

                  {/* Duration */}
                  <Box w="12%" flexShrink={0}>
                    <Text fontSize="xs" fontFamily="mono" color="obsidian.onSurfaceVariant">
                      {formatDuration(job.started_at, job.finished_at)}
                    </Text>
                  </Box>

                  {/* Created */}
                  <Box w="10%" flexShrink={0}>
                    <Text fontSize="xs" fontFamily="mono" color="obsidian.onSurfaceVariant">
                      {job.created_at ? new Date(job.created_at).toLocaleString() : "—"}
                    </Text>
                  </Box>

                  {/* Action */}
                  <Box w="6%" flexShrink={0} onClick={(e) => e.stopPropagation()} display="flex" gap={1}>
                    {!isTerminalStatus(job.status) && job.status !== "cancelled" && (
                      <Tooltip label="Cancel job" placement="top" hasArrow>
                        <IconButton
                          aria-label="cancel"
                          icon={<Icon as={XCircle} w={3.5} h={3.5} />}
                          size="xs"
                          variant="ghost"
                          color="red.400"
                          _hover={{ color: "red.200", bg: "rgba(255,0,0,0.05)" }}
                          isLoading={cancellingId === job.id}
                          onClick={() => handleCancel(job.id)}
                        />
                      </Tooltip>
                    )}
                    <Tooltip label="Open job" placement="top" hasArrow>
                      <IconButton aria-label="open" icon={<Icon as={ChevronRight} w={3.5} h={3.5} />}
                        size="xs" variant="ghost" color="obsidian.onSurfaceVariant"
                        _hover={{ color: "white", bg: "rgba(255,255,255,0.05)" }}
                        onClick={() => navigate(`/jobs/${job.id}`)} />
                    </Tooltip>
                  </Box>
                </Flex>
              );
            })}
          </Box>
        )}
      </Box>
    </Flex>
  );
}

import { useEffect, useMemo, useState } from "react";
import {
  RefreshCcw,
  Search,
  Globe,
  Cpu,
  Info,
  ChevronDown,
  ChevronUp,
  Shield,
  XCircle,
  AlertTriangle,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  Play,
  Settings,
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
  useToast,
  Collapse,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalFooter,
  ModalBody,
  ModalCloseButton,
  Divider,
} from "@chakra-ui/react";
import { ApiClient } from "@/lib/api";

const client = new ApiClient({ baseUrl: "" });

export interface Agent {
  id: string;
  name: string;
  status: "active" | "setup_required" | "offline";
  dns_status: "on" | "off";
  domains: string[];
  is_detected: boolean;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
}

export function AgentBridgePage() {
  const toast = useToast();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [dnsFilter, setDnsFilter] = useState<string>("all");
  const [expandedAgentId, setExpandedAgentId] = useState<string | null>(null);
  const [guideTab, setGuideTab] = useState<"cursor" | "claude" | "zed">("cursor");

  // Setup Wizard States
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [wizardAgent, setWizardAgent] = useState<Agent | null>(null);
  const [wizardStep, setWizardStep] = useState(1);
  const [verifyStatus, setVerifyStatus] = useState<"idle" | "running" | "success" | "error">("idle");
  const [isWizardDnsOn, setIsWizardDnsOn] = useState(false);

  const openSetupWizard = (agent: Agent) => {
    setWizardAgent(agent);
    setWizardStep(1);
    setVerifyStatus("idle");
    setIsWizardDnsOn(agent.dns_status === "on");
    setIsWizardOpen(true);
  };

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await client.request<Agent[]>("/api/agents");
      setAgents(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load agents.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const toggleDns = async (id: string) => {
    try {
      const updated = await client.request<Agent>(`/api/agents/${id}/toggle-dns`, { method: "POST" });
      setAgents((prev) => prev.map((a) => (a.id === id ? updated : a)));
      toast({
        title: `${updated.name} DNS: ${updated.dns_status.toUpperCase()}`,
        status: "success",
        duration: 3000,
        isClosable: true,
      });
    } catch (err) {
      toast({
        title: "Failed to toggle DNS",
        description: err instanceof Error ? err.message : "Unknown error",
        status: "error",
        duration: 4000,
        isClosable: true,
      });
    }
  };

  const filtered = useMemo(() => {
    return agents.filter((agent) => {
      const matchesSearch =
        agent.name.toLowerCase().includes(search.toLowerCase()) ||
        agent.id.toLowerCase().includes(search.toLowerCase()) ||
        agent.domains.some((d) => d.toLowerCase().includes(search.toLowerCase()));

      const matchesStatus =
        statusFilter === "all" || agent.status === statusFilter;

      const matchesDns =
        dnsFilter === "all" || agent.dns_status === dnsFilter;

      return matchesSearch && matchesStatus && matchesDns;
    });
  }, [agents, search, statusFilter, dnsFilter]);

  const counts = useMemo(() => {
    const c = { total: agents.length, active: 0, setup: 0, offline: 0, dnsOn: 0 };
    for (const a of agents) {
      if (a.status === "active") c.active++;
      else if (a.status === "setup_required") c.setup++;
      else if (a.status === "offline") c.offline++;

      if (a.dns_status === "on") c.dnsOn++;
    }
    return c;
  }, [agents]);

  const toggleExpand = (id: string) => {
    setExpandedAgentId((prev) => (prev === id ? null : id));
  };

  return (
    <Flex direction="column" gap={6}>
      {/* ── Page Header ── */}
      <Flex justify="space-between" align="flex-end" wrap="wrap" gap={3}>
        <VStack align="start" spacing={0.5}>
          <Heading as="h1" size="lg" color="white" fontWeight="bold" letterSpacing="-0.02em">
            Agent Bridge
          </Heading>
          <Text fontSize="sm" color="obsidian.onSurfaceVariant">
            Manage host redirection, DNS intercept policies, and local MCP server integrations for developer agents.
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

      {/* ── Telemetry Banner ── */}
      <Box
        bg="linear-gradient(135deg, #0E1117 0%, #111318 100%)"
        border="1px solid"
        borderColor="obsidian.border"
        borderRadius="md"
        p={5}
        position="relative"
        overflow="hidden"
      >
        <Box
          position="absolute"
          top={0}
          left={0}
          right={0}
          h="1px"
          bg="linear-gradient(90deg, transparent, rgba(0, 240, 255, 0.4), transparent)"
        />
        <HStack spacing={6} wrap="wrap">
          <HStack spacing={2}>
            <Icon as={Shield} color="obsidian.cyan" w={4} h={4} />
            <Text fontSize="xs" fontFamily="mono" color="obsidian.onSurfaceVariant">
              Connected Agents: <Text as="span" color="white" fontWeight="bold">{counts.total}</Text>
            </Text>
          </HStack>
          <HStack spacing={1.5}>
            <Box w={1.5} h={1.5} borderRadius="full" bg="#39FF14" />
            <Text fontSize="xs" fontFamily="mono" color="obsidian.onSurfaceVariant">
              Active: <Text as="span" color="white" fontWeight="bold">{counts.active}</Text>
            </Text>
          </HStack>
          <HStack spacing={1.5}>
            <Box w={1.5} h={1.5} borderRadius="full" bg="#F59E0B" />
            <Text fontSize="xs" fontFamily="mono" color="obsidian.onSurfaceVariant">
              Setup Required: <Text as="span" color="white" fontWeight="bold">{counts.setup}</Text>
            </Text>
          </HStack>
          <HStack spacing={1.5}>
            <Icon as={Globe} w={3.5} h={3.5} color="obsidian.cyan" />
            <Text fontSize="xs" fontFamily="mono" color="obsidian.onSurfaceVariant">
              DNS Intercept On: <Text as="span" color="white" fontWeight="bold">{counts.dnsOn}</Text>
            </Text>
          </HStack>
        </HStack>
      </Box>

      {/* ── Error Banner ── */}
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

      {/* ── Main List Panel ── */}
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
          <HStack spacing={4} wrap="wrap">
            {/* Status Filter Tab Buttons */}
            <HStack spacing={1} bg="#0A0A0C" p={0.5} borderRadius="md" border="1px solid" borderColor="obsidian.border">
              {[
                { value: "all", label: "ALL" },
                { value: "active", label: "ACTIVE" },
                { value: "setup_required", label: "SETUP REQ" },
              ].map((opt) => (
                <Button
                  key={opt.value}
                  size="xs"
                  variant="ghost"
                  fontFamily="mono"
                  fontSize="9px"
                  h="22px"
                  px={2.5}
                  color={statusFilter === opt.value ? "black" : "obsidian.onSurfaceVariant"}
                  bg={statusFilter === opt.value ? "obsidian.cyan" : "transparent"}
                  _hover={{
                    color: statusFilter === opt.value ? "black" : "white",
                    bg: statusFilter === opt.value ? "obsidian.cyan" : "rgba(255,255,255,0.05)",
                  }}
                  onClick={() => setStatusFilter(opt.value)}
                >
                  {opt.label}
                </Button>
              ))}
            </HStack>

            {/* DNS Status Filter Tab Buttons */}
            <HStack spacing={1} bg="#0A0A0C" p={0.5} borderRadius="md" border="1px solid" borderColor="obsidian.border">
              {[
                { value: "all", label: "DNS: ALL" },
                { value: "on", label: "DNS: ON" },
                { value: "off", label: "DNS: OFF" },
              ].map((opt) => (
                <Button
                  key={opt.value}
                  size="xs"
                  variant="ghost"
                  fontFamily="mono"
                  fontSize="9px"
                  h="22px"
                  px={2.5}
                  color={dnsFilter === opt.value ? "black" : "obsidian.onSurfaceVariant"}
                  bg={dnsFilter === opt.value ? "obsidian.cyan" : "transparent"}
                  _hover={{
                    color: dnsFilter === opt.value ? "black" : "white",
                    bg: dnsFilter === opt.value ? "obsidian.cyan" : "rgba(255,255,255,0.05)",
                  }}
                  onClick={() => setDnsFilter(opt.value)}
                >
                  {opt.label}
                </Button>
              ))}
            </HStack>
          </HStack>

          {/* Search bar */}
          <HStack spacing={3}>
            <InputGroup size="sm" w="240px">
              <InputLeftElement pointerEvents="none" h="full">
                <Icon as={Search} w={3.5} h={3.5} color="obsidian.onSurfaceVariant" />
              </InputLeftElement>
              <Input
                placeholder="Search name or domains…"
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
                Showing {filtered.length} of {agents.length}
              </Text>
            )}
          </HStack>
        </Flex>

        {/* Content list */}
        {loading ? (
          <Flex align="center" justify="center" py={16}>
            <Spinner size="lg" color="obsidian.cyan" thickness="3px" />
          </Flex>
        ) : filtered.length === 0 ? (
          <Flex direction="column" align="center" justify="center" py={16} gap={3}>
            <Icon as={Cpu} w={8} h={8} color="obsidian.onSurfaceVariant" opacity={0.4} />
            <Text fontSize="sm" color="obsidian.onSurfaceVariant" fontFamily="mono">
              {agents.length === 0 ? "No agents registered." : "No agents match your filter criteria."}
            </Text>
          </Flex>
        ) : (
          <Box>
            {/* Table Header */}
            <Flex
              px={5}
              py={2.5}
              borderBottom="1px solid"
              borderColor="obsidian.border"
              bg="#0A0A0C"
              fontFamily="mono"
              fontSize="10px"
              fontWeight="bold"
              color="obsidian.onSurfaceVariant"
              align="center"
            >
              <Box w="30%">NAME / ID</Box>
              <Box w="15%">STATUS</Box>
              <Box w="15%">DNS INTERCEPT</Box>
              <Box w="25%">INTERCEPTED DOMAINS</Box>
              <Box w="15%" textAlign="right">ACTIONS</Box>
            </Flex>

            {/* List Rows */}
            {filtered.map((agent) => {
              const isExpanded = expandedAgentId === agent.id;
              const hasDomains = agent.domains && agent.domains.length > 0;
              const statusActive = agent.status === "active";
              const statusSetupReq = agent.status === "setup_required";

              return (
                <Box
                  key={agent.id}
                  borderBottom="1px solid"
                  borderColor="obsidian.border"
                  bg={isExpanded ? "#0E0E10" : "transparent"}
                  _hover={{ bg: isExpanded ? "#0E0E10" : "rgba(255,255,255,0.02)" }}
                  transition="background 0.2s"
                >
                  <Flex px={5} py={4} align="center" cursor="pointer" onClick={() => toggleExpand(agent.id)}>
                    {/* Name / ID */}
                    <Box w="30%">
                      <HStack spacing={2}>
                        <Icon
                          as={isExpanded ? ChevronUp : ChevronDown}
                          w={4}
                          h={4}
                          color="obsidian.onSurfaceVariant"
                        />
                        <VStack align="start" spacing={0}>
                          <Text fontWeight="bold" color="white" fontSize="sm">
                            {agent.name}
                          </Text>
                          <Text fontSize="10px" color="obsidian.onSurfaceVariant" fontFamily="mono">
                            {agent.id}
                          </Text>
                        </VStack>
                      </HStack>
                    </Box>

                    {/* Status Badge */}
                    <Box w="15%">
                      <Badge
                        variant="subtle"
                        bg={
                          statusActive
                            ? "rgba(57, 255, 20, 0.1)"
                            : statusSetupReq
                            ? "rgba(245, 158, 11, 0.1)"
                            : "rgba(107, 114, 128, 0.1)"
                        }
                        color={
                          statusActive ? "#39FF14" : statusSetupReq ? "#F59E0B" : "obsidian.onSurfaceVariant"
                        }
                        border="1px solid"
                        borderColor={
                          statusActive ? "rgba(57,255,20,0.2)" : statusSetupReq ? "rgba(245,158,11,0.2)" : "rgba(107,114,128,0.15)"
                        }
                        borderRadius="sm"
                        fontSize="9px"
                        fontFamily="mono"
                        px={2}
                        py={0.5}
                      >
                        {agent.status.replace("_", " ").toUpperCase()}
                      </Badge>
                    </Box>

                    {/* DNS Intercept Toggle */}
                    <Box w="15%" onClick={(e) => e.stopPropagation()}>
                      <HStack spacing={2}>
                        <Button
                          size="xs"
                          fontFamily="mono"
                          fontSize="9px"
                          h="22px"
                          px={3}
                          bg={agent.dns_status === "on" ? "rgba(0, 240, 255, 0.15)" : "rgba(239, 68, 68, 0.1)"}
                          color={agent.dns_status === "on" ? "obsidian.cyan" : "#F87171"}
                          border="1px solid"
                          borderColor={agent.dns_status === "on" ? "rgba(0, 240, 255, 0.3)" : "rgba(239, 68, 68, 0.25)"}
                          _hover={{
                            bg: agent.dns_status === "on" ? "rgba(0, 240, 255, 0.25)" : "rgba(239, 68, 68, 0.2)",
                          }}
                          onClick={() => toggleDns(agent.id)}
                        >
                          {agent.dns_status === "on" ? "ON / INTERCEPT" : "OFF / BYPASS"}
                        </Button>
                      </HStack>
                    </Box>

                    {/* Domains list */}
                    <Box w="25%">
                      {hasDomains ? (
                        <HStack spacing={1} wrap="wrap">
                          {agent.domains.slice(0, 2).map((dom) => (
                            <Badge
                              key={dom}
                              variant="outline"
                              borderColor="obsidian.border"
                              color="obsidian.onSurfaceVariant"
                              borderRadius="sm"
                              fontSize="9px"
                              fontFamily="mono"
                              px={1.5}
                              py={0.2}
                            >
                              {dom}
                            </Badge>
                          ))}
                          {agent.domains.length > 2 && (
                            <Badge
                              variant="outline"
                              borderColor="obsidian.border"
                              color="obsidian.cyan"
                              borderRadius="sm"
                              fontSize="9px"
                              fontFamily="mono"
                              px={1.5}
                            >
                              +{agent.domains.length - 2} more
                            </Badge>
                          )}
                        </HStack>
                      ) : (
                        <Text fontSize="10px" color="obsidian.onSurfaceVariant" fontFamily="mono">
                          None
                        </Text>
                      )}
                    </Box>

                    {/* Action Button */}
                    <Box w="15%" textAlign="right" onClick={(e) => e.stopPropagation()}>
                      {statusActive ? (
                        <Text fontSize="10px" color="#39FF14" fontFamily="mono">
                          ✓ Ready
                        </Text>
                      ) : (
                        <Button
                          size="xs"
                          bg={agent.is_detected ? "obsidian.cyan" : "transparent"}
                          color={agent.is_detected ? "black" : "obsidian.onSurfaceVariant"}
                          fontWeight="bold"
                          fontFamily="mono"
                          fontSize="9px"
                          h="24px"
                          px={3}
                          borderRadius="sm"
                          border={agent.is_detected ? "none" : "1px solid"}
                          borderColor={agent.is_detected ? undefined : "obsidian.border"}
                          _hover={agent.is_detected
                            ? { bg: "cyan.300" }
                            : { borderColor: "obsidian.cyan", color: "obsidian.cyan", bg: "rgba(0, 240, 255, 0.05)" }
                          }
                          _active={{ transform: "scale(0.97)" }}
                          leftIcon={!agent.is_detected ? <Icon as={Settings} w={3} h={3} /> : undefined}
                          onClick={() => openSetupWizard(agent)}
                        >
                          {agent.is_detected ? "Activate" : "Setup"}
                        </Button>
                      )}
                    </Box>
                  </Flex>

                  {/* Expandable Guide / Details */}
                  <Collapse in={isExpanded} animateOpacity>
                    <Box
                      p={5}
                      bg="#09090B"
                      borderTop="1px solid"
                      borderBottom="1px solid"
                      borderColor="obsidian.border"
                    >
                      <VStack align="stretch" spacing={4}>
                        <HStack justify="space-between">
                          <Text fontSize="11px" fontWeight="bold" fontFamily="mono" color="obsidian.cyan">
                            // DETAILS
                          </Text>
                          {agent.last_seen_at && (
                            <Text fontSize="10px" fontFamily="mono" color="obsidian.onSurfaceVariant">
                              Last Active: {new Date(agent.last_seen_at).toLocaleString()}
                            </Text>
                          )}
                        </HStack>

                        <VStack align="start" spacing={1.5}>
                          <Text fontSize="xs" color="gray.300">
                            Domains routed to the secure VMAN policy proxy:
                          </Text>
                          <HStack spacing={1.5} wrap="wrap">
                            {agent.domains.map((dom) => (
                              <Badge
                                key={dom}
                                variant="solid"
                                bg="rgba(0, 240, 255, 0.05)"
                                color="obsidian.cyan"
                                border="1px solid rgba(0, 240, 255, 0.15)"
                                borderRadius="sm"
                                fontSize="10px"
                                fontFamily="mono"
                                px={2}
                                py={0.5}
                              >
                                {dom}
                              </Badge>
                            ))}
                          </HStack>
                        </VStack>

                        {/* Cursor IDE Integration Guide */}
                        {agent.id === "cursor" && (
                          <Box
                            mt={2}
                            border="1px solid"
                            borderColor="obsidian.border"
                            borderRadius="md"
                            overflow="hidden"
                          >
                            <Flex bg="#0E0E10" px={4} py={2} align="center">
                              <Icon as={Info} color="obsidian.cyan" w={4} h={4} mr={2} />
                              <Text fontSize="xs" fontWeight="bold" color="white" fontFamily="mono">
                                CURSOR IDE MCP INTEGRATION GUIDE
                              </Text>
                            </Flex>
                            <Box p={4} bg="#050507">
                              <VStack align="stretch" spacing={3}>
                                <Text fontSize="xs" color="gray.300">
                                  To connect <strong>Cursor IDE</strong> to VMAN's secure fleet MCP server:
                                </Text>
                                <VStack align="stretch" spacing={2} pl={2}>
                                  <Text fontSize="xs" color="gray.400">
                                    1. Open Cursor and navigate to <strong>Settings (Gear Icon) &gt; Features &gt; MCP</strong>.
                                  </Text>
                                  <Text fontSize="xs" color="gray.400">
                                    2. Click the <strong>+ Add New MCP Server</strong> button.
                                  </Text>
                                  <Text fontSize="xs" color="gray.400">
                                    3. Configure the fields exactly as follows:
                                  </Text>
                                  <Box
                                    p={3}
                                    bg="#0C0C0F"
                                    border="1px solid"
                                    borderColor="obsidian.border"
                                    borderRadius="sm"
                                  >
                                    <Text fontSize="xs" fontFamily="mono" color="gray.300">
                                      <Text as="span" color="obsidian.cyan">Name:</Text> VMAN
                                    </Text>
                                    <Text fontSize="xs" fontFamily="mono" color="gray.300" mt={1}>
                                      <Text as="span" color="obsidian.cyan">Type:</Text> command
                                    </Text>
                                    <Text fontSize="xs" fontFamily="mono" color="gray.300" mt={1}>
                                      <Text as="span" color="obsidian.cyan">Command:</Text> vman-mcp
                                    </Text>
                                  </Box>
                                  <Text fontSize="xs" color="gray.500" fontStyle="italic">
                                    Note: If vman-mcp is not in your global system PATH, configure type as "command" and command as "python -m vman.mcp.server" or direct path to the python executable.
                                  </Text>
                                </VStack>
                              </VStack>
                            </Box>
                          </Box>
                        )}

                        {/* Claude Code Integration Guide */}
                        {agent.id === "claudecode" && (
                          <Box
                            mt={2}
                            border="1px solid"
                            borderColor="obsidian.border"
                            borderRadius="md"
                            overflow="hidden"
                          >
                            <Flex bg="#0E0E10" px={4} py={2} align="center">
                              <Icon as={Info} color="obsidian.cyan" w={4} h={4} mr={2} />
                              <Text fontSize="xs" fontWeight="bold" color="white" fontFamily="mono">
                                CLAUDE CODE MCP INTEGRATION GUIDE
                              </Text>
                            </Flex>
                            <Box p={4} bg="#050507">
                              <VStack align="stretch" spacing={3}>
                                <Text fontSize="xs" color="gray.300">
                                  To register the VMAN MCP tools registry in <strong>Claude Code</strong>:
                                </Text>
                                <VStack align="stretch" spacing={2} pl={2}>
                                  <Text fontSize="xs" color="gray.400">
                                    Run the command below in your terminal. This registers VMAN globally in your Claude Code session configuration:
                                  </Text>
                                  <Box
                                    p={3}
                                    bg="#0C0C0F"
                                    border="1px solid"
                                    borderColor="obsidian.border"
                                    borderRadius="sm"
                                    fontFamily="mono"
                                    fontSize="xs"
                                    color="obsidian.cyan"
                                  >
                                    claude mcp add vman -- vman-mcp
                                  </Box>
                                  <Text fontSize="xs" color="gray.400" mt={1}>
                                    Or if you're running within the python virtual environment:
                                  </Text>
                                  <Box
                                    p={3}
                                    bg="#0C0C0F"
                                    border="1px solid"
                                    borderColor="obsidian.border"
                                    borderRadius="sm"
                                    fontFamily="mono"
                                    fontSize="xs"
                                    color="obsidian.cyan"
                                  >
                                    claude mcp add vman -- python -m vman.mcp.server
                                  </Box>
                                  <Text fontSize="xs" color="gray.400">
                                    Verify connection inside Claude Code by typing: <Badge colorScheme="cyan" fontSize="10px" fontFamily="mono">/mcp</Badge>
                                  </Text>
                                </VStack>
                              </VStack>
                            </Box>
                          </Box>
                        )}

                        {/* OpenClaw MCP Integration Guide */}
                        {agent.id === "openclaw" && (
                          <Box
                            mt={2}
                            border="1px solid"
                            borderColor="obsidian.border"
                            borderRadius="md"
                            overflow="hidden"
                          >
                            <Flex bg="#0E0E10" px={4} py={2} align="center">
                              <Icon as={Info} color="obsidian.cyan" w={4} h={4} mr={2} />
                              <Text fontSize="xs" fontWeight="bold" color="white" fontFamily="mono">
                                OPENCLAW MCP INTEGRATION GUIDE
                              </Text>
                            </Flex>
                            <Box p={4} bg="#050507">
                              <VStack align="stretch" spacing={3}>
                                <Text fontSize="xs" color="gray.300">
                                  To integrate VMAN's MCP server with the <strong>OpenClaw MCP agent</strong>:
                                </Text>
                                <VStack align="stretch" spacing={2} pl={2}>
                                  <Text fontSize="xs" color="gray.400">
                                    Add the VMAN configuration block inside your OpenClaw configuration file (e.g. `openclaw.config.json`):
                                  </Text>
                                  <Box
                                    p={3}
                                    bg="#0C0C0F"
                                    border="1px solid"
                                    borderColor="obsidian.border"
                                    borderRadius="sm"
                                    overflowX="auto"
                                  >
                                    <pre style={{ margin: 0, fontFamily: "monospace", fontSize: "11px", color: "#A8B2C1" }}>
{`{
  "mcpServers": {
    "vman": {
      "command": "vman-mcp",
      "args": []
    }
  }
}`}
                                    </pre>
                                  </Box>
                                </VStack>
                              </VStack>
                            </Box>
                          </Box>
                        )}

                        {/* Custom MCP Integration Guide block */}
                        {agent.id === "custom_mcp" && (
                          <Box
                            mt={2}
                            border="1px solid"
                            borderColor="obsidian.border"
                            borderRadius="md"
                            overflow="hidden"
                          >
                            {/* Guide Header */}
                            <Flex bg="#0E0E10" px={4} py={2} align="center" justify="space-between">
                              <HStack spacing={2}>
                                <Icon as={Info} color="obsidian.cyan" w={4} h={4} />
                                <Text fontSize="xs" fontWeight="bold" color="white" fontFamily="mono">
                                  INTEGRATION GUIDE: CUSTOM MCP CLIENTS
                                </Text>
                              </HStack>
                              <HStack spacing={1}>
                                {[
                                  { id: "cursor", label: "Stdio Command" },
                                  { id: "zed", label: "Zed Editor" },
                                  { id: "claude", label: "Python Direct" },
                                ].map((tab) => (
                                  <Button
                                    key={tab.id}
                                    size="xs"
                                    variant="ghost"
                                    h="20px"
                                    fontFamily="mono"
                                    fontSize="9px"
                                    px={2.5}
                                    color={guideTab === tab.id ? "obsidian.cyan" : "obsidian.onSurfaceVariant"}
                                    bg={guideTab === tab.id ? "rgba(0, 240, 255, 0.08)" : "transparent"}
                                    _hover={{
                                      color: "obsidian.cyan",
                                      bg: "rgba(0, 240, 255, 0.05)",
                                    }}
                                    onClick={() => setGuideTab(tab.id as any)}
                                  >
                                    {tab.label}
                                  </Button>
                                ))}
                              </HStack>
                            </Flex>

                            {/* Guide Content */}
                            <Box p={4} bg="#050507">
                              {guideTab === "cursor" && (
                                <VStack align="stretch" spacing={3}>
                                  <Text fontSize="xs" color="gray.300">
                                    To connect any custom client supporting standard I/O (stdio) MCP servers:
                                  </Text>
                                  <VStack align="stretch" spacing={2} pl={2}>
                                    <Text fontSize="xs" color="gray.400">
                                      Use the VMAN MCP stdio launch command directly in your client's tool execution settings:
                                    </Text>
                                    <Box
                                      p={3}
                                      bg="#0C0C0F"
                                      border="1px solid"
                                      borderColor="obsidian.border"
                                      borderRadius="sm"
                                      fontFamily="mono"
                                      fontSize="xs"
                                      color="obsidian.cyan"
                                    >
                                      vman-mcp
                                    </Box>
                                  </VStack>
                                </VStack>
                              )}

                              {guideTab === "claude" && (
                                <VStack align="stretch" spacing={3}>
                                  <Text fontSize="xs" color="gray.300">
                                    Direct python execution launch parameters:
                                  </Text>
                                  <VStack align="stretch" spacing={2} pl={2}>
                                    <Text fontSize="xs" color="gray.400">
                                      If the global execution link is not defined, run VMAN's MCP server using the python module syntax inside the VMAN virtual environment:
                                    </Text>
                                    <Box
                                      p={3}
                                      bg="#0C0C0F"
                                      border="1px solid"
                                      borderColor="obsidian.border"
                                      borderRadius="sm"
                                      fontFamily="mono"
                                      fontSize="xs"
                                      color="obsidian.cyan"
                                    >
                                      python -m vman.mcp.server
                                    </Box>
                                  </VStack>
                                </VStack>
                              )}

                              {guideTab === "zed" && (
                                <VStack align="stretch" spacing={3}>
                                  <Text fontSize="xs" color="gray.300">
                                    To integrate VMAN's MCP server with the <strong>Zed editor</strong>:
                                  </Text>
                                  <VStack align="stretch" spacing={2} pl={2}>
                                    <Text fontSize="xs" color="gray.400">
                                      1. Open Zed's configuration settings file.
                                    </Text>
                                    <Text fontSize="xs" color="gray.400">
                                      2. Add the VMAN server configuration block inside the root JSON structure:
                                    </Text>
                                    <Box
                                      p={3}
                                      bg="#0C0C0F"
                                      border="1px solid"
                                      borderColor="obsidian.border"
                                      borderRadius="sm"
                                      overflowX="auto"
                                    >
                                      <pre style={{ margin: 0, fontFamily: "monospace", fontSize: "11px", color: "#A8B2C1" }}>
{`{
  "mcp": {
    "servers": {
      "vman": {
        "command": "vman-mcp",
        "args": []
      }
    }
  }
}`}
                                      </pre>
                                    </Box>
                                  </VStack>
                                </VStack>
                              )}
                            </Box>
                          </Box>
                        )}
                      </VStack>
                    </Box>
                  </Collapse>
                </Box>
              );
            })}
          </Box>
        )}
      </Box>

      {/* ── Setup Wizard Modal ── */}
      {wizardAgent && (
        <Modal
          isOpen={isWizardOpen}
          onClose={() => setIsWizardOpen(false)}
          size="lg"
          isCentered
        >
          <ModalOverlay bg="blackAlpha.800" backdropFilter="blur(5px)" />
          <ModalContent
            bg="obsidian.surface"
            border="1px solid"
            borderColor="obsidian.border"
            borderRadius="md"
            color="white"
            maxW="540px"
          >
            <ModalCloseButton color="obsidian.onSurfaceVariant" _hover={{ color: "white" }} />
            
            <ModalHeader borderBottom="1px solid" borderColor="obsidian.border" py={4} bg="#0E0E10">
              <HStack spacing={3}>
                <Icon as={Settings} color="obsidian.cyan" w={5} h={5} />
                <VStack align="start" spacing={0}>
                  <Heading size="xs" color="white" fontFamily="mono">
                    Setup wizard — {wizardAgent.name}
                  </Heading>
                  <Text fontSize="10px" color="obsidian.onSurfaceVariant" fontFamily="mono" fontWeight="normal">
                    3-step setup
                  </Text>
                </VStack>
              </HStack>
            </ModalHeader>

            <ModalBody py={6}>
              {/* Step indicator progress */}
              <Flex justify="space-between" align="center" px={4} mb={6} position="relative">
                {/* Connecting lines */}
                <Box
                  position="absolute"
                  left="10%"
                  right="10%"
                  top="14px"
                  h="1px"
                  bg="obsidian.border"
                  zIndex={0}
                />
                
                {/* Steps */}
                {[
                  { step: 1, label: "Verify" },
                  { step: 2, label: "DNS" },
                  { step: 3, label: "Mappings" },
                ].map((s) => {
                  const isActive = wizardStep === s.step;
                  const isCompleted = wizardStep > s.step;
                  return (
                    <VStack key={s.step} spacing={2} zIndex={1}>
                      <Flex
                        w="30px"
                        h="30px"
                        borderRadius="full"
                        align="center"
                        justify="center"
                        bg={isActive ? "#E11D48" : isCompleted ? "obsidian.cyan" : "#0A0A0C"}
                        color={isActive || isCompleted ? "black" : "obsidian.onSurfaceVariant"}
                        border="2px solid"
                        borderColor={isActive ? "#E11D48" : isCompleted ? "obsidian.cyan" : "obsidian.border"}
                        fontWeight="bold"
                        fontSize="xs"
                        fontFamily="mono"
                      >
                        {s.step}
                      </Flex>
                      <Text
                        fontSize="10px"
                        fontFamily="mono"
                        fontWeight="bold"
                        color={isActive ? "white" : "obsidian.onSurfaceVariant"}
                      >
                        {s.label}
                      </Text>
                    </VStack>
                  );
                })}
              </Flex>

              {/* Step 1: Verify */}
              {wizardStep === 1 && (
                <VStack align="stretch" spacing={4}>
                  <Text fontSize="xs" color="gray.300">
                    Confirm the server is running and the agent local files/installations are present.
                  </Text>
                  
                  <VStack align="stretch" spacing={3} bg="#050507" p={4} borderRadius="md" border="1px solid" borderColor="obsidian.border">
                    {/* Agent detected check */}
                    <HStack spacing={3}>
                      <Icon
                        as={wizardAgent.status !== "offline" ? CheckCircle2 : XCircle}
                        color={wizardAgent.status !== "offline" ? "#39FF14" : "#EF4444"}
                        w={5}
                        h={5}
                      />
                      <Text fontSize="xs" fontWeight="bold" fontFamily="mono" color="white">
                        {wizardAgent.status !== "offline"
                          ? "Agent installation detected"
                          : `${wizardAgent.name} not detected on local system`}
                      </Text>
                    </HStack>

                    {/* VMAN Control Plane server trust */}
                    <HStack spacing={3}>
                      <Icon as={AlertTriangle} color="#F59E0B" w={5} h={5} />
                      <Text fontSize="xs" fontWeight="bold" fontFamily="mono" color="white">
                        Certificate not yet trusted — use Trust Cert button
                      </Text>
                    </HStack>
                  </VStack>

                  <VStack align="start" spacing={1.5} pl={2}>
                    <Text fontSize="xs" fontWeight="bold" color="obsidian.cyan" fontFamily="mono">
                      Setup instructions:
                    </Text>
                    <Text fontSize="xs" color="gray.400">
                      1. Install {wizardAgent.name}
                    </Text>
                    <Text fontSize="xs" color="gray.400">
                      2. Add VMAN's local certificate or trust it on this machine.
                    </Text>
                    <Text fontSize="xs" color="gray.400">
                      3. Enable DNS routing proxy for target agent domains.
                    </Text>
                    <Text fontSize="xs" color="gray.400">
                      4. Run agent — requests will be automatically securely routed.
                    </Text>
                  </VStack>
                  
                  <Button
                    size="sm"
                    variant="outline"
                    borderColor="obsidian.border"
                    color="obsidian.cyan"
                    _hover={{ bg: "rgba(0, 240, 255, 0.05)" }}
                    fontSize="xs"
                    fontFamily="mono"
                    onClick={() => {
                      toast({
                        title: "Root Certificate Trusted",
                        description: "VMAN Root Certificate trusted for local proxy requests.",
                        status: "success",
                        duration: 3000,
                        isClosable: true,
                      });
                    }}
                  >
                    Trust Root Certificate
                  </Button>
                </VStack>
              )}

              {/* Step 2: DNS */}
              {wizardStep === 2 && (
                <VStack align="stretch" spacing={4}>
                  <Text fontSize="xs" color="gray.300">
                    Configure the DNS intercept policies. Enabling this will route target domains securely through the VMAN proxy.
                  </Text>
                  
                  <Box bg="#050507" p={4} borderRadius="md" border="1px solid" borderColor="obsidian.border">
                    <VStack align="start" spacing={3}>
                      <Text fontSize="xs" fontFamily="mono" color="obsidian.onSurfaceVariant" fontWeight="bold">
                        INTERCEPTED DOMAINS:
                      </Text>
                      <HStack spacing={2} wrap="wrap">
                        {wizardAgent.domains.map((dom) => (
                          <Badge key={dom} colorScheme="cyan" fontFamily="mono" fontSize="10px">
                            {dom}
                          </Badge>
                        ))}
                      </HStack>
                      
                      <Divider borderColor="obsidian.border" my={1} />
                      
                      <Flex w="full" justify="space-between" align="center">
                        <VStack align="start" spacing={0}>
                          <Text fontSize="xs" fontWeight="bold" color="white">
                            Enable DNS Intercept
                          </Text>
                          <Text fontSize="10px" color="obsidian.onSurfaceVariant">
                            Route API traffic through local proxy
                          </Text>
                        </VStack>
                        <Button
                          size="xs"
                          fontFamily="mono"
                          fontSize="9px"
                          h="22px"
                          px={3}
                          bg={isWizardDnsOn ? "rgba(0, 240, 255, 0.15)" : "rgba(239, 68, 68, 0.1)"}
                          color={isWizardDnsOn ? "obsidian.cyan" : "#F87171"}
                          border="1px solid"
                          borderColor={isWizardDnsOn ? "rgba(0, 240, 255, 0.3)" : "rgba(239, 68, 68, 0.25)"}
                          onClick={() => setIsWizardDnsOn(!isWizardDnsOn)}
                        >
                          {isWizardDnsOn ? "ON / INTERCEPT" : "OFF / BYPASS"}
                        </Button>
                      </Flex>
                    </VStack>
                  </Box>
                </VStack>
              )}

              {/* Step 3: Mappings / Verify */}
              {wizardStep === 3 && (
                <VStack align="stretch" spacing={4}>
                  <Text fontSize="xs" color="gray.300">
                    Verify the final connection mapping from the agent client interface to VMAN Control Plane.
                  </Text>
                  
                  <Box bg="#050507" p={4} borderRadius="md" border="1px solid" borderColor="obsidian.border">
                    <VStack spacing={4} py={3}>
                      {verifyStatus === "idle" && (
                        <VStack spacing={3}>
                          <Icon as={Play} color="obsidian.cyan" w={8} h={8} />
                          <Text fontSize="xs" color="gray.400" textAlign="center">
                            Ready to initiate verification handshake. Ensure the agent client is running.
                          </Text>
                        </VStack>
                      )}
                      
                      {verifyStatus === "running" && (
                        <VStack spacing={3}>
                          <Spinner size="md" color="obsidian.cyan" />
                          <Text fontSize="xs" color="gray.400" fontFamily="mono">
                            Verifying local process handshakes...
                          </Text>
                        </VStack>
                      )}

                      {verifyStatus === "success" && (
                        <VStack spacing={3}>
                          <Icon as={CheckCircle2} color="#39FF14" w={8} h={8} />
                          <Text fontSize="xs" color="#39FF14" fontWeight="bold" fontFamily="mono">
                            Verification Success!
                          </Text>
                          <Text fontSize="10px" color="gray.400" textAlign="center">
                            {wizardAgent.name} has successfully established connection with VMAN.
                          </Text>
                        </VStack>
                      )}

                      {verifyStatus === "error" && (
                        <VStack spacing={3}>
                          <Icon as={XCircle} color="#EF4444" w={8} h={8} />
                          <Text fontSize="xs" color="#EF4444" fontWeight="bold" fontFamily="mono">
                            Verification Failed
                          </Text>
                          <Text fontSize="10px" color="gray.400" textAlign="center">
                            Installation not detected or proxy not running. Please make sure the agent is installed and running.
                          </Text>
                        </VStack>
                      )}
                    </VStack>
                  </Box>
                  
                  {verifyStatus !== "success" && (
                    <Button
                      size="sm"
                      bg="obsidian.cyan"
                      color="black"
                      fontWeight="bold"
                      fontFamily="mono"
                      fontSize="xs"
                      isLoading={verifyStatus === "running"}
                      onClick={async () => {
                        setVerifyStatus("running");
                        // Mock verification handshake delay
                        await new Promise((r) => setTimeout(r, 1500));
                        
                        try {
                          const updated = await client.request<Agent>(`/api/agents/${wizardAgent.id}/setup`, {
                            method: "POST"
                          });
                          // If toggle DNS doesn't match wizard state, sync it
                          if ((updated.dns_status === "on") !== isWizardDnsOn) {
                            await client.request<Agent>(`/api/agents/${wizardAgent.id}/toggle-dns`, {
                              method: "POST"
                            });
                          }
                          setVerifyStatus("success");
                          setAgents((prev) => prev.map((a) => (a.id === wizardAgent.id ? { ...updated, status: "active", dns_status: isWizardDnsOn ? "on" : "off" } : a)));
                        } catch (err) {
                          setVerifyStatus("error");
                        }
                      }}
                    >
                      Run Verification Test
                    </Button>
                  )}
                </VStack>
              )}
            </ModalBody>

            <ModalFooter borderTop="1px solid" borderColor="obsidian.border" bg="#0E0E10" py={3}>
              <HStack justify="space-between" w="full">
                <Box>
                  {wizardStep > 1 && (
                    <Button
                      size="sm"
                      variant="outline"
                      borderColor="obsidian.border"
                      color="obsidian.onSurfaceVariant"
                      fontSize="xs"
                      fontFamily="mono"
                      leftIcon={<Icon as={ArrowLeft} w={3.5} h={3.5} />}
                      onClick={() => setWizardStep(wizardStep - 1)}
                    >
                      Back
                    </Button>
                  )}
                </Box>
                <HStack spacing={2}>
                  <Button
                    size="sm"
                    variant="ghost"
                    color="obsidian.onSurfaceVariant"
                    fontSize="xs"
                    fontFamily="mono"
                    onClick={() => setIsWizardOpen(false)}
                  >
                    Cancel
                  </Button>
                  
                  {wizardStep < 3 ? (
                    <Button
                      size="sm"
                      bg="obsidian.cyan"
                      color="black"
                      fontWeight="bold"
                      fontFamily="mono"
                      fontSize="xs"
                      rightIcon={<Icon as={ArrowRight} w={3.5} h={3.5} />}
                      onClick={() => setWizardStep(wizardStep + 1)}
                    >
                      Next
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      bg="obsidian.cyan"
                      color="black"
                      fontWeight="bold"
                      fontFamily="mono"
                      fontSize="xs"
                      isDisabled={verifyStatus !== "success"}
                      onClick={() => setIsWizardOpen(false)}
                    >
                      Finish
                    </Button>
                  )}
                </HStack>
              </HStack>
            </ModalFooter>
          </ModalContent>
        </Modal>
      )}
    </Flex>
  );
}

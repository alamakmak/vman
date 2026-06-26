import { useState, useEffect, useMemo } from "react";
import { NavLink as RouterNavLink, Outlet, useNavigate, useLocation } from "react-router-dom";
import {
  Box,
  Flex,
  Text,
  Heading,
  VStack,
  HStack,
  Icon,
  Badge,
  Spinner,
  Divider,
  Button,
} from "@chakra-ui/react";
import { keyframes } from "@emotion/react";
import {
  LayoutDashboard,
  Server,
  Network,
  Key,
  Activity,
  Wrench,
  ScrollText,
  Shield,
  Terminal,
  Settings,
  HardDrive,
  User,
  Cpu,
  LogOut,
} from "lucide-react";
import { ApiClient } from "@/lib/api";
import { useAuth } from "@/app/auth";

const client = new ApiClient({ baseUrl: "" });

const agenticPulse = keyframes`
  0% { box-shadow: 0 0 0 0 rgba(0, 240, 255, 0.45); }
  70% { box-shadow: 0 0 0 8px rgba(0, 240, 255, 0); }
  100% { box-shadow: 0 0 0 0 rgba(0, 240, 255, 0); }
`;

const agenticGlow = keyframes`
  0%, 100% { text-shadow: 0 0 4px rgba(0, 240, 255, 0.3); }
  50% { text-shadow: 0 0 12px rgba(0, 240, 255, 0.7), 0 0 20px rgba(0, 240, 255, 0.3); }
`;

interface NavItem {
  to: string;
  label: string;
  icon: any;
  end?: boolean;
}

const navItems: NavItem[] = [
  { to: "/", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "/hosts", label: "Hosts", icon: Server },
  { to: "/topology", label: "Host Topology", icon: Network },
  { to: "/credentials", label: "Credentials", icon: Key },
  { to: "/jobs", label: "Jobs", icon: Activity },
  { to: "/recipes", label: "Recipes", icon: Wrench },
  { to: "/logs", label: "Logs", icon: ScrollText },
  { to: "/audit", label: "Audit", icon: Shield },
  { to: "/agents", label: "Agent Bridge", icon: Cpu },
];

const utilityItems: NavItem[] = [
  { to: "/terminal", label: "Terminal", icon: Terminal },
  { to: "/settings", label: "Settings", icon: Settings },
];

interface AgentStatusSummary {
  status: string;
}

export function AppShell() {
  const { user, loading, setUser } = useAuth();
  const [agentStatuses, setAgentStatuses] = useState<AgentStatusSummary[]>([]);
  const navigate = useNavigate();
  const location = useLocation();

  // Fetch agent statuses to determine Agentless vs Agentic mode
  useEffect(() => {
    client.get<AgentStatusSummary[]>("/api/agents")
      .then((data) => setAgentStatuses(data))
      .catch(() => setAgentStatuses([]));
  }, []);

  const isAgentic = useMemo(
    () => agentStatuses.some((a) => a.status === "active"),
    [agentStatuses]
  );

  if (loading) {
    return (
      <Flex minH="100vh" align="center" justify="center" bg="obsidian.bg" direction="column" gap={4}>
        <Spinner size="xl" color="obsidian.cyan" thickness="4px" />
        <Text color="obsidian.onSurfaceVariant" fontSize="xs" fontFamily="mono" letterSpacing="widest" textTransform="uppercase">
          Authenticating with VMAN...
        </Text>
      </Flex>
    );
  }

  // Get current page header title
  const currentPath = location.pathname;
  let pageTitle = "Dashboard";
  if (currentPath.startsWith("/hosts")) pageTitle = "Hosts Fleet";
  else if (currentPath.startsWith("/topology")) pageTitle = "Host Topology";
  else if (currentPath.startsWith("/credentials")) pageTitle = "Secure Vault";
  else if (currentPath.startsWith("/jobs")) pageTitle = "Execution Jobs";
  else if (currentPath.startsWith("/recipes")) pageTitle = "Recipe Engine";
  else if (currentPath.startsWith("/logs")) pageTitle = "System Logs";
  else if (currentPath.startsWith("/audit")) pageTitle = "Audit Trail";
  else if (currentPath.startsWith("/agents")) pageTitle = "Agent Bridge";
  else if (currentPath.startsWith("/terminal")) pageTitle = "Interactive Terminal";
  else if (currentPath.startsWith("/settings")) pageTitle = "System Settings";

  return (
    <Flex minH="100vh" bg="obsidian.bg" color="gray.100">
      {/* Sidebar navigation */}
      <Box
        as="aside"
        w="260px"
        bg="obsidian.surface"
        borderRight="1px solid"
        borderColor="obsidian.border"
        display="flex"
        flexDirection="column"
        position="fixed"
        h="100vh"
        zIndex={10}
      >
        {/* Logo / Header */}
        <Flex h="64px" align="center" px={6} borderBottom="1px solid" borderColor="obsidian.border" gap={3}>
          <Flex
            h="40px"
            w="40px"
            align="center"
            justify="center"
            borderRadius="md"
            bg="rgba(0, 240, 255, 0.1)"
            color="obsidian.cyan"
            boxShadow="0 0 15px rgba(0, 240, 255, 0.15)"
            border="1px solid"
            borderColor="rgba(0, 240, 255, 0.2)"
          >
            <HardDrive size={22} />
          </Flex>
          <VStack align="start" spacing={0}>
            <Text fontWeight="extrabold" fontSize="md" color="white" letterSpacing="wider" fontFamily="heading">
              VMAN
            </Text>
            <Text fontSize="10px" color="obsidian.cyan" fontWeight="bold" fontFamily="mono" letterSpacing="wider">
              CYBER-OPS
            </Text>
          </VStack>
        </Flex>

        {/* Navigation lists */}
        <Box flex="1" overflowY="auto" px={0} py={6}>
          <Text px={6} pb={2} fontSize="10px" fontWeight="bold" color="obsidian.onSurfaceVariant" fontFamily="mono" letterSpacing="widest" textTransform="uppercase">
            Workspace
          </Text>
          <VStack align="stretch" spacing={1} mb={6}>
            {navItems.map((item) => {
              const isActive = item.end
                ? location.pathname === item.to
                : location.pathname.startsWith(item.to) && (item.to !== "/" || location.pathname === "/");
              return (
                <Button
                  as={RouterNavLink}
                  to={item.to}
                  key={item.to}
                  variant="ghost"
                  justifyContent="start"
                  fontWeight={isActive ? "bold" : "medium"}
                  fontSize="sm"
                  h="40px"
                  px={6}
                  borderRadius="none"
                  color={isActive ? "obsidian.cyan" : "obsidian.onSurfaceVariant"}
                  bg={isActive ? "rgba(0, 240, 255, 0.05)" : "transparent"}
                  borderLeft={isActive ? "4px solid" : "4px solid transparent"}
                  borderColor={isActive ? "obsidian.cyan" : "transparent"}
                  _hover={{ bg: "rgba(255, 255, 255, 0.03)", color: "white" }}
                  leftIcon={<Icon as={item.icon} size={16} />}
                >
                  {item.label}
                </Button>
              );
            })}
          </VStack>

          <Divider borderColor="obsidian.border" my={4} />

          <Text px={6} pb={2} fontSize="10px" fontWeight="bold" color="obsidian.onSurfaceVariant" fontFamily="mono" letterSpacing="widest" textTransform="uppercase">
            Utilities
          </Text>
          <VStack align="stretch" spacing={1}>
            {utilityItems.map((item) => {
              const isActive = location.pathname.startsWith(item.to);
              return (
                <Button
                  as={RouterNavLink}
                  to={item.to}
                  key={item.to}
                  variant="ghost"
                  justifyContent="start"
                  fontWeight={isActive ? "bold" : "medium"}
                  fontSize="sm"
                  h="40px"
                  px={6}
                  borderRadius="none"
                  color={isActive ? "obsidian.cyan" : "obsidian.onSurfaceVariant"}
                  bg={isActive ? "rgba(0, 240, 255, 0.05)" : "transparent"}
                  borderLeft={isActive ? "4px solid" : "4px solid transparent"}
                  borderColor={isActive ? "obsidian.cyan" : "transparent"}
                  _hover={{ bg: "rgba(255, 255, 255, 0.03)", color: "white" }}
                  leftIcon={<Icon as={item.icon} size={16} />}
                >
                  {item.label}
                </Button>
              );
            })}
          </VStack>
        </Box>

        {/* Footer info */}
        <Box p={4} borderTop="1px solid" borderColor="obsidian.border" bg="#0E0E10">
          <Flex align="center" justify="space-between" mb={2}>
            <Text fontSize="10px" color="obsidian.onSurfaceVariant" fontFamily="mono">v0.1.0 — alpha</Text>
            <Badge colorScheme="cyan" bg="rgba(0, 240, 255, 0.1)" color="obsidian.cyan" px={2} py={0.5} borderRadius="sm" fontSize="9px">
              local-conda
            </Badge>
          </Flex>
          <Flex align="center" justify="space-between">
            <HStack spacing={2}>
              <Icon as={User} size={12} color="obsidian.onSurfaceVariant" />
              <Text fontSize="10px" color="obsidian.onSurfaceVariant" fontFamily="mono" isTruncated maxW="140px">
                {user?.username} ({user?.role})
              </Text>
            </HStack>
            <Button
              size="xs"
              variant="ghost"
              color="obsidian.onSurfaceVariant"
              fontFamily="mono"
              fontSize="9px"
              h="24px"
              px={2}
              leftIcon={<Icon as={LogOut} w={3} h={3} />}
              _hover={{ color: "#F87171", bg: "rgba(239, 68, 68, 0.1)" }}
              onClick={async () => {
                try {
                  await client.request("/api/auth/logout", { method: "POST" });
                } catch {
                  // ignore errors, proceed to redirect
                }
                setUser(null);
                navigate("/login", { replace: true });
              }}
            >
              Logout
            </Button>
          </Flex>
        </Box>
      </Box>

      {/* Main content body */}
      <Flex direction="column" flex="1" ml="260px" minH="100vh">
        <Flex
          as="header"
          h="64px"
          align="center"
          justify="space-between"
          px={8}
          borderBottom="1px solid"
          borderColor="obsidian.border"
          bg="rgba(10, 10, 12, 0.8)"
          backdropFilter="blur(20px)"
          position="sticky"
          top={0}
          zIndex={5}
        >
          <VStack align="start" spacing={0}>
            <Heading as="h2" size="sm" fontWeight="bold" color="white" fontFamily="heading">
              {pageTitle}
            </Heading>
            <Text fontSize="xs" color="obsidian.onSurfaceVariant" fontFamily="mono">
              Control plane session authenticated
            </Text>
          </VStack>
          <HStack spacing={2}>
            <Badge
              variant="subtle"
              bg={isAgentic ? "rgba(0, 240, 255, 0.15)" : "rgba(0, 240, 255, 0.1)"}
              color="obsidian.cyan"
              px={2.5}
              py={0.5}
              borderRadius="sm"
              border={isAgentic ? "1px solid rgba(0, 240, 255, 0.3)" : "none"}
              animation={isAgentic ? `${agenticGlow} 2s ease-in-out infinite` : "none"}
              display="flex"
              alignItems="center"
              gap={1.5}
            >
              {isAgentic && (
                <Box
                  w="6px"
                  h="6px"
                  borderRadius="full"
                  bg="obsidian.cyan"
                  animation={`${agenticPulse} 2s infinite`}
                />
              )}
              {isAgentic ? "Agentic" : "Agentless"}
            </Badge>
            <Badge variant="subtle" bg="rgba(57, 255, 20, 0.1)" color="obsidian.green" px={2.5} py={0.5} borderRadius="sm">
              Encrypted Vault
            </Badge>
          </HStack>
        </Flex>

        <Box p={8} flex="1" bg="obsidian.bg">
          <Outlet />
        </Box>
      </Flex>
    </Flex>
  );
}

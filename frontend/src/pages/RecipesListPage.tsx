import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  BookOpen,
  RefreshCcw,
  Search,
  ChevronRight,
  Wrench,
  ShieldAlert,
  ShieldCheck,
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
  Switch,
} from "@chakra-ui/react";
import {
  describeVars,
  recipeRequiresApproval,
  type RecipeSummary,
} from "@/lib/recipes";
import { listRecipes, RecipeApiError } from "@/lib/recipesApi";
import { ApiError } from "@/lib/api";

// ─── helpers ───────────────────────────────────────────────────────────────

function getRiskStyle(risk: string): { color: string; bg: string; border: string } {
  switch (risk) {
    case "critical": return { color: "#FF3131", bg: "rgba(255,49,49,0.1)",   border: "rgba(255,49,49,0.25)" };
    case "high":     return { color: "#F87171", bg: "rgba(248,113,113,0.1)", border: "rgba(248,113,113,0.25)" };
    case "medium":   return { color: "#F59E0B", bg: "rgba(245,158,11,0.1)",  border: "rgba(245,158,11,0.25)" };
    default:         return { color: "#39FF14", bg: "rgba(57,255,20,0.1)",   border: "rgba(57,255,20,0.25)" };
  }
}

function PhaseBadges({ recipe }: { recipe: RecipeSummary }) {
  const phases = [
    { label: "pre",      present: recipe.has_preflight },
    { label: "steps",    present: recipe.step_count > 0 },
    { label: "verify",   present: recipe.has_verify },
    { label: "rollback", present: recipe.has_rollback },
  ];
  return (
    <HStack spacing={1} flexWrap="wrap">
      {phases.map((p) => (
        <Badge
          key={p.label}
          px={1.5}
          py={0.5}
          borderRadius="sm"
          fontSize="9px"
          fontFamily="mono"
          bg={p.present ? "rgba(0,240,255,0.08)" : "rgba(107,114,128,0.08)"}
          color={p.present ? "obsidian.cyan" : "obsidian.onSurfaceVariant"}
          border="1px solid"
          borderColor={p.present ? "rgba(0,240,255,0.2)" : "rgba(107,114,128,0.15)"}
          opacity={p.present ? 1 : 0.45}
          textDecoration={p.present ? "none" : "line-through"}
        >
          {p.label}
        </Badge>
      ))}
    </HStack>
  );
}

const RISK_OPTIONS = [
  { value: "",         label: "All risk levels" },
  { value: "low",      label: "Low" },
  { value: "medium",   label: "Medium" },
  { value: "high",     label: "High" },
  { value: "critical", label: "Critical" },
];

// ─── Main component ────────────────────────────────────────────────────────

export function RecipesListPage() {
  const navigate = useNavigate();
  const [recipes, setRecipes] = useState<RecipeSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [riskFilter, setRiskFilter] = useState<"" | "low" | "medium" | "high" | "critical">("");
  const [showApprovalOnly, setShowApprovalOnly] = useState(false);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await listRecipes();
      setRecipes(rows);
    } catch (err) {
      const msg =
        err instanceof RecipeApiError ? err.detail :
        err instanceof ApiError ? err.message :
        err instanceof Error ? err.message : "Failed to load recipes.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return recipes.filter((r) => {
      if (riskFilter && r.risk_level !== riskFilter) return false;
      if (showApprovalOnly && !recipeRequiresApproval(r.policy)) return false;
      if (!q) return true;
      return r.name.toLowerCase().includes(q) || r.description.toLowerCase().includes(q);
    });
  }, [recipes, search, riskFilter, showApprovalOnly]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { total: recipes.length, low: 0, medium: 0, high: 0, critical: 0, approval: 0 };
    for (const r of recipes) {
      c[r.risk_level] = (c[r.risk_level] ?? 0) + 1;
      if (recipeRequiresApproval(r.policy)) c.approval += 1;
    }
    return c;
  }, [recipes]);

  return (
    <Flex direction="column" gap={6}>
      {/* ── Header ── */}
      <Flex justify="space-between" align="flex-end" wrap="wrap" gap={3}>
        <VStack align="start" spacing={0.5}>
          <Heading as="h1" size="lg" color="white" fontWeight="bold" letterSpacing="-0.02em">
            Recipe Catalogue
          </Heading>
          <Text fontSize="sm" color="obsidian.onSurfaceVariant">
            Multi-step procedures that run on target hosts through the policy engine and audit log.
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
        border="1px solid" borderColor="obsidian.border"
        borderRadius="md" p={5} position="relative" overflow="hidden"
      >
        <Box position="absolute" top={0} left={0} right={0} h="1px"
          bg="linear-gradient(90deg, transparent, rgba(0,240,255,0.4), transparent)" />
        <HStack spacing={6} wrap="wrap">
          <HStack spacing={2}>
            <Icon as={BookOpen} color="obsidian.cyan" w={4} h={4} />
            <Text fontSize="xs" fontFamily="mono" color="obsidian.onSurfaceVariant">
              Total: <Text as="span" color="white" fontWeight="bold">{counts.total}</Text>
            </Text>
          </HStack>
          {[
            { key: "low",      color: "#39FF14" },
            { key: "medium",   color: "#F59E0B" },
            { key: "high",     color: "#F87171" },
            { key: "critical", color: "#FF3131" },
          ].map(({ key, color }) => (
            <HStack key={key} spacing={1.5}>
              <Box w={1.5} h={1.5} borderRadius="full" bg={color} />
              <Text fontSize="xs" fontFamily="mono" color="obsidian.onSurfaceVariant" textTransform="capitalize">
                {key}: <Text as="span" color="white" fontWeight="bold">{counts[key] ?? 0}</Text>
              </Text>
            </HStack>
          ))}
          <HStack spacing={1.5}>
            <Icon as={ShieldAlert} w={3.5} h={3.5} color="#F59E0B" />
            <Text fontSize="xs" fontFamily="mono" color="obsidian.onSurfaceVariant">
              Require approval: <Text as="span" color="white" fontWeight="bold">{counts.approval}</Text>
            </Text>
          </HStack>
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
                placeholder="Search name or description…"
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
              value={riskFilter}
              onChange={(e) => setRiskFilter((e.target.value || "") as "" | "low" | "medium" | "high" | "critical")}
              bg="#0A0A0C" border="1px solid" borderColor="obsidian.border"
              color="obsidian.onSurfaceVariant" fontSize="xs" fontFamily="mono"
              h="28px" w="160px"
              _focus={{ borderColor: "obsidian.cyan", boxShadow: "none" }}
            >
              {RISK_OPTIONS.map((o) => (
                <option key={o.value} value={o.value} style={{ background: "#0A0A0C" }}>
                  {o.label}
                </option>
              ))}
            </Select>
            <HStack spacing={2}>
              <Switch
                size="sm"
                colorScheme="cyan"
                isChecked={showApprovalOnly}
                onChange={(e) => setShowApprovalOnly(e.target.checked)}
              />
              <Text fontSize="xs" fontFamily="mono" color="obsidian.onSurfaceVariant">
                Approval only
              </Text>
            </HStack>
          </HStack>
          {filtered.length > 0 && (
            <Text fontSize="10px" color="obsidian.onSurfaceVariant" fontFamily="mono">
              Showing 1–{filtered.length} of {recipes.length}
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
            <Icon as={Wrench} w={8} h={8} color="obsidian.onSurfaceVariant" opacity={0.4} />
            <Text fontSize="sm" color="obsidian.onSurfaceVariant" fontFamily="mono">
              {recipes.length === 0 ? "No recipes available. Drop a YAML file into the recipes directory." : "No recipes match your filter."}
            </Text>
          </Flex>
        ) : (
          <Box overflowX="auto" maxW="100%" sx={{ WebkitOverflowScrolling: "touch" }}>
            {/* Header */}
            <Flex px={{ base: 3, md: 5 }} py={2.5} borderBottom="1px solid" borderColor="obsidian.border" bg="#0A0A0C" minW={{ base: "720px", md: "900px" }}>
              {[
                { label: "NAME",     w: "24%" },
                { label: "VERSION",  w: "8%"  },
                { label: "RISK",     w: "10%" },
                { label: "STEPS",    w: "7%"  },
                { label: "VARS",     w: "14%" },
                { label: "PHASES",   w: "22%" },
                { label: "APPROVAL", w: "11%" },
                { label: "",         w: "4%"  },
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
            {filtered.map((recipe) => {
              const risk = getRiskStyle(recipe.risk_level);
              const needsApproval = recipeRequiresApproval(recipe.policy);
              return (
                <Flex key={recipe.name} px={{ base: 3, md: 5 }} py={3.5} borderBottom="1px solid" borderColor="obsidian.border"
                  align="center" minW={{ base: "720px", md: "900px" }}
                  _hover={{ bg: "rgba(255,255,255,0.02)", cursor: "pointer" }}
                  transition="background 0.15s"
                  onClick={() => navigate(`/recipes/${encodeURIComponent(recipe.name)}`)}>

                  {/* NAME */}
                  <Box w="24%" flexShrink={0} pr={4}>
                    <HStack spacing={2.5}>
                      <Box w="22px" h="22px" borderRadius="4px" flexShrink={0}
                        bg="rgba(0,240,255,0.08)" border="1px solid rgba(0,240,255,0.15)"
                        display="flex" alignItems="center" justifyContent="center">
                        <Icon as={BookOpen} w={3} h={3} color="obsidian.cyan" />
                      </Box>
                      <VStack align="start" spacing={0}>
                        <Text fontSize="xs" fontWeight="semibold" color="white" fontFamily="mono">
                          {recipe.name}
                        </Text>
                        {recipe.description && (
                          <Text fontSize="10px" color="obsidian.onSurfaceVariant" noOfLines={1}>
                            {recipe.description.split("\n")[0]}
                          </Text>
                        )}
                      </VStack>
                    </HStack>
                  </Box>

                  {/* VERSION */}
                  <Box w="8%" flexShrink={0}>
                    <Text fontSize="11px" fontFamily="mono" color="obsidian.onSurfaceVariant">
                      {recipe.version}
                    </Text>
                  </Box>

                  {/* RISK */}
                  <Box w="10%" flexShrink={0}>
                    <Badge px={2} py={0.5} borderRadius="sm" fontSize="9px" fontFamily="mono"
                      fontWeight="bold" letterSpacing="wider"
                      bg={risk.bg} color={risk.color} border="1px solid" borderColor={risk.border}>
                      {recipe.risk_level.toUpperCase()}
                    </Badge>
                  </Box>

                  {/* STEPS */}
                  <Box w="7%" flexShrink={0}>
                    <Text fontSize="xs" fontFamily="mono" color="white" fontWeight="bold">
                      {recipe.step_count}
                    </Text>
                  </Box>

                  {/* VARS */}
                  <Box w="14%" flexShrink={0} pr={2}>
                    <Text fontSize="10px" fontFamily="mono" color="obsidian.onSurfaceVariant" noOfLines={1}>
                      {describeVars(recipe.vars) || "—"}
                    </Text>
                  </Box>

                  {/* PHASES */}
                  <Box w="22%" flexShrink={0}>
                    <PhaseBadges recipe={recipe} />
                  </Box>

                  {/* APPROVAL */}
                  <Box w="11%" flexShrink={0}>
                    <HStack spacing={1.5}>
                      <Icon
                        as={needsApproval ? ShieldAlert : ShieldCheck}
                        w={3.5} h={3.5}
                        color={needsApproval ? "#F59E0B" : "#39FF14"}
                      />
                      <Text fontSize="10px" fontFamily="mono"
                        color={needsApproval ? "#F59E0B" : "#39FF14"}>
                        {needsApproval ? "Required" : "Not required"}
                      </Text>
                    </HStack>
                  </Box>

                  {/* ACTION */}
                  <Box w="4%" flexShrink={0} onClick={(e) => e.stopPropagation()}>
                    <Tooltip label="Open recipe" placement="top" hasArrow>
                      <IconButton aria-label="open" icon={<Icon as={ChevronRight} w={3.5} h={3.5} />}
                        size="xs" variant="ghost" color="obsidian.onSurfaceVariant"
                        _hover={{ color: "white", bg: "rgba(255,255,255,0.05)" }}
                        onClick={() => navigate(`/recipes/${encodeURIComponent(recipe.name)}`)} />
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

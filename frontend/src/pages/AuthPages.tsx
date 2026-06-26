import { useState } from "react";
import { Link as RouterLink, useLocation, useNavigate } from "react-router-dom";
import { HardDrive, LogIn, ShieldCheck } from "lucide-react";
import { useAuth } from "@/app/auth";
import {
  Box,
  Flex,
  Text,
  Heading,
  Button,
  Input,
  FormControl,
  FormLabel,
  Spinner,
  Icon,
  VStack,
  Link,
} from "@chakra-ui/react";
import { ApiClient } from "@/lib/api";
import { login } from "@/lib/authApi";

const client = new ApiClient({ baseUrl: "" });

// ─── Field Styles ──────────────────────────────────────────────────────────

const inputStyle = {
  bg: "#0A0A0C",
  border: "1px solid",
  borderColor: "obsidian.border",
  color: "white",
  fontSize: "sm",
  fontFamily: "mono",
  h: "38px",
  borderRadius: "md",
  _placeholder: { color: "obsidian.onSurfaceVariant" },
  _focus: { borderColor: "obsidian.cyan", boxShadow: "0 0 0 1px rgba(0,240,255,0.3)" },
  _hover: { borderColor: "rgba(255,255,255,0.2)" },
};

const labelStyle = {
  fontSize: "11px",
  fontWeight: "bold",
  color: "obsidian.onSurfaceVariant",
  fontFamily: "mono",
  letterSpacing: "wider",
  textTransform: "uppercase" as const,
  mb: 1.5,
};

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const auth = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setErrorMessage("");
    try {
      const signedIn = await login({ username, password });
      auth.setUser(signedIn);
      const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname ?? "/";
      navigate(from, { replace: true });
    } catch (err: any) {
      setErrorMessage(err.message || "Invalid username or password");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Flex minH="100vh" align="center" justify="center" bg="obsidian.bg" p={6}>
      <Box
        w="full"
        maxW="md"
        bg="obsidian.surface"
        border="1px solid"
        borderColor="obsidian.border"
        borderRadius="md"
        overflow="hidden"
      >
        {/* Header */}
        <Box bg="#0E0E10" px={6} py={5} borderBottom="1px solid" borderColor="obsidian.border" textAlign="center">
          <Flex
            mx="auto"
            h="48px"
            w="48px"
            align="center"
            justify="center"
            borderRadius="lg"
            bg="rgba(0, 240, 255, 0.1)"
            color="obsidian.cyan"
            border="1px solid"
            borderColor="rgba(0, 240, 255, 0.25)"
            mb={3}
          >
            <Icon as={HardDrive} w={5} h={5} />
          </Flex>
          <Heading size="sm" color="white" fontFamily="mono" textTransform="uppercase" letterSpacing="wider" mb={1}>
            Sign in to VMAN
          </Heading>
          <Text fontSize="xs" color="obsidian.onSurfaceVariant" fontFamily="mono">
            USE ADMIN CREDENTIALS OR INITIATE SETUP
          </Text>
        </Box>

        {/* Form */}
        <Box as="form" onSubmit={handleSubmit} p={6}>
          <VStack spacing={4} align="stretch">
            {errorMessage && (
              <Box bg="rgba(255,49,49,0.08)" border="1px solid rgba(255,49,49,0.2)" borderRadius="md" p={3}>
                <Text fontSize="xs" color="#FF3131" fontFamily="mono">
                  {errorMessage.toUpperCase()}
                </Text>
              </Box>
            )}

            <FormControl isRequired>
              <FormLabel sx={labelStyle}>Username</FormLabel>
              <Input
                id="username"
                name="username"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                sx={inputStyle}
              />
            </FormControl>

            <FormControl isRequired>
              <FormLabel sx={labelStyle}>Password</FormLabel>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                sx={inputStyle}
              />
            </FormControl>

            <Button
              type="submit"
              disabled={busy}
              bg="obsidian.cyan"
              color="black"
              w="full"
              h="38px"
              mt={2}
              _hover={{ bg: "#00D8E6" }}
              _disabled={{ bg: "rgba(0,240,255,0.15)", color: "rgba(0,0,0,0.5)", cursor: "not-allowed" }}
              leftIcon={busy ? <Spinner size="xs" color="black" /> : <Icon as={LogIn} w={4} h={4} />}
              fontFamily="mono"
              fontSize="xs"
              textTransform="uppercase"
              letterSpacing="wider"
            >
              {busy ? "Signing in…" : "Sign in"}
            </Button>

            <Text textAlign="center" fontSize="11px" color="obsidian.onSurfaceVariant" fontFamily="mono" pt={2}>
              NO ACCOUNT YET?{" "}
              <Link
                as={RouterLink}
                to="/setup"
                color="obsidian.cyan"
                textDecoration="none"
                _hover={{ textDecoration: "underline" }}
              >
                RUN FIRST-TIME SETUP
              </Link>
            </Text>
          </VStack>
        </Box>
      </Box>
    </Flex>
  );
}

export function SetupPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (password.length < 12) {
      setErrorMessage("Password must be at least 12 characters long");
      return;
    }
    setBusy(true);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      await client.post("/api/auth/setup", {
        json: {
          username,
          password,
          email: email.trim() || null,
        },
      });
      setSuccessMessage("First-time setup completed! Redirecting to login...");
      setTimeout(() => {
        navigate("/login");
      }, 2000);
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to complete setup");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Flex minH="100vh" align="center" justify="center" bg="obsidian.bg" p={6}>
      <Box
        w="full"
        maxW="md"
        bg="obsidian.surface"
        border="1px solid"
        borderColor="obsidian.border"
        borderRadius="md"
        overflow="hidden"
      >
        {/* Header */}
        <Box bg="#0E0E10" px={6} py={5} borderBottom="1px solid" borderColor="obsidian.border" textAlign="center">
          <Flex
            mx="auto"
            h="48px"
            w="48px"
            align="center"
            justify="center"
            borderRadius="lg"
            bg="rgba(57,255,20,0.07)"
            color="#39FF14"
            border="1px solid"
            borderColor="rgba(57,255,20,0.2)"
            mb={3}
          >
            <Icon as={ShieldCheck} w={5} h={5} />
          </Flex>
          <Heading size="sm" color="white" fontFamily="mono" textTransform="uppercase" letterSpacing="wider" mb={1}>
            First-time setup
          </Heading>
          <Text fontSize="xs" color="obsidian.onSurfaceVariant" fontFamily="mono">
            CREATE THE PRIMARY OWNER ADMINISTRATIVE ACCOUNT
          </Text>
        </Box>

        {/* Form */}
        <Box as="form" onSubmit={handleSubmit} p={6}>
          <VStack spacing={4} align="stretch">
            {errorMessage && (
              <Box bg="rgba(255,49,49,0.08)" border="1px solid rgba(255,49,49,0.2)" borderRadius="md" p={3}>
                <Text fontSize="xs" color="#FF3131" fontFamily="mono">
                  {errorMessage.toUpperCase()}
                </Text>
              </Box>
            )}

            {successMessage && (
              <Box bg="rgba(57,255,20,0.07)" border="1px solid rgba(57,255,20,0.2)" borderRadius="md" p={3}>
                <Text fontSize="xs" color="#39FF14" fontFamily="mono">
                  {successMessage.toUpperCase()}
                </Text>
              </Box>
            )}

            <FormControl isRequired>
              <FormLabel sx={labelStyle}>Username</FormLabel>
              <Input
                id="setup-username"
                name="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. admin"
                sx={inputStyle}
              />
            </FormControl>

            <FormControl>
              <FormLabel sx={labelStyle}>Email (Optional)</FormLabel>
              <Input
                id="setup-email"
                name="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="e.g. admin@example.com"
                sx={inputStyle}
              />
            </FormControl>

            <FormControl isRequired>
              <FormLabel sx={labelStyle}>Password</FormLabel>
              <Input
                id="setup-password"
                name="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimum 12 characters"
                sx={inputStyle}
              />
            </FormControl>

            <Flex gap={3} pt={2}>
              <Link as={RouterLink} to="/login" flex={1}>
                <Button
                  variant="outline"
                  borderColor="obsidian.border"
                  color="white"
                  w="full"
                  h="38px"
                  disabled={busy}
                  _hover={{ bg: "rgba(255,255,255,0.05)" }}
                  fontFamily="mono"
                  fontSize="xs"
                >
                  Cancel
                </Button>
              </Link>
              <Button
                type="submit"
                disabled={busy || password.length < 12}
                bg="obsidian.cyan"
                color="black"
                flex={1}
                h="38px"
                _hover={{ bg: "#00D8E6" }}
                _disabled={{ bg: "rgba(0,240,255,0.15)", color: "rgba(0,0,0,0.5)", cursor: "not-allowed" }}
                leftIcon={busy ? <Spinner size="xs" color="black" /> : undefined}
                fontFamily="mono"
                fontSize="xs"
              >
                {busy ? "Setting up…" : "Register"}
              </Button>
            </Flex>
          </VStack>
        </Box>
      </Box>
    </Flex>
  );
}

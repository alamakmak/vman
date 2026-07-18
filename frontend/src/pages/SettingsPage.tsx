import { useEffect, useState } from "react";
import {
  Box,
  Flex,
  Heading,
  Text,
  Input,
  Select,
  Button,
  VStack,
  HStack,
  Icon,
  Tabs,
  TabList,
  TabPanels,
  Tab,
  TabPanel,
  FormControl,
  FormLabel,
  useToast,
  Spinner,
} from "@chakra-ui/react";
import { Save } from "lucide-react";
import { ApiClient } from "@/lib/api";

const client = new ApiClient({ baseUrl: "" });

interface AppSettings {
  env: "development" | "production";
  api_host: string;
  api_port: number;
  database_url: string;
  log_level: string;
  log_retention_days: number;
  metrics_retention_days: number;
  uvicorn_workers: number;
  worker_concurrency: number;
  ssh_connect_timeout_seconds: number;
  ssh_command_timeout_seconds: number;
}

const fieldProps = {
  bg: "obsidian.bg",
  borderColor: "obsidian.border",
  color: "white",
  _hover: { borderColor: "obsidian.cyan" },
  _focus: { borderColor: "obsidian.cyan", boxShadow: "none" },
} as const;

const labelProps = {
  fontSize: "xs",
  fontWeight: "bold" as const,
  color: "white",
  fontFamily: "mono",
  textTransform: "uppercase" as const,
};

export function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPw, setChangingPw] = useState(false);
  const toast = useToast();

  useEffect(() => {
    (async () => {
      try {
        const data = await client.get<AppSettings>("/api/settings");
        setSettings(data);
      } catch (err: any) {
        toast({
          title: "Error loading settings",
          description: err?.message || "Failed to retrieve configuration.",
          status: "error",
          duration: 5000,
          isClosable: true,
        });
      } finally {
        setLoading(false);
      }
    })();
  }, [toast]);

  const handleInputChange = (field: keyof AppSettings, value: any) => {
    if (!settings) return;
    setSettings({ ...settings, [field]: value });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings) return;
    setSaving(true);
    try {
      const updated = await client.post<AppSettings>("/api/settings", { json: settings });
      setSettings(updated);
      toast({
        title: "Settings Saved",
        description: "Application configuration updated.",
        status: "success",
        duration: 3000,
        isClosable: true,
      });
    } catch (err: any) {
      toast({
        title: "Save Failed",
        description: err?.message || "Failed to update configuration settings.",
        status: "error",
        duration: 5000,
        isClosable: true,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async (e?: React.FormEvent | React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    if (!currentPassword.trim()) {
      toast({
        title: "Current password required",
        status: "warning",
        duration: 4000,
        isClosable: true,
      });
      return;
    }
    if (newPassword.length < 12) {
      toast({
        title: "Password too short",
        description: "New password must be at least 12 characters.",
        status: "warning",
        duration: 4000,
        isClosable: true,
      });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({
        title: "Passwords do not match",
        status: "warning",
        duration: 4000,
        isClosable: true,
      });
      return;
    }
    setChangingPw(true);
    try {
      await client.post("/api/auth/password", {
        json: { current_password: currentPassword, new_password: newPassword },
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast({
        title: "Password updated",
        description: "Other sessions revoked. This session stays signed in.",
        status: "success",
        duration: 4000,
        isClosable: true,
      });
    } catch (err: any) {
      toast({
        title: "Password change failed",
        description: err?.message || "Could not change password.",
        status: "error",
        duration: 5000,
        isClosable: true,
      });
    } finally {
      setChangingPw(false);
    }
  };

  if (loading) {
    return (
      <Flex align="center" justify="center" minH="300px">
        <Spinner size="lg" color="obsidian.cyan" />
      </Flex>
    );
  }
  if (!settings) return null;

  const tabStyle = {
    color: "obsidian.onSurfaceVariant",
    fontSize: "sm",
    fontWeight: "medium" as const,
    _selected: { color: "obsidian.cyan", borderColor: "obsidian.cyan" },
    _hover: { color: "white" },
  };

  return (
    <Flex direction="column" gap={6} maxW="800px">
      <VStack align="start" spacing={1}>
        <Heading as="h1" size="lg" fontWeight="bold" color="white" letterSpacing="-0.02em">
          Application Settings
        </Heading>
        <Text fontSize="sm" color="obsidian.onSurfaceVariant" fontFamily="mono">
          Configure runtime environment, agentless operations, and resource profiles.
        </Text>
      </VStack>

      <Box bg="obsidian.surface" border="1px solid" borderColor="obsidian.border" borderRadius="md" p={6}>
        <Tabs colorScheme="cyan" variant="line">
          <TabList borderColor="obsidian.border" mb={6}>
            <Tab {...tabStyle}>General</Tab>
            <Tab {...tabStyle}>SSH Settings</Tab>
            <Tab {...tabStyle}>Worker Settings</Tab>
            <Tab {...tabStyle}>Retention</Tab>
            <Tab {...tabStyle}>Account</Tab>
          </TabList>

          <TabPanels>
            <TabPanel p={0}>
              <Box as="form" onSubmit={handleSave}>
                <VStack spacing={5} align="stretch">
                  <FormControl isRequired>
                    <FormLabel {...labelProps}>Environment</FormLabel>
                    <Select
                      value={settings.env}
                      onChange={(e) => handleInputChange("env", e.target.value)}
                      {...fieldProps}
                    >
                      <option value="development">development</option>
                      <option value="production">production</option>
                    </Select>
                  </FormControl>
                  <FormControl>
                    <FormLabel {...labelProps}>API Host</FormLabel>
                    <Input
                      value={settings.api_host}
                      onChange={(e) => handleInputChange("api_host", e.target.value)}
                      {...fieldProps}
                    />
                  </FormControl>
                  <FormControl>
                    <FormLabel {...labelProps}>API Port</FormLabel>
                    <Input
                      type="number"
                      value={settings.api_port}
                      onChange={(e) => handleInputChange("api_port", parseInt(e.target.value, 10))}
                      {...fieldProps}
                    />
                  </FormControl>
                  <FormControl>
                    <FormLabel {...labelProps}>Log Level</FormLabel>
                    <Select
                      value={settings.log_level}
                      onChange={(e) => handleInputChange("log_level", e.target.value)}
                      {...fieldProps}
                    >
                      {["DEBUG", "INFO", "WARNING", "ERROR"].map((l) => (
                        <option key={l} value={l}>
                          {l}
                        </option>
                      ))}
                    </Select>
                  </FormControl>
                  <HStack justify="end" pt={2}>
                    <Button
                      type="submit"
                      isLoading={saving}
                      leftIcon={<Icon as={Save} size={16} />}
                      bg="obsidian.cyan"
                      color="black"
                      fontSize="sm"
                      h="40px"
                    >
                      Save Configuration
                    </Button>
                  </HStack>
                </VStack>
              </Box>
            </TabPanel>

            <TabPanel p={0}>
              <Box as="form" onSubmit={handleSave}>
                <VStack spacing={5} align="stretch">
                  <FormControl>
                    <FormLabel {...labelProps}>SSH Connect Timeout (s)</FormLabel>
                    <Input
                      type="number"
                      value={settings.ssh_connect_timeout_seconds}
                      onChange={(e) =>
                        handleInputChange("ssh_connect_timeout_seconds", parseInt(e.target.value, 10))
                      }
                      {...fieldProps}
                    />
                  </FormControl>
                  <FormControl>
                    <FormLabel {...labelProps}>SSH Command Timeout (s)</FormLabel>
                    <Input
                      type="number"
                      value={settings.ssh_command_timeout_seconds}
                      onChange={(e) =>
                        handleInputChange("ssh_command_timeout_seconds", parseInt(e.target.value, 10))
                      }
                      {...fieldProps}
                    />
                  </FormControl>
                  <HStack justify="end" pt={2}>
                    <Button
                      type="submit"
                      isLoading={saving}
                      leftIcon={<Icon as={Save} size={16} />}
                      bg="obsidian.cyan"
                      color="black"
                      fontSize="sm"
                      h="40px"
                    >
                      Save Configuration
                    </Button>
                  </HStack>
                </VStack>
              </Box>
            </TabPanel>

            <TabPanel p={0}>
              <Box as="form" onSubmit={handleSave}>
                <VStack spacing={5} align="stretch">
                  <FormControl>
                    <FormLabel {...labelProps}>Uvicorn Workers</FormLabel>
                    <Input
                      type="number"
                      value={settings.uvicorn_workers}
                      onChange={(e) =>
                        handleInputChange("uvicorn_workers", parseInt(e.target.value, 10))
                      }
                      {...fieldProps}
                    />
                  </FormControl>
                  <FormControl>
                    <FormLabel {...labelProps}>Worker Concurrency</FormLabel>
                    <Input
                      type="number"
                      value={settings.worker_concurrency}
                      onChange={(e) =>
                        handleInputChange("worker_concurrency", parseInt(e.target.value, 10))
                      }
                      {...fieldProps}
                    />
                  </FormControl>
                  <HStack justify="end" pt={2}>
                    <Button
                      type="submit"
                      isLoading={saving}
                      leftIcon={<Icon as={Save} size={16} />}
                      bg="obsidian.cyan"
                      color="black"
                      fontSize="sm"
                      h="40px"
                    >
                      Save Configuration
                    </Button>
                  </HStack>
                </VStack>
              </Box>
            </TabPanel>

            <TabPanel p={0}>
              <Box as="form" onSubmit={handleSave}>
                <VStack spacing={5} align="stretch">
                  <FormControl isRequired>
                    <FormLabel {...labelProps}>Log Retention (Days)</FormLabel>
                    <Input
                      type="number"
                      value={settings.log_retention_days}
                      onChange={(e) =>
                        handleInputChange("log_retention_days", parseInt(e.target.value, 10))
                      }
                      {...fieldProps}
                    />
                  </FormControl>
                  <FormControl isRequired>
                    <FormLabel {...labelProps}>Metrics Retention (Days)</FormLabel>
                    <Input
                      type="number"
                      value={settings.metrics_retention_days}
                      onChange={(e) =>
                        handleInputChange("metrics_retention_days", parseInt(e.target.value, 10))
                      }
                      {...fieldProps}
                    />
                  </FormControl>
                  <HStack justify="end" pt={2}>
                    <Button
                      type="submit"
                      isLoading={saving}
                      leftIcon={<Icon as={Save} size={16} />}
                      bg="obsidian.cyan"
                      color="black"
                      fontSize="sm"
                      h="40px"
                    >
                      Save Configuration
                    </Button>
                  </HStack>
                </VStack>
              </Box>
            </TabPanel>

            <TabPanel p={0}>
              <VStack spacing={5} align="stretch" as="div">
                <Text fontSize="xs" color="obsidian.onSurfaceVariant" fontFamily="mono">
                  Change password for the signed-in operator. Other sessions are revoked.
                </Text>
                <FormControl>
                  <FormLabel {...labelProps}>Current password</FormLabel>
                  <Input
                    type="password"
                    autoComplete="current-password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    {...fieldProps}
                  />
                </FormControl>
                <FormControl>
                  <FormLabel {...labelProps}>New password</FormLabel>
                  <Input
                    type="password"
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Min 12 characters"
                    {...fieldProps}
                  />
                </FormControl>
                <FormControl>
                  <FormLabel {...labelProps}>Confirm new password</FormLabel>
                  <Input
                    type="password"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    {...fieldProps}
                  />
                </FormControl>
                <Button
                  type="button"
                  onClick={(e) => void handleChangePassword(e)}
                  isLoading={changingPw}
                  alignSelf="flex-start"
                  bg="obsidian.cyan"
                  color="black"
                  fontWeight="bold"
                  fontSize="sm"
                  h="40px"
                  px={6}
                  _hover={{ bg: "#00dbe9" }}
                  _disabled={{ opacity: 0.6, cursor: "not-allowed" }}
                >
                  Update password
                </Button>
              </VStack>
            </TabPanel>
          </TabPanels>
        </Tabs>
      </Box>
    </Flex>
  );
}

import { ApiClient } from "@/lib/api";

const client = new ApiClient({ baseUrl: "" });

export interface User {
  id: string;
  username: string;
  email: string | null;
  role: string;
  totp_enabled: boolean;
}

export interface LoginCredentials {
  username: string;
  password: string;
}

export async function login(credentials: LoginCredentials): Promise<User> {
  return client.post<User>("/api/auth/login", { json: credentials });
}

export async function getCurrentUser(): Promise<User> {
  return client.get<User>("/api/auth/me");
}

export async function logout(): Promise<void> {
  await client.post<{ status: string }>("/api/auth/logout", { json: {} });
}

import { afterEach, describe, expect, it } from "vitest";
import { getCurrentUser, login, logout } from "@/lib/authApi";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockFetchObserve(
  responder: (url: string, init?: RequestInit) => Response,
): { getLast: () => { url: string; init?: RequestInit } } {
  let last: { url: string; init?: RequestInit } = { url: "" };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : String(input);
    last = { url, init };
    return responder(url, init);
  }) as unknown as typeof fetch;
  return {
    getLast: () => last,
  };
}

describe("authApi", () => {
  it("posts credentials to /api/v1/auth/login with cookies enabled", async () => {
    const obs = mockFetchObserve(() =>
      new Response(
        JSON.stringify({
          id: "u1",
          username: "alice",
          email: null,
          role: "owner",
          totp_enabled: false,
        }),
        { status: 200 },
      ),
    );

    const user = await login({ username: "alice", password: "secret" });

    expect(user.username).toBe("alice");
    expect(obs.getLast().url).toBe("/api/auth/login");
    expect(obs.getLast().init?.method).toBe("POST");
    expect(obs.getLast().init?.credentials).toBe("include");
    expect(String(obs.getLast().init?.body ?? "")).toContain(
      '"password":"secret"',
    );
  });

  it("loads the current user from /api/v1/auth/me", async () => {
    const obs = mockFetchObserve(() =>
      new Response(
        JSON.stringify({
          id: "u1",
          username: "alice",
          email: null,
          role: "owner",
          totp_enabled: false,
        }),
        { status: 200 },
      ),
    );

    const user = await getCurrentUser();

    expect(user.id).toBe("u1");
    expect(obs.getLast().url).toBe("/api/auth/me");
    expect(obs.getLast().init?.credentials).toBe("include");
  });

  it("posts logout to /api/v1/auth/logout", async () => {
    const obs = mockFetchObserve(() =>
      new Response(JSON.stringify({ status: "ok" }), { status: 200 }),
    );

    await logout();

    expect(obs.getLast().url).toBe("/api/auth/logout");
    expect(obs.getLast().init?.method).toBe("POST");
  });
});

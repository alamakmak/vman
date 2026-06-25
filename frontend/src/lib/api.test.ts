import { afterEach, describe, expect, it } from "vitest";
import { ApiClient, ApiError } from "@/lib/api";

const originalFetch = globalThis.fetch;
const originalDocument = globalThis.document;

afterEach(() => {
  globalThis.fetch = originalFetch;
  Object.defineProperty(globalThis, "document", {
    value: originalDocument,
    configurable: true,
  });
});

describe("api client", () => {
  it("builds URLs relative to the base path", async () => {
    let observedUrl = "";
    const client = new ApiClient({ baseUrl: "/api/v1" });
    const fetchMock = async (
      input: RequestInfo | URL,
      _init?: RequestInit,
    ): Promise<Response> => {
      observedUrl = String(input);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      const data = await client.get<{ ok: boolean }>("health");
      expect(data.ok).toBe(true);
      expect(observedUrl).toBe("/api/v1/health");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("echoes the backend vman_csrf cookie on mutating requests", async () => {
    let observedHeader: string | null = null;
    const client = new ApiClient({ baseUrl: "/api/v1" });
    Object.defineProperty(globalThis, "document", {
      value: { cookie: "vman_csrf=csrf-token; other=value" },
      configurable: true,
    });
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      observedHeader = new Headers(init?.headers).get("X-CSRF-Token");
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as unknown as typeof fetch;

    await client.post("auth/logout", { json: {} });

    expect(observedHeader).toBe("csrf-token");
  });

  it("throws ApiError on non-2xx responses", async () => {
    const client = new ApiClient({ baseUrl: "/api/v1" });
    const fetchMock = async (): Promise<Response> =>
      new Response(JSON.stringify({ detail: "nope" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      await expect(client.get("x")).rejects.toBeInstanceOf(ApiError);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

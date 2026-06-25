/**
 * Minimal typed HTTP client for the VMAN FastAPI backend.
 *
 * The backend is expected to be served either at the same origin (in
 * production behind a reverse proxy) or on `http://127.0.0.1:8000`
 * (in development, via the Vite proxy on `/api`).
 *
 * Authentication uses session cookies issued by the backend. CSRF tokens
 * are read from the `vman_csrf` cookie and echoed back via the
 * `X-CSRF-Token` header. This matches the backend's CSRF middleware.
 */

const DEFAULT_BASE_URL = "/api/v1";

export type ApiErrorBody = {
  detail?: string;
  message?: string;
};

export class ApiError extends Error {
  readonly status: number;
  readonly body: ApiErrorBody | undefined;

  constructor(status: number, body: ApiErrorBody | undefined, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const prefix = `${encodeURIComponent(name)}=`;
  for (const part of document.cookie.split("; ")) {
    if (part.startsWith(prefix)) {
      return decodeURIComponent(part.slice(prefix.length));
    }
  }
  return null;
}

function csrfToken(): string | null {
  return readCookie("vman_csrf");
}

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export type ApiRequestInit = Omit<RequestInit, "body"> & {
  json?: unknown;
  body?: BodyInit | unknown;
};

export interface ApiClientOptions {
  baseUrl?: string;
  credentials?: RequestCredentials;
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly credentials: RequestCredentials;

  constructor(options: ApiClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.credentials = options.credentials ?? "include";
  }

  async request<T>(path: string, init: ApiRequestInit = {}): Promise<T> {
    const { json, body, headers, method, ...rest } = init;

    const finalHeaders = new Headers(headers);
    finalHeaders.set("Accept", "application/json");

    let finalBody: BodyInit | undefined;
    if (json !== undefined) {
      finalHeaders.set("Content-Type", "application/json");
      finalBody = JSON.stringify(json);
    } else if (body !== undefined && body !== null) {
      finalBody = body as BodyInit;
    }

    // CSRF: send token for non-GET methods if a cookie is set.
    const verb = (method ?? "GET").toUpperCase();
    if (verb !== "GET" && verb !== "HEAD" && verb !== "OPTIONS") {
      const token = csrfToken();
      if (token) finalHeaders.set("X-CSRF-Token", token);
    }

    const url = `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
    const response = await fetch(url, {
      ...rest,
      method: verb,
      headers: finalHeaders,
      body: finalBody,
      credentials: this.credentials,
    });

    const parsed = await parseBody(response);

    if (!response.ok) {
      const errorBody = parsed as ApiErrorBody | undefined;
      const detailMessage =
        (errorBody && typeof errorBody.detail === "string" && errorBody.detail) ||
        (errorBody &&
          typeof errorBody.message === "string" &&
          errorBody.message) ||
        `Request failed with status ${response.status}`;
      throw new ApiError(response.status, errorBody, detailMessage);
    }

    return parsed as T;
  }

  get<T>(path: string, init?: ApiRequestInit): Promise<T> {
    return this.request<T>(path, { ...init, method: "GET" });
  }

  post<T>(path: string, init?: ApiRequestInit): Promise<T> {
    return this.request<T>(path, { ...init, method: "POST" });
  }

  put<T>(path: string, init?: ApiRequestInit): Promise<T> {
    return this.request<T>(path, { ...init, method: "PUT" });
  }

  patch<T>(path: string, init?: ApiRequestInit): Promise<T> {
    return this.request<T>(path, { ...init, method: "PATCH" });
  }

  delete<T>(path: string, init?: ApiRequestInit): Promise<T> {
    return this.request<T>(path, { ...init, method: "DELETE" });
  }
}

export const api = new ApiClient();
export const ApiClientCtor = ApiClient;

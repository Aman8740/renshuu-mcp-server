export interface Overview {
  configured: boolean;
  totalRequestsAllTime: number;
  totalErrorsAllTime: number;
  errorRateAllTime: number;
  avgDurationMsAllTime: number;
  requestsToday: number;
  errorsToday: number;
  errorRateToday: number;
  uniqueUsersAllTime: number;
  uniqueUsersToday: number;
}

export interface TimeseriesPoint {
  bucket: string;
  total: number;
  errors: number;
}

export interface ToolBreakdownEntry {
  tool: string;
  callsAllTime: number;
  callsToday: number;
}

export interface McpEvent {
  ts: number;
  method: string;
  toolName?: string;
  userHash?: string;
  authMethod: "header" | "oauth" | "env_fallback" | "none";
  success: boolean;
  durationMs: number;
}

export interface UserRow {
  userHash: string;
  firstSeen: number;
  lastSeen: number;
  totalCalls: number;
}

export type OAuthEventType =
  | "client_registered"
  | "authorize_shown"
  | "login_success"
  | "login_failed"
  | "token_issued"
  | "token_refreshed"
  | "token_exchange_failed";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body?.error ?? "request_failed");
  }
  return res.json() as Promise<T>;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const api = {
  login: (username: string, password: string) =>
    request<{ ok: true }>("/admin/api/login", { method: "POST", body: JSON.stringify({ username, password }) }),
  logout: () => request<{ ok: true }>("/admin/api/logout", { method: "POST" }),
  me: () => request<{ username: string }>("/admin/api/me"),
  overview: () => request<Overview>("/admin/api/overview"),
  timeseries: (range: "24h" | "30d") => request<TimeseriesPoint[]>(`/admin/api/timeseries?range=${range}`),
  tools: () => request<ToolBreakdownEntry[]>("/admin/api/tools"),
  authMethods: () => request<Record<string, number>>("/admin/api/auth-methods"),
  activity: (limit = 100) => request<McpEvent[]>(`/admin/api/activity?limit=${limit}`),
  errors: (limit = 50) => request<McpEvent[]>(`/admin/api/errors?limit=${limit}`),
  users: () => request<UserRow[]>("/admin/api/users"),
  oauthFunnel: () => request<Record<OAuthEventType, number>>("/admin/api/oauth-funnel"),
};

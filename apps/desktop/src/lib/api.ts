import { authStore } from "./auth-store";

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "http://127.0.0.1:8000";

export class ApiError extends Error {
  constructor(public status: number, public body: unknown) {
    super(typeof body === "object" && body && "detail" in body ? String((body as any).detail) : `HTTP ${status}`);
  }
}

async function attempt(input: string, init: RequestInit, withAuth: boolean): Promise<Response> {
  const headers = new Headers(init.headers ?? {});
  if (withAuth) {
    const token = authStore.access;
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return fetch(`${BASE}${input}`, { ...init, headers });
}

export async function api<T = unknown>(input: string, init: RequestInit = {}, options: { auth?: boolean } = {}): Promise<T> {
  const auth = options.auth ?? true;
  let res = await attempt(input, init, auth);

  if (res.status === 401 && auth && authStore.refresh) {
    // try refresh once
    const ok = await authStore.tryRefresh();
    if (ok) res = await attempt(input, init, true);
  }
  if (!res.ok) {
    const ct = res.headers.get("content-type") ?? "";
    const body = ct.includes("application/json") ? await res.json() : await res.text();
    throw new ApiError(res.status, body);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const API_BASE = BASE;

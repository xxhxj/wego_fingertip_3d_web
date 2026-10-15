import { useSyncExternalStore } from "react";

const TOKEN_KEY = "wego_token";

export const SSO_WEB = import.meta.env.VITE_SSO_WEB || "http://127.0.0.1:5174";
export const SSO_API = import.meta.env.VITE_SSO_API || "http://127.0.0.1:3001";

export interface SessionUser {
  nickname: string;
  username: string;
  member: boolean;
  workspace: boolean;
  tutorials: boolean;
}

export type SessionPhase = "loading" | "ready" | "denied";

interface SessionState {
  phase: SessionPhase;
  user: SessionUser | null;
}

let state: SessionState = { phase: "loading", user: null };
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

export function getSession(): SessionState {
  return state;
}

export function subscribeSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSession(): SessionState {
  return useSyncExternalStore(subscribeSession, getSession, getSession);
}

export function isE2E(): boolean {
  return new URLSearchParams(location.search).has("e2e");
}

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) || "";
}

export function authHeaders(): HeadersInit {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function ensureLogin(): boolean {
  if (isE2E()) return true;
  const url = new URL(location.href);
  const incoming = url.searchParams.get("token");
  if (incoming) {
    localStorage.setItem(TOKEN_KEY, incoming);
    url.searchParams.delete("token");
    history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }
  if (!getToken()) {
    const back = `${location.origin}${location.pathname}`;
    location.href = `${SSO_WEB}/login?redirect=${encodeURIComponent(back)}`;
    return false;
  }
  return true;
}

export function logout(): void {
  localStorage.removeItem(TOKEN_KEY);
  const back = `${location.origin}${location.pathname}`;
  location.href = `${SSO_WEB}/login?logout=1&redirect=${encodeURIComponent(back)}`;
}

function flattenMenus(nodes: { path?: string; children?: { path?: string; children?: never[] }[] }[] | undefined, paths: string[] = []): string[] {
  for (const node of nodes || []) {
    if (node.path) paths.push(node.path);
    flattenMenus(node.children, paths);
  }
  return paths;
}

export async function loadSession(): Promise<void> {
  if (isE2E()) {
    state = {
      phase: "ready",
      user: { nickname: "预览", username: "e2e", member: true, workspace: true, tutorials: true },
    };
    emit();
    return;
  }
  const me = await fetch(`${SSO_API}/api/auth/me`, { headers: authHeaders() });
  if (me.status === 401) {
    logout();
    return;
  }
  if (!me.ok) throw new Error("登录状态校验失败");
  const user = await me.json() as { nickname?: string; username: string; member?: boolean };
  const menuResponse = await fetch(`${SSO_API}/api/auth/menus?app=wego-cad`, { headers: authHeaders() });
  if (menuResponse.status === 401) {
    logout();
    return;
  }
  const menuData = await menuResponse.json() as { data?: { path?: string; children?: [] }[] };
  const paths = new Set(flattenMenus(menuData.data));
  const workspace = paths.has("workspace");
  const tutorials = paths.has("tutorials");
  state = {
    phase: workspace || tutorials ? "ready" : "denied",
    user: {
      nickname: user.nickname || user.username,
      username: user.username,
      member: Boolean(user.member),
      workspace,
      tutorials,
    },
  };
  emit();
}

export async function buyMembership(plan: "month" | "year"): Promise<string> {
  const response = await fetch(`${SSO_API}/api/auth/membership`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ plan }),
  });
  const data = await response.json() as { message?: string; member?: boolean };
  if (!response.ok) throw new Error(data.message || "开通失败");
  if (state.user) {
    state = { ...state, user: { ...state.user, member: true } };
    emit();
  }
  return data.message || "会员已开通";
}

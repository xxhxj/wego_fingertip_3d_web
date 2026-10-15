import { useSyncExternalStore } from "react";

export type ScreenName = "model" | "learn";
export type FlyoutName =
  | "sketch"
  | "insert"
  | "construct"
  | "transform"
  | "tools"
  | "visual"
  | "file"
  | "edit"
  | "projectMenu"
  | "view"
  | "help"
  | "items"
  | "display";

export type DisplayMode = "shaded" | "wireframe";

export interface ShellState {
  screen: ScreenName;
  flyout: FlyoutName | null;
  history: boolean;
  search: boolean;
  memberOpen: boolean;
  displayMode: DisplayMode;
}

let state: ShellState = {
  screen: "model",
  flyout: null,
  history: false,
  search: false,
  memberOpen: false,
  displayMode: "shaded",
};

const listeners = new Set<() => void>();

function emit(next: ShellState): void {
  state = next;
  listeners.forEach((listener) => listener());
}

export function getShell(): ShellState {
  return state;
}

export function subscribeShell(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useShell(): ShellState {
  return useSyncExternalStore(subscribeShell, getShell, getShell);
}

export function toggleFlyout(flyout: FlyoutName): void {
  emit({ ...state, flyout: state.flyout === flyout ? null : flyout, search: false });
}

export function closeFlyout(): void {
  if (!state.flyout) return;
  emit({ ...state, flyout: null });
}

export function setScreen(screen: ScreenName): void {
  emit({ ...state, screen, flyout: null, search: false });
}

export function toggleHistory(): void {
  emit({ ...state, history: !state.history, flyout: null });
}

export function setHistory(history: boolean): void {
  emit({ ...state, history, flyout: null });
}

export function setSearch(search: boolean): void {
  emit({ ...state, search, flyout: search ? null : state.flyout });
}

export function setMemberOpen(memberOpen: boolean): void {
  emit({ ...state, memberOpen });
}

export function setDisplayMode(displayMode: DisplayMode): void {
  emit({ ...state, displayMode, flyout: null });
}

export function closeTransient(): void {
  if (!state.flyout && !state.search) return;
  emit({ ...state, flyout: null, search: false });
}

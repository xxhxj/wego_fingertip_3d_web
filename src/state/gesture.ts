import type { Draft } from "../model/types";

export interface GestureState {
  draft: Draft | null;
  readout: string;
}

let gesture: GestureState = { draft: null, readout: "" };
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

export function getGesture(): GestureState {
  return gesture;
}

export function subscribeGesture(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setGesture(partial: Partial<GestureState>): void {
  gesture = { ...gesture, ...partial };
  emit();
}

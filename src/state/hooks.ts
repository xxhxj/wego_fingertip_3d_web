import { useSyncExternalStore } from "react";
import { getState, subscribe } from "./editor";
import { getGesture, subscribeGesture } from "./gesture";

export function useEditor() {
  return useSyncExternalStore(subscribe, getState, getState);
}

export function useGesture() {
  return useSyncExternalStore(subscribeGesture, getGesture, getGesture);
}

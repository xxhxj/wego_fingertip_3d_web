import { useEffect } from "react";
import {
  beginExtrude,
  cancelDraft,
  cancelExtrude,
  cancelRevolve,
  cancelBoolean,
  cancelEdgePick,
  closePolyline,
  confirmExtrude,
  confirmRevolve,
  deleteSelection,
  finishSketch,
  getState,
  redo,
  setTool,
  undo,
} from "./state/editor";
import { getGesture } from "./state/gesture";
import { useEditor, useGesture } from "./state/hooks";
import { LicenseDialog } from "./ui/LicenseDialog";
import { FeatureTree } from "./ui/FeatureTree";
import { PropertyPanel } from "./ui/PropertyPanel";
import { ShortcutBar } from "./ui/ShortcutBar";
import { ToolRail } from "./ui/ToolRail";
import { TopBar } from "./ui/TopBar";
import { Viewport } from "./viewport/Viewport";

export function App() {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      const meta = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (meta && key === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (meta && key === "y") {
        event.preventDefault();
        redo();
        return;
      }
      if (event.key === "Escape") {
        const current = getState();
        if (current.extrudeDraft) cancelExtrude();
        else if (current.revolveDraft) cancelRevolve();
        else if (current.pendingBoolean) cancelBoolean();
        else if (current.edgePick || current.pendingBisect) cancelEdgePick();
        else if (getGesture().draft) cancelDraft();
        else if (current.activeSketchId) finishSketch();
        else setTool("select");
        return;
      }
      if (event.key === "Enter") {
        if (getState().tool === "polyline") closePolyline();
        else if (getState().extrudeDraft) confirmExtrude();
        else if (getState().revolveDraft) confirmRevolve();
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        deleteSelection();
        return;
      }
      if (meta) return;
      if (key === "v") setTool("select");
      else if (key === "r") setTool("rectangle");
      else if (key === "c") setTool("circle");
      else if (key === "l") setTool("polyline");
      else if (key === "a") setTool("arc");
      else if (key === "e") beginExtrude();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="app">
      <TopBar />
      <div className="workspace">
        <ToolRail />
        <Viewport />
        <aside className="side">
          <FeatureTree />
          <PropertyPanel />
        </aside>
      </div>
      <StatusBar />
      <ShortcutBar />
      <LicenseDialog />
    </div>
  );
}

function StatusBar() {
  const editor = useEditor();
  const gesture = useGesture();
  return (
    <footer className="status">
      <span>{gesture.readout || editor.status}</span>
      <span>{editor.kernelMessage}</span>
      <span>单位 mm · Z 轴朝上 · WebGPU</span>
    </footer>
  );
}

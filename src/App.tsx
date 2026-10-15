import { useEffect, type ReactNode } from "react";
import {
  beginExtrude,
  cancelBoolean,
  cancelDraft,
  cancelExtrude,
  cancelFaceOffset,
  cancelRevolve,
  closePolyline,
  confirmExtrude,
  confirmFaceOffset,
  confirmLoft,
  confirmRevolve,
  deleteSelection,
  finishSketch,
  finishSpline,
  getState,
  redo,
  setTool,
  undo,
} from "./state/editor";
import { getGesture } from "./state/gesture";
import { useEditor, useGesture } from "./state/hooks";
import { closeTransient, getShell, setScreen, setSearch, toggleFlyout, toggleHistory, useShell } from "./state/shell";
import { loadSession, useSession } from "./session";
import { LicenseDialog } from "./ui/LicenseDialog";
import { CommandPalette } from "./ui/CommandPalette";
import { MemberBanner, MemberDialog } from "./ui/MemberDialog";
import { FeatureTree } from "./ui/FeatureTree";
import { PropertyPanel } from "./ui/PropertyPanel";
import { ShortcutBar } from "./ui/ShortcutBar";
import { ToolRail } from "./ui/ToolRail";
import { TopBar } from "./ui/TopBar";
import { Tutorials } from "./ui/Tutorials";
import { Viewport } from "./viewport/Viewport";

export function App() {
  const session = useSession();
  const shell = useShell();
  const editor = useEditor();

  useEffect(() => {
    void loadSession().catch(() => undefined);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      const meta = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (meta && event.altKey && key === "h") {
        event.preventDefault();
        setScreen("model");
        toggleHistory();
        return;
      }
      if (meta && event.altKey && key === "s") {
        event.preventDefault();
        setScreen("model");
        toggleFlyout("items");
        return;
      }
      if (meta && event.shiftKey && event.code === "Backslash") {
        event.preventDefault();
        setScreen("model");
        setTool("select");
        return;
      }
      if (meta && key === "f") {
        event.preventDefault();
        setSearch(!getShell().search);
        return;
      }
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
        if (getShell().flyout || getShell().search) {
          closeTransient();
          return;
        }
        const current = getState();
        if (current.faceDraft) cancelFaceOffset();
        else if (current.extrudeDraft) cancelExtrude();
        else if (current.revolveDraft) cancelRevolve();
        else if (current.pendingBoolean) cancelBoolean();
        else if (current.edgePick || current.pendingBisect || current.pendingSweep || current.pendingLoft.length > 0 || current.tool === "measure") setTool("select");
        else if (getGesture().draft) cancelDraft();
        else if (current.activeSketchId) finishSketch();
        else setTool("select");
        return;
      }
      if (event.key === "Enter") {
        if (getState().tool === "polyline") closePolyline();
        else if (getState().tool === "spline") finishSpline();
        else if (getState().tool === "loft") confirmLoft();
        else if (getState().faceDraft) confirmFaceOffset();
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
      if (shell.screen !== "model") return;
      if (key === "v") setTool("select");
      else if (key === "r") setTool("rectangle");
      else if (key === "c") setTool("circle");
      else if (key === "l") setTool("polyline");
      else if (key === "a") setTool("arc");
      else if (key === "e") beginExtrude();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shell.screen]);

  if (session.phase === "loading") return <Splash title="正在核对登录" />;
  if (session.phase === "denied") {
    return (
      <Splash title="没有三维建模权限">
        <p>请让管理员在单点系统里把「三维建模」菜单授给当前角色。</p>
      </Splash>
    );
  }

  const drafting = Boolean(editor.extrudeDraft || editor.revolveDraft || editor.pendingBoolean || editor.tool === "loft" || editor.tool === "sweep");
  const showInspector = drafting || editor.selection?.kind === "feature" || editor.selection?.kind === "body" || editor.selection?.kind === "plane";

  return (
    <div className="app">
      <TopBar />
      {shell.screen === "learn" || (session.user && !session.user.workspace && session.user.tutorials) ? (
        <Tutorials />
      ) : (
        <div className="stage">
          <Viewport />
          <ToolRail />
          <MemberBanner />
          {shell.history ? (
            <aside className="history-panel">
              <FeatureTree />
              <PropertyPanel />
            </aside>
          ) : showInspector ? (
            <aside className="float-inspector">
              <PropertyPanel />
            </aside>
          ) : null}
          <ShortcutBar />
        </div>
      )}
      {shell.screen === "model" && <StatusBar />}
      {shell.search && <CommandPalette />}
      <LicenseDialog />
      <MemberDialog />
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
      <span>单位 mm · Z 轴朝上</span>
    </footer>
  );
}

function Splash({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="splash">
      <div className="splash-mark" aria-hidden="true" />
      <strong>Wego CAD</strong>
      <p>{title}</p>
      {children}
    </div>
  );
}

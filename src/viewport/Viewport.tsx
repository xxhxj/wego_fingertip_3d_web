import { useEffect, useRef } from "react";
import { finishSketch, setView, toggleSection } from "../state/editor";
import { useEditor } from "../state/hooks";
import { setDisplayMode, setHistory, useShell } from "../state/shell";
import { getViewport, mountViewport } from "./engine";
import type { ViewName } from "../model/types";

const FACES: { id: ViewName; label: string }[] = [
  { id: "top", label: "上" },
  { id: "left", label: "左" },
  { id: "front", label: "前" },
  { id: "right", label: "右" },
  { id: "bottom", label: "下" },
  { id: "back", label: "后" },
  { id: "iso", label: "轴测" },
];

export function Viewport() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const editor = useEditor();
  const shell = useShell();
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const api = mountViewport(canvas);
    return () => api.dispose();
  }, []);
  useEffect(() => {
    getViewport()?.setDisplayMode(shell.displayMode);
  }, [shell.displayMode]);

  const sketch = editor.doc.sketches.find((item) => item.id === editor.activeSketchId);
  const showHint = !editor.viewportMessage && editor.doc.bodies.length === 0 && !editor.activeSketchId;

  return (
    <div className="viewport" onPointerDown={() => undefined}>
      <canvas ref={canvasRef} />
      <div className="hud-right">
        <div className="view-cube" data-current={editor.viewName} aria-label="视图方块">
          {FACES.map((view) => (
            <button
              key={view.id}
              type="button"
              data-view={view.id}
              className={editor.viewName === view.id ? "active" : undefined}
              onClick={() => setView(view.id)}
            >
              {view.label}
            </button>
          ))}
        </div>
        <div className="scale-chip">50<small>毫米</small></div>
        <button
          type="button"
          className="hud-btn"
          onClick={() => setDisplayMode(shell.displayMode === "shaded" ? "wireframe" : "shaded")}
        >
          <span>显示模式</span>
          <strong>{shell.displayMode === "shaded" ? "着色" : "线框"}</strong>
        </button>
        <button
          type="button"
          className="hud-btn"
          onClick={() => {
            const url = getViewport()?.capture();
            if (!url) return;
            const link = document.createElement("a");
            link.href = url;
            link.download = `${editor.projectName || "截图"}.png`;
            link.click();
          }}
        >
          <svg viewBox="0 0 24 24"><path d="M8 7l1.5-2h5L16 7h3v11H5V7z" /><circle cx="12" cy="12" r="3" /></svg>
          <span>截图</span>
        </button>
        <button type="button" className={shell.history ? "hud-btn active" : "hud-btn"} onClick={() => setHistory(!shell.history)}>
          <span>Ctrl Alt H</span>
          <strong>历史记录</strong>
        </button>
        <button type="button" className="hud-btn" data-section={editor.sectionPlaneId ? "on" : "off"} onClick={() => toggleSection()}>
          {editor.sectionPlaneId ? "关闭剖视" : "剖视"}
        </button>
      </div>
      {editor.tool === "measure" && <div className="measure-readout">{editor.status}</div>}
      {sketch && (
        <div className="sketch-banner">
          <span>{sketch.name}</span>
          <button type="button" onClick={() => getViewport()?.alignToActiveSketch()}>正对草图</button>
          <button type="button" className="primary" onClick={finishSketch}>完成草图</button>
        </div>
      )}
      {editor.viewportMessage && <div className="viewport-error">{editor.viewportMessage}</div>}
      {showHint && <div className="hint">点选基准面，或从左侧绘制草图。返回教程可以生成桌面收纳盒。</div>}
    </div>
  );
}

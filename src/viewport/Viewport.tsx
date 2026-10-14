import { useEffect, useRef } from "react";
import { finishSketch, setView, toggleSection } from "../state/editor";
import { useEditor } from "../state/hooks";
import { getViewport, mountViewport } from "./engine";
import type { ViewName } from "../model/types";

const CUBE: { id: ViewName; label: string }[] = [
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
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const api = mountViewport(canvas);
    return () => api.dispose();
  }, []);

  const sketch = editor.doc.sketches.find((item) => item.id === editor.activeSketchId);
  const showHint = !editor.viewportMessage && editor.doc.bodies.length === 0 && !editor.activeSketchId;

  return (
    <div className="viewport">
      <canvas ref={canvasRef} />
      <div className="view-cube" data-current={editor.viewName}>
        {CUBE.map((view) => (
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
        <button type="button" data-section={editor.sectionPlaneId ? "on" : "off"} onClick={() => toggleSection()}>
          {editor.sectionPlaneId ? "关闭剖视" : "剖视"}
        </button>
      </div>
      {editor.tool === "measure" && <div className="measure-readout">{editor.status}</div>}
      <p className="legend">XY 绿 · XZ 蓝 · YZ 红 · 轴：X 红 Y 绿 Z 蓝</p>
      {sketch && (
        <div className="sketch-banner">
          <span>{sketch.name}</span>
          <button type="button" onClick={() => getViewport()?.alignToActiveSketch()}>正对草图</button>
          <button type="button" className="primary" onClick={finishSketch}>完成草图</button>
        </div>
      )}
      {editor.viewportMessage && <div className="viewport-error">{editor.viewportMessage}</div>}
      {showHint && <div className="hint">点选一个基准面，或在左侧选择矩形、圆开始草图。</div>}
    </div>
  );
}

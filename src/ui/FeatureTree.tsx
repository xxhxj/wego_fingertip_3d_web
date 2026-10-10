import { entityLabel } from "../model/profiles";
import {
  beginExtrude,
  continueSketch,
  isolateBody,
  select,
  setBodyVisible,
  showAllBodies,
  startSketch,
} from "../state/editor";
import { useEditor } from "../state/hooks";

export function FeatureTree() {
  const editor = useEditor();
  const { doc, selection } = editor;
  return (
    <section className="tree">
      <h2>特征树</h2>
      <p className="section-label">基准平面</p>
      {doc.planes.map((plane) => (
        <div key={plane.id} className={rowClass(selection?.kind === "plane" && selection.id === plane.id)}>
          <button type="button" className="row-main" onClick={() => select({ kind: "plane", id: plane.id })}>
            <i className={`swatch plane-${plane.id}`} />
            {plane.name}
          </button>
          <button type="button" className="mini" onClick={() => startSketch(plane.id)}>草图</button>
        </div>
      ))}
      <p className="section-label">草图</p>
      {doc.sketches.length === 0 && <p className="empty">还没有草图</p>}
      {doc.sketches.map((sketch) => (
        <div key={sketch.id} className="block">
          <div className={rowClass(selection?.kind === "sketch" && selection.id === sketch.id)}>
            <button type="button" className="row-main" onClick={() => select({ kind: "sketch", id: sketch.id })}>{sketch.name}</button>
            <button type="button" className="mini" onClick={() => continueSketch(sketch.id)}>绘制</button>
          </div>
          {sketch.entities.map((entity) => (
            <div key={entity.id} className={rowClass(selection?.kind === "entity" && selection.entityId === entity.id, true)}>
              <button type="button" className="row-main" onClick={() => select({ kind: "entity", sketchId: sketch.id, entityId: entity.id })}>
                {entityLabel(entity)}
              </button>
              <button type="button" className="mini" onClick={() => beginExtrude(sketch.id, entity.id)}>拉伸</button>
            </div>
          ))}
        </div>
      ))}
      <p className="section-label">特征</p>
      {doc.features.length === 0 && <p className="empty">还没有特征</p>}
      {doc.features.map((feature) => (
        <button
          key={feature.id}
          type="button"
          className={rowClass(selection?.kind === "feature" && selection.id === feature.id)}
          onClick={() => select({ kind: "feature", id: feature.id })}
        >
          {feature.name}
          <small>{feature.start} → {feature.end} mm</small>
        </button>
      ))}
      <div className="section-head">
        <p className="section-label">实体</p>
        {doc.bodies.length > 0 && <button type="button" className="mini" onClick={showAllBodies}>全部显示</button>}
      </div>
      {doc.bodies.length === 0 && <p className="empty">拉伸后会出现在这里</p>}
      {doc.bodies.map((body) => (
        <div key={body.id} className={rowClass(selection?.kind === "body" && selection.id === body.id)}>
          <button type="button" className="row-main" onClick={() => select({ kind: "body", id: body.id })}>
            <i className="swatch" style={{ background: body.color }} />
            {body.name}
            {editor.errors[body.id] && <small className="danger">{editor.errors[body.id]}</small>}
          </button>
          <button type="button" className="mini" onClick={() => setBodyVisible(body.id, !body.visible)}>{body.visible ? "隐藏" : "显示"}</button>
          <button type="button" className="mini" onClick={() => isolateBody(body.id)}>独显</button>
        </div>
      ))}
    </section>
  );
}

function rowClass(active: boolean, nested = false): string {
  return `row${active ? " active" : ""}${nested ? " nested" : ""}`;
}

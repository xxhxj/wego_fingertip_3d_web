import { entityLabel } from "../model/profiles";
import type { ExtrudeFeature } from "../model/types";
import {
  beginExtrude,
  beginTransient,
  cancelExtrude,
  confirmExtrude,
  continueSketch,
  deleteSelection,
  endTransient,
  setBodyColor,
  setBodyVisible,
  setDraftDistances,
  setFeatureDistances,
  startSketch,
} from "../state/editor";
import { useEditor } from "../state/hooks";

const volumeFormat = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 });

export function PropertyPanel() {
  const editor = useEditor();
  const draft = editor.extrudeDraft;
  if (draft) {
    const sketch = editor.doc.sketches.find((item) => item.id === draft.sketchId);
    const entity = sketch?.entities.find((item) => item.id === draft.entityId);
    return (
      <section className="props">
        <h2>拉伸预览</h2>
        <p className="hint-copy">{sketch?.name} · {entity ? entityLabel(entity) : "截面"}</p>
        <DistanceFields
          start={draft.start}
          end={draft.end}
          onChange={(start, end) => setDraftDistances(start, end)}
        />
        {editor.errors.__preview__ && <p className="danger">{editor.errors.__preview__}</p>}
        {editor.preview && <p className="metric">预览体积 {volumeFormat.format(editor.preview.volume)} mm³</p>}
        <div className="button-row">
          <button type="button" className="primary" onClick={confirmExtrude}>确认拉伸</button>
          <button type="button" onClick={cancelExtrude}>取消</button>
        </div>
        <p className="hint-copy">沿平面法向，单位 mm。拖动视口里的圆点可改距离，按住 Alt 以 0.1 mm 吸附。</p>
      </section>
    );
  }

  const selection = editor.selection;
  const feature = selectedFeature(editor.doc.features, editor.doc.bodies, selection);
  const body = selection?.kind === "body"
    ? editor.doc.bodies.find((item) => item.id === selection.id)
    : editor.doc.bodies.find((item) => item.featureId === feature?.id);
  if (feature) {
    return (
      <section className="props">
        <h2>{feature.name}</h2>
        <DistanceFields
          start={feature.start}
          end={feature.end}
          onChange={(start, end) => setFeatureDistances(feature.id, start, end)}
          onSessionStart={beginTransient}
          onSessionEnd={endTransient}
        />
        {body && editor.errors[body.id] && <p className="danger">{editor.errors[body.id]}</p>}
        {body && editor.volumes[body.id] != null && <p className="metric">体积 {volumeFormat.format(editor.volumes[body.id])} mm³</p>}
        {body && (
          <>
            <label className="field">颜色
              <input
                type="color"
                value={body.color}
                onFocus={beginTransient}
                onChange={(event) => setBodyColor(body.id, event.target.value)}
                onBlur={endTransient}
              />
            </label>
            <label className="check">
              <input type="checkbox" checked={body.visible} onChange={(event) => setBodyVisible(body.id, event.target.checked)} />
              显示实体
            </label>
          </>
        )}
        <button type="button" className="danger-button" onClick={deleteSelection}>删除特征</button>
      </section>
    );
  }

  if (selection?.kind === "plane") {
    const plane = editor.doc.planes.find((item) => item.id === selection.id);
    return (
      <section className="props">
        <h2>{plane?.name}</h2>
        <p className="hint-copy">点选这个平面后可以直接在上面开草图。草图坐标的 u 轴沿平面 x 方向，v 轴由法向叉乘得到。</p>
        <button type="button" className="primary" onClick={() => plane && startSketch(plane.id)}>在此开草图</button>
      </section>
    );
  }

  if (selection?.kind === "sketch" || selection?.kind === "entity") {
    const sketchId = selection.kind === "sketch" ? selection.id : selection.sketchId;
    const sketch = editor.doc.sketches.find((item) => item.id === sketchId);
    const entity = selection.kind === "entity"
      ? sketch?.entities.find((item) => item.id === selection.entityId)
      : sketch?.entities[0];
    return (
      <section className="props">
        <h2>{sketch?.name}</h2>
        {entity && <p className="metric">{entityLabel(entity)}</p>}
        <div className="button-row">
          <button type="button" onClick={() => continueSketch(sketchId)}>继续绘制</button>
          <button type="button" className="primary" onClick={() => beginExtrude(sketchId, selection.kind === "entity" ? selection.entityId : undefined)}>拉伸</button>
        </div>
        <button type="button" className="danger-button" onClick={deleteSelection}>删除</button>
      </section>
    );
  }

  return (
    <section className="props">
      <h2>属性</h2>
      <p className="hint-copy">在基准面上画封闭截面，再拉伸成实体。每个拉伸都会成为特征树上的一步，可以改高度、隐藏或撤销。</p>
    </section>
  );
}

function selectedFeature(
  features: ExtrudeFeature[],
  bodies: { id: string; featureId: string }[],
  selection: { kind: string; id?: string } | null,
): ExtrudeFeature | null {
  if (selection?.kind === "feature") return features.find((feature) => feature.id === selection.id) ?? null;
  if (selection?.kind === "body") {
    const body = bodies.find((item) => item.id === selection.id);
    return features.find((feature) => feature.id === body?.featureId) ?? null;
  }
  return null;
}

function DistanceFields({
  start,
  end,
  onChange,
  onSessionStart,
  onSessionEnd,
}: {
  start: number;
  end: number;
  onChange: (start: number, end: number) => void;
  onSessionStart?: () => void;
  onSessionEnd?: () => void;
}) {
  return (
    <div className="fields">
      <label className="field">起始距离
        <input
          type="number"
          step={1}
          value={start}
          onFocus={onSessionStart}
          onBlur={onSessionEnd}
          onChange={(event) => onChange(Number(event.target.value), end)}
        />
      </label>
      <label className="field">结束距离
        <input
          type="number"
          step={1}
          value={end}
          onFocus={onSessionStart}
          onBlur={onSessionEnd}
          onChange={(event) => onChange(start, Number(event.target.value))}
        />
      </label>
    </div>
  );
}

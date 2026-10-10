import { entityLabel } from "../model/profiles";
import type { Feature } from "../model/types";
import {
  beginExtrude,
  beginRevolve,
  beginTransient,
  cancelExtrude,
  cancelRevolve,
  confirmExtrude,
  confirmRevolve,
  continueSketch,
  deleteSelection,
  editFeature,
  endTransient,
  setBodyColor,
  setBodyVisible,
  setDraftDistances,
  setFeatureDistances,
  setRevolveDraft,
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

  const revolve = editor.revolveDraft;
  if (revolve) {
    const sketch = editor.doc.sketches.find((item) => item.id === revolve.sketchId);
    const entity = sketch?.entities.find((item) => item.id === revolve.entityId);
    return (
      <section className="props">
        <h2>旋转预览</h2>
        <p className="hint-copy">{sketch?.name} · {entity ? entityLabel(entity) : "截面"}。轴通过草图原点。</p>
        <NumberField label="角度 °" value={revolve.angleDeg} onChange={(angleDeg) => setRevolveDraft({ angleDeg })} />
        <label className="field">轴向
          <select value={revolve.axis} onChange={(event) => setRevolveDraft({ axis: event.target.value === "v" ? "v" : "u" })}>
            <option value="u">U，沿平面 x 方向</option>
            <option value="v">V，平面内另一轴</option>
          </select>
        </label>
        <label className="field">结果
          <select
            value={revolve.operation}
            onChange={(event) => setRevolveDraft({ operation: event.target.value === "fuse" || event.target.value === "cut" ? event.target.value : "new" })}
          >
            <option value="new">新建实体</option>
            <option value="fuse">与选中实体求和</option>
            <option value="cut">从选中实体减去</option>
          </select>
        </label>
        {editor.errors.__preview__ && <p className="danger">{editor.errors.__preview__}</p>}
        {editor.preview && <p className="metric">预览体积 {volumeFormat.format(editor.preview.volume)} mm³</p>}
        <div className="button-row">
          <button type="button" className="primary" onClick={confirmRevolve}>确认旋转</button>
          <button type="button" onClick={cancelRevolve}>取消</button>
        </div>
      </section>
    );
  }

  if (editor.pendingBoolean) {
    const name = editor.pendingBoolean.operation === "fuse" ? "并集" : editor.pendingBoolean.operation === "cut" ? "差集" : "交集";
    return (
      <section className="props">
        <h2>{name}</h2>
        <p className="hint-copy">已选中目标实体。在视口或特征树里点另一个实体作为工具体。按 Esc 取消。</p>
      </section>
    );
  }

  const selection = editor.selection;
  const feature = selectedFeature(editor.doc.features, editor.doc.bodies, selection);
  const body = bodyFor(editor.doc.bodies, feature, selection);
  if (feature) {
    return (
      <section className="props">
        <h2>{feature.name}</h2>
        <FeatureFields feature={feature} />
        {editor.errors[feature.id] && <p className="danger">{editor.errors[feature.id]}</p>}
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
        <p className="hint-copy">点选这个平面后可以直接在上面开草图。草图坐标的 u 轴沿平面 x 方向，v 轴由法向叉乘得到。镜像会用当前选中的平面。</p>
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
          <button type="button" onClick={() => beginRevolve(sketchId, selection.kind === "entity" ? selection.entityId : undefined)}>旋转</button>
        </div>
        <button type="button" className="danger-button" onClick={deleteSelection}>删除</button>
      </section>
    );
  }

  return (
    <section className="props">
      <h2>属性</h2>
      <p className="hint-copy">在基准面上画封闭截面，再拉伸或旋转成实体。布尔、圆角、抽壳、移动和阵列都会记成特征，修改上游后会按顺序重算。</p>
    </section>
  );
}

function FeatureFields({ feature }: { feature: Feature }) {
  if (feature.type === "extrude") {
    return (
      <>
        <DistanceFields
          start={feature.start}
          end={feature.end}
          onChange={(start, end) => setFeatureDistances(feature.id, start, end)}
          onSessionStart={beginTransient}
          onSessionEnd={endTransient}
        />
        <NumberField
          label="薄壁厚度 mm，0 为实体"
          value={feature.wall}
          onChange={(wall) => editFeature(feature.id, (item) => { if (item.type === "extrude") item.wall = Math.max(0, wall); })}
        />
        <NumberField
          label="拔模角 °"
          value={feature.draftAngle}
          onChange={(draftAngle) => editFeature(feature.id, (item) => { if (item.type === "extrude") item.draftAngle = draftAngle; })}
        />
        <label className="check">
          <input
            type="checkbox"
            checked={feature.sheet}
            onChange={(event) => editFeature(feature.id, (item) => { if (item.type === "extrude") item.sheet = event.target.checked; })}
          />
          拉伸成片体
        </label>
      </>
    );
  }
  if (feature.type === "revolve") {
    return (
      <>
        <NumberField label="角度 °" value={feature.angleDeg} onChange={(angleDeg) => editFeature(feature.id, (item) => { if (item.type === "revolve") item.angleDeg = angleDeg; })} />
        <label className="field">轴向
          <select value={feature.axis} onChange={(event) => editFeature(feature.id, (item) => { if (item.type === "revolve") item.axis = event.target.value === "v" ? "v" : "u"; })}>
            <option value="u">U</option>
            <option value="v">V</option>
          </select>
        </label>
      </>
    );
  }
  if (feature.type === "fillet") {
    return <NumberField label="半径 mm" value={feature.radius} onChange={(radius) => editFeature(feature.id, (item) => { if (item.type === "fillet") item.radius = Math.max(0.05, radius); })} />;
  }
  if (feature.type === "chamfer") {
    return <NumberField label="距离 mm" value={feature.distance} onChange={(distance) => editFeature(feature.id, (item) => { if (item.type === "chamfer") item.distance = Math.max(0.05, distance); })} />;
  }
  if (feature.type === "shell") {
    return (
      <>
        <NumberField label="壁厚 mm" value={feature.thickness} onChange={(thickness) => editFeature(feature.id, (item) => { if (item.type === "shell") item.thickness = Math.max(0.05, thickness); })} />
        <VectorFields
          label="开口方向"
          value={feature.direction}
          onChange={(direction) => editFeature(feature.id, (item) => { if (item.type === "shell") item.direction = direction; })}
        />
      </>
    );
  }
  if (feature.type === "move") {
    return (
      <VectorFields
        label={feature.copy ? "复制偏移" : "移动"}
        value={{ x: feature.dx, y: feature.dy, z: feature.dz }}
        onChange={(offset) => editFeature(feature.id, (item) => {
          if (item.type !== "move") return;
          item.dx = offset.x;
          item.dy = offset.y;
          item.dz = offset.z;
        })}
      />
    );
  }
  if (feature.type === "linearPattern") {
    return (
      <>
        <NumberField label="数量" value={feature.count} onChange={(count) => editFeature(feature.id, (item) => { if (item.type === "linearPattern") item.count = Math.max(2, Math.round(count)); })} />
        <NumberField label="间距 mm" value={feature.spacing} onChange={(spacing) => editFeature(feature.id, (item) => { if (item.type === "linearPattern") item.spacing = Math.max(0.2, spacing); })} />
        <VectorFields label="方向" value={feature.direction} onChange={(direction) => editFeature(feature.id, (item) => { if (item.type === "linearPattern") item.direction = direction; })} />
      </>
    );
  }
  if (feature.type === "circularPattern") {
    return (
      <>
        <NumberField label="数量" value={feature.count} onChange={(count) => editFeature(feature.id, (item) => { if (item.type === "circularPattern") item.count = Math.max(2, Math.round(count)); })} />
        <NumberField label="间隔角度 °" value={feature.angleDeg} onChange={(angleDeg) => editFeature(feature.id, (item) => { if (item.type === "circularPattern") item.angleDeg = angleDeg; })} />
        <VectorFields label="圆心" value={feature.center} onChange={(center) => editFeature(feature.id, (item) => { if (item.type === "circularPattern") item.center = center; })} />
        <VectorFields label="轴向" value={feature.axis} onChange={(axis) => editFeature(feature.id, (item) => { if (item.type === "circularPattern") item.axis = axis; })} />
      </>
    );
  }
  if (feature.type === "boolean") {
    const label = feature.operation === "fuse" ? "并集" : feature.operation === "cut" ? "差集" : "交集";
    return <p className="hint-copy">这条{label}改写目标实体。删除它会回到运算前的形状，并重新显示工具体。</p>;
  }
  return <p className="hint-copy">镜像副本。删除这条特征会去掉副本，源实体保留。</p>;
}

function selectedFeature(
  features: Feature[],
  bodies: { id: string; featureId: string }[],
  selection: { kind: string; id?: string } | null,
): Feature | null {
  if (selection?.kind === "feature") return features.find((feature) => feature.id === selection.id) ?? null;
  if (selection?.kind === "body") {
    const body = bodies.find((item) => item.id === selection.id);
    return features.find((feature) => feature.id === body?.featureId) ?? null;
  }
  return null;
}

function bodyFor(
  bodies: { id: string; featureId: string }[],
  feature: Feature | null,
  selection: { kind: string; id?: string } | null,
): { id: string; featureId: string; color: string; visible: boolean } | undefined {
  const list = bodies as { id: string; featureId: string; color: string; visible: boolean }[];
  if (selection?.kind === "body") return list.find((item) => item.id === selection.id);
  if (!feature) return undefined;
  if (feature.type === "boolean") return list.find((item) => item.id === feature.targetBodyId);
  if (feature.type === "mirror") return list.find((item) => item.id === feature.newBodyId);
  if (feature.type === "move" && feature.newBodyId) return list.find((item) => item.id === feature.newBodyId);
  if ("bodyId" in feature) return list.find((item) => item.id === feature.bodyId);
  return undefined;
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

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label className="field">{label}
      <input
        type="number"
        step={1}
        value={value}
        onFocus={beginTransient}
        onBlur={endTransient}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function VectorFields({
  label,
  value,
  onChange,
}: {
  label: string;
  value: { x: number; y: number; z: number };
  onChange: (value: { x: number; y: number; z: number }) => void;
}) {
  const edit = (axis: "x" | "y" | "z", next: number) => onChange({ ...value, [axis]: next });
  return (
    <div className="fields">
      {(["x", "y", "z"] as const).map((axis) => (
        <label key={axis} className="field">{label} {axis.toUpperCase()}
          <input
            type="number"
            step={1}
            value={value[axis]}
            onFocus={beginTransient}
            onBlur={endTransient}
            onChange={(event) => edit(axis, Number(event.target.value))}
          />
        </label>
      ))}
    </div>
  );
}

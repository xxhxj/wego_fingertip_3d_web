import { entityLabel } from "../model/profiles";
import type { Feature } from "../model/types";
import {
  beginEdgePick,
  beginBisect,
  beginExtrude,
  beginRevolve,
  beginTransient,
  cancelExtrude,
  cancelRevolve,
  confirmExtrude,
  confirmLoft,
  confirmRevolve,
  continueSketch,
  createAngledPlane,
  createOffsetPlane,
  deleteSelection,
  editFeature,
  editPlane,
  endTransient,
  setBodyColor,
  setBodyMesh,
  setBodyVisible,
  setDraftDistances,
  setFeatureDistances,
  setRevolveDraft,
  setSplitKeep,
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

  if (editor.tool === "sweep" && editor.pendingSweep) {
    return (
      <section className="props">
        <h2>扫掠</h2>
        <p className="hint-copy">截面已选定。在特征树里再点一条路径。路径可以不封闭，直线、样条和多段线都可以。</p>
      </section>
    );
  }

  if (editor.tool === "loft") {
    return (
      <section className="props">
        <h2>放样</h2>
        <p className="hint-copy">按点选顺序连接封闭截面。至少两个，然后按回车或点下面的按钮。</p>
        <ol className="loft-list">
          {editor.pendingLoft.map((profile, index) => {
            const sketch = editor.doc.sketches.find((item) => item.id === profile.sketchId);
            const entity = sketch?.entities.find((item) => item.id === profile.entityId);
            return <li key={`${profile.entityId}-${index}`}>{sketch?.name ?? "草图"} · {entity ? entityLabel(entity) : "截面"}</li>;
          })}
        </ol>
        <button type="button" className="primary" onClick={confirmLoft}>生成放样</button>
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
            <NumberField label="整体弦高 mm" value={body.deflection} onChange={(deflection) => setBodyMesh(body.id, { deflection })} />
            <NumberField
              label="单面弦高 mm，0 表示不单独加密"
              value={body.faceDeflection ?? 0}
              onChange={(faceDeflection) => setBodyMesh(body.id, {
                faceDeflection: faceDeflection > 0 ? faceDeflection : null,
                faceDirection: body.faceDirection ?? { x: 0, y: 0, z: 1 },
              })}
            />
            <button type="button" onClick={beginEdgePick}>点选边倒圆</button>
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
        <p className="hint-copy">点选这个平面后可以直接在上面开草图。也可以沿法向偏置、绕 U 轴转成斜面，或再点一个平面做等分。</p>
        <button type="button" className="primary" onClick={() => plane && startSketch(plane.id)}>在此开草图</button>
        <div className="button-row">
          <button type="button" onClick={() => plane && createOffsetPlane(plane.id, plane.kind === "offset" ? plane.distance : 10)}>偏置</button>
          <button type="button" onClick={() => plane && createAngledPlane(plane.id, plane.kind === "angled" ? plane.angleDeg : 30)}>斜面</button>
          <button type="button" onClick={() => plane && beginBisect(plane.id)}>等分</button>
        </div>
        {plane && plane.kind === "offset" && (
          <NumberField label="偏置距离 mm" value={plane.distance} onChange={(distance) => editPlane(plane.id, { distance })} />
        )}
        {plane && plane.kind === "angled" && (
          <NumberField label="斜面角度 °" value={plane.angleDeg} onChange={(angleDeg) => editPlane(plane.id, { angleDeg })} />
        )}
        {plane && plane.kind !== "principal" && <button type="button" className="danger-button" onClick={deleteSelection}>删除平面</button>}
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
    return (
      <>
        <NumberField label="半径 mm" value={feature.radius} onChange={(radius) => editFeature(feature.id, (item) => { if (item.type === "fillet") item.radius = Math.max(0.05, radius); })} />
        <p className="hint-copy">{feature.edges && feature.edges.length > 0 ? `已选择 ${feature.edges.length} 条边。` : "当前倒圆全部边。"}</p>
        {feature.edges && feature.edges.length > 0 && (
          <button type="button" onClick={() => editFeature(feature.id, (item) => { if (item.type === "fillet") item.edges = null; })}>改为全部边</button>
        )}
      </>
    );
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
    return (
      <>
        <p className="hint-copy">这条{label}改写目标实体。删除它会回到运算前的形状，并重新显示工具体。</p>
        <NumberField
          label="缝合公差 mm，0 为精确布尔"
          value={feature.fuzzy}
          onChange={(fuzzy) => editFeature(feature.id, (item) => { if (item.type === "boolean") item.fuzzy = Math.max(0, fuzzy); })}
        />
      </>
    );
  }
  if (feature.type === "sweep") {
    return (
      <>
        <ProfileChoice
          label="截面"
          sketchId={feature.profileSketchId}
          entityId={feature.profileEntityId}
          onChange={(sketchId, entityId) => editFeature(feature.id, (item) => {
            if (item.type !== "sweep") return;
            item.profileSketchId = sketchId;
            item.profileEntityId = entityId;
          })}
        />
        <ProfileChoice
          label="路径"
          sketchId={feature.pathSketchId}
          entityId={feature.pathEntityId}
          onChange={(sketchId, entityId) => editFeature(feature.id, (item) => {
            if (item.type !== "sweep") return;
            item.pathSketchId = sketchId;
            item.pathEntityId = entityId;
          })}
        />
      </>
    );
  }
  if (feature.type === "loft") {
    return (
      <>
        {feature.profiles.map((profile, index) => (
          <ProfileChoice
            key={`${profile.entityId}-${index}`}
            label={`截面 ${index + 1}`}
            sketchId={profile.sketchId}
            entityId={profile.entityId}
            onChange={(sketchId, entityId) => editFeature(feature.id, (item) => {
              if (item.type !== "loft") return;
              const profiles = item.profiles.slice();
              profiles[index] = { sketchId, entityId };
              item.profiles = profiles;
            })}
          />
        ))}
        <label className="check">
          <input
            type="checkbox"
            checked={feature.ruled}
            onChange={(event) => editFeature(feature.id, (item) => { if (item.type === "loft") item.ruled = event.target.checked; })}
          />
          直纹连接
        </label>
      </>
    );
  }
  if (feature.type === "push") {
    return (
      <NumberField
        label="距离 mm，正数沿法向"
        value={feature.distance}
        onChange={(distance) => editFeature(feature.id, (item) => {
          if (item.type === "push") item.distance = Math.max(-2000, Math.min(2000, distance));
        })}
      />
    );
  }
  if (feature.type === "split") {
    return <SplitFields feature={feature} />;
  }
  if (feature.type === "step") {
    return <p className="hint-copy">STEP 原文保存在这条特征里，重放时重新读入。</p>;
  }
  return <p className="hint-copy">镜像副本。删除这条特征会去掉副本，源实体保留。</p>;
}

function ProfileChoice({
  label,
  sketchId,
  entityId,
  onChange,
}: {
  label: string;
  sketchId: string;
  entityId: string;
  onChange: (sketchId: string, entityId: string) => void;
}) {
  const editor = useEditor();
  return (
    <label className="field">{label}
      <select
        value={`${sketchId}:${entityId}`}
        onChange={(event) => {
          const [nextSketch, nextEntity] = event.target.value.split(":");
          if (nextSketch && nextEntity) onChange(nextSketch, nextEntity);
        }}
      >
        {editor.doc.sketches.flatMap((sketch) => sketch.entities.map((entity) => (
          <option key={entity.id} value={`${sketch.id}:${entity.id}`}>{sketch.name} · {entityLabel(entity)}</option>
        )))}
      </select>
    </label>
  );
}

function SplitFields({ feature }: { feature: Extract<Feature, { type: "split" }> }) {
  const editor = useEditor();
  return (
    <>
      <label className="field">分割平面
        <select
          value={feature.planeId}
          onChange={(event) => editFeature(feature.id, (item) => { if (item.type === "split") item.planeId = event.target.value; })}
        >
          {editor.doc.planes.map((plane) => <option key={plane.id} value={plane.id}>{plane.name}</option>)}
        </select>
      </label>
      <label className="field">保留
        <select
          value={feature.keep}
          onChange={(event) => {
            const keep = event.target.value === "positive" || event.target.value === "negative" ? event.target.value : "both";
            setSplitKeep(feature.id, keep);
          }}
        >
          <option value="both">两侧都留</option>
          <option value="positive">法向一侧</option>
          <option value="negative">反法向一侧</option>
        </select>
      </label>
    </>
  );
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
): { id: string; featureId: string; color: string; visible: boolean; deflection: number; faceDeflection: number | null; faceDirection: { x: number; y: number; z: number } | null } | undefined {
  const list = bodies as { id: string; featureId: string; color: string; visible: boolean; deflection: number; faceDeflection: number | null; faceDirection: { x: number; y: number; z: number } | null }[];
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

import type { ReactNode } from "react";
import type { PickFilter, Tool } from "../model/types";
import {
  createAngledPlane,
  createOffsetPlane,
  beginBisect,
  importStepText,
  setPickFilter,
  setProjectName,
  setTool,
  toggleSection,
} from "../state/editor";
import { useEditor } from "../state/hooks";
import { closeFlyout, setDisplayMode, setScreen, setSearch, toggleFlyout, toggleHistory, useShell, type FlyoutName } from "../state/shell";
import { getViewport } from "../viewport/engine";

const FILTERS: { id: PickFilter; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "body", label: "实体" },
  { id: "face", label: "面" },
  { id: "edge", label: "边" },
  { id: "sketch", label: "草图" },
];

export function ToolRail() {
  const editor = useEditor();
  const shell = useShell();
  const sectionOn = Boolean(editor.sectionPlaneId);

  return (
    <nav className="dock" aria-label="建模工具">
      <div className="dock-cluster">
        <DockButton
          label="投影建模"
          shortcut="Ctrl Shift \\"
          active={shell.screen === "model" && shell.flyout !== "items"}
          onClick={() => {
            setScreen("model");
            setTool("select");
          }}
        >
          <svg viewBox="0 0 24 24"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" /><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5" /></svg>
        </DockButton>
        <DockButton
          label="项目"
          shortcut="Ctrl Alt S"
          active={shell.flyout === "items"}
          onClick={() => toggleFlyout("items")}
        >
          <svg viewBox="0 0 24 24"><path d="M5 7h14v3H5zM5 12h14v3H5zM5 17h14v3H5z" /></svg>
        </DockButton>
      </div>
      <DockButton label="搜索" shortcut="Ctrl F" active={shell.search} onClick={() => setSearch(true)}>
        <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="5.5" /><path d="M16 16l4 4" /></svg>
      </DockButton>
      <DockButton label="绘制草图" data-dock="sketch" active={shell.flyout === "sketch" || isDraw(editor.tool)} onClick={() => toggleFlyout("sketch")}>
        <svg viewBox="0 0 24 24"><path d="M5 17l4-9 3 5 3-4 4 8" /><path d="M5 19h14" /></svg>
      </DockButton>
      <DockButton label="插入" active={shell.flyout === "insert"} onClick={() => toggleFlyout("insert")}>
        <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
      </DockButton>
      <DockButton label="构造" active={shell.flyout === "construct"} onClick={() => toggleFlyout("construct")}>
        <svg viewBox="0 0 24 24"><path d="M4 16l8-10 8 10" /><path d="M7 16h10" /></svg>
      </DockButton>
      <DockButton label="变换" active={shell.flyout === "transform"} onClick={() => toggleFlyout("transform")}>
        <svg viewBox="0 0 24 24"><path d="M12 4v16M4 12h16" /><path d="M12 4l-2.5 2.5M12 4l2.5 2.5M20 12l-2.5-2.5M20 12l-2.5 2.5" /></svg>
      </DockButton>
      <DockButton label="工具" data-dock="tools" active={shell.flyout === "tools"} onClick={() => toggleFlyout("tools")}>
        <svg viewBox="0 0 24 24"><path d="M14 6l4 4-8 8H6v-4z" /><path d="M13 7l4 4" /></svg>
      </DockButton>
      <DockButton label="可视化" active={shell.flyout === "visual"} onClick={() => toggleFlyout("visual")}>
        <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z" /></svg>
      </DockButton>
      {shell.flyout && shell.flyout !== "items" && isToolFlyout(shell.flyout) && (
        <Flyout title={flyoutTitle(shell.flyout)}>
          {shell.flyout === "sketch" && (
            <>
              <ToolButton id="select" label="选择" />
              <ToolButton id="rectangle" label="矩形" />
              <ToolButton id="circle" label="圆" />
              <ToolButton id="line" label="直线" />
              <ToolButton id="polyline" label="多段线" />
              <ToolButton id="arc" label="圆弧" />
              <ToolButton id="spline" label="样条" />
            </>
          )}
          {shell.flyout === "insert" && (
            <label className="file-button flyout-file">导入 STEP
              <input
                className="file-input"
                type="file"
                accept=".step,.stp,application/step"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (!file) return;
                  void file.text().then((text) => {
                    importStepText(text, file.name);
                    setProjectName(file.name.replace(/\.(step|stp)$/i, ""));
                    setScreen("model");
                    closeFlyout();
                  });
                }}
              />
            </label>
          )}
          {shell.flyout === "construct" && (
            <>
              <button type="button" onClick={() => { createOffsetPlane(planeId(editor.selection), 10); closeFlyout(); }}>偏置平面</button>
              <button type="button" onClick={() => { createAngledPlane(planeId(editor.selection), 30); closeFlyout(); }}>斜面</button>
              <button type="button" onClick={() => { beginBisect(planeId(editor.selection)); closeFlyout(); }}>等分平面</button>
            </>
          )}
          {shell.flyout === "transform" && (
            <>
              <ToolButton id="move" label="移动" />
              <ToolButton id="copy" label="复制" />
              <ToolButton id="mirror" label="镜像" />
              <ToolButton id="linear" label="线性阵列" />
              <ToolButton id="circular" label="圆周阵列" />
            </>
          )}
          {shell.flyout === "tools" && (
            <>
              <ToolButton id="extrude" label="拉伸" />
              <ToolButton id="revolve" label="旋转" />
              <ToolButton id="sweep" label="扫掠" />
              <ToolButton id="loft" label="放样" />
              <ToolButton id="push" label="推拉" />
              <ToolButton id="split" label="分割" />
              <ToolButton id="fuse" label="并集" />
              <ToolButton id="cut" label="差集" />
              <ToolButton id="common" label="交集" />
              <ToolButton id="fillet" label="圆角" />
              <ToolButton id="chamfer" label="倒角" />
              <ToolButton id="shell" label="抽壳" />
              <div className="filter-row">
                {FILTERS.map((filter) => (
                  <button
                    key={filter.id}
                    type="button"
                    data-filter={filter.id}
                    className={editor.pickFilter === filter.id ? "active" : ""}
                    onClick={() => setPickFilter(filter.id)}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>
            </>
          )}
          {shell.flyout === "visual" && (
            <>
              <button type="button" onClick={() => { setDisplayMode("shaded"); setScreen("model"); closeFlyout(); }}>着色</button>
              <button type="button" onClick={() => { setDisplayMode("wireframe"); setScreen("model"); closeFlyout(); }}>线框</button>
              <button type="button" onClick={() => toggleSection()}>{sectionOn ? "关闭截面" : "截面视图"}</button>
              <button
                type="button"
                onClick={() => {
                  const url = getViewport()?.capture();
                  if (!url) return;
                  const link = document.createElement("a");
                  link.href = url;
                  link.download = "截图.png";
                  link.click();
                  closeFlyout();
                }}
              >
                截图
              </button>
            </>
          )}
        </Flyout>
      )}
      {shell.flyout === "items" && <ItemsFlyout />}
      <div className="dock-bottom">
        <button type="button" className="dock-wide" onClick={() => toggleSection()}>
          <span>截面视图</span>
          <small>{sectionOn ? "开启" : "关闭"}</small>
        </button>
        <button
          type="button"
          className={editor.tool === "measure" ? "dock-wide active" : "dock-wide"}
          onClick={() => setTool(editor.tool === "measure" ? "select" : "measure")}
        >
          <svg viewBox="0 0 24 24"><path d="M5 17l14-10M5 17v-4M19 7v4" /></svg>
          <span>测量</span>
        </button>
        <button type="button" className="dock-wide" data-dock="history" onClick={() => { setScreen("model"); toggleHistory(); }}>
          <span>历史记录</span>
          <small>Ctrl Alt H</small>
        </button>
      </div>
    </nav>
  );
}

function ItemsFlyout() {
  const editor = useEditor();
  return (
    <div className="flyout items-flyout">
      <strong>项目</strong>
      <p className="section-label">实体</p>
      {editor.doc.bodies.length === 0 && <p className="empty">还没有实体</p>}
      {editor.doc.bodies.map((body) => (
        <p key={body.id} className="item-line"><i className="swatch" style={{ background: body.color }} />{body.name}</p>
      ))}
      <p className="section-label">草图</p>
      {editor.doc.sketches.length === 0 && <p className="empty">还没有草图</p>}
      {editor.doc.sketches.map((sketch) => <p key={sketch.id} className="item-line">{sketch.name}</p>)}
    </div>
  );
}

function Flyout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flyout">
      <strong>{title}</strong>
      {children}
    </div>
  );
}

function DockButton({
  label,
  shortcut,
  active,
  onClick,
  children,
  ...rest
}: {
  label: string;
  shortcut?: string;
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
  "data-dock"?: string;
}) {
  return (
    <button type="button" className={active ? "dock-btn active" : "dock-btn"} onClick={onClick} {...rest}>
      {children}
      <span>{label}</span>
      {shortcut && <small>{shortcut}</small>}
    </button>
  );
}

function ToolButton({ id, label }: { id: Tool; label: string }) {
  const editor = useEditor();
  return (
    <button
      type="button"
      data-tool={id}
      className={editor.tool === id ? "active" : ""}
      onClick={() => {
        setTool(id);
        setScreen("model");
        if (id !== "select") closeFlyout();
      }}
    >
      {label}
    </button>
  );
}

function planeId(selection: { kind: string; id?: string } | null): string {
  if (selection?.kind === "plane" && selection.id) return selection.id;
  return "plane-xy";
}

function isDraw(tool: Tool): boolean {
  return tool === "rectangle" || tool === "circle" || tool === "polyline" || tool === "line" || tool === "spline" || tool === "arc";
}

function isToolFlyout(flyout: FlyoutName): boolean {
  return flyout === "sketch" || flyout === "insert" || flyout === "construct" || flyout === "transform" || flyout === "tools" || flyout === "visual";
}

function flyoutTitle(flyout: FlyoutName): string {
  if (flyout === "sketch") return "绘制草图";
  if (flyout === "insert") return "插入";
  if (flyout === "construct") return "构造";
  if (flyout === "transform") return "变换";
  if (flyout === "tools") return "工具";
  return "可视化";
}

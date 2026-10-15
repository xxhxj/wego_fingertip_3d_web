import { useEffect, useState, type ReactNode } from "react";
import {
  downloadExport,
  importStepText,
  newDocument,
  redo,
  setLicenseOpen,
  setProjectName,
  setView,
  undo,
} from "../state/editor";
import type { ModelExportFormat } from "../kernel/client";
import { useEditor } from "../state/hooks";
import { closeFlyout, setHistory, setScreen, toggleFlyout, useShell } from "../state/shell";
import { logout, useSession } from "../session";
import { getViewport } from "../viewport/engine";

export function TopBar() {
  const editor = useEditor();
  const shell = useShell();
  const session = useSession();
  const [renaming, setRenaming] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const nickname = session.user?.nickname || "";
  const username = session.user?.username || "";

  useEffect(() => {
    if (!userOpen) return undefined;
    const close = () => setUserOpen(false);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [userOpen]);

  useEffect(() => {
    if (shell.flyout !== "file") setExportOpen(false);
  }, [shell.flyout]);

  return (
    <header className="topbar">
      <div className="top-left">
        <button type="button" className="icon-button" data-nav="learn" title="教程" onClick={() => setScreen("learn")}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 6l-6 6 6 6" /></svg>
        </button>
        {renaming ? (
          <input
            className="project-input"
            autoFocus
            defaultValue={editor.projectName}
            onBlur={(event) => {
              setProjectName(event.target.value);
              setRenaming(false);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") (event.target as HTMLInputElement).blur();
              if (event.key === "Escape") setRenaming(false);
            }}
          />
        ) : (
          <button type="button" className="project-name" onClick={() => setRenaming(true)}>
            {editor.projectName}
            <small>▾</small>
          </button>
        )}
      </div>
      <nav className="menu-bar" aria-label="菜单">
        <MenuButton id="file" label="文件" open={shell.flyout === "file"}>
          <button type="button" onClick={() => { newDocument(); setScreen("model"); closeFlyout(); }}>新建</button>
          <label className="file-button menu-file">导入 STEP
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
          <div className="menu-branch">
            <button type="button" className={exportOpen ? "active" : ""} onClick={() => setExportOpen((open) => !open)}>
              导出为
              <span>›</span>
            </button>
            {exportOpen && (
              <div className="menu-pop menu-side" role="menu">
                {EXPORTS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      void downloadExport(item.id);
                      setExportOpen(false);
                      closeFlyout();
                    }}
                  >
                    {item.label}
                    <small>{item.hint}</small>
                  </button>
                ))}
              </div>
            )}
          </div>
        </MenuButton>
        <MenuButton id="edit" label="编辑" open={shell.flyout === "edit"}>
          <button type="button" disabled={!editor.canUndo} onClick={() => { undo(); closeFlyout(); }}>撤销</button>
          <button type="button" disabled={!editor.canRedo} onClick={() => { redo(); closeFlyout(); }}>重做</button>
        </MenuButton>
        <MenuButton id="projectMenu" label="项目" open={shell.flyout === "projectMenu"}>
          <button type="button" onClick={() => { setRenaming(true); closeFlyout(); }}>重命名</button>
          <button type="button" onClick={() => { setScreen("learn"); closeFlyout(); }}>教程</button>
        </MenuButton>
        <MenuButton id="view" label="视图" open={shell.flyout === "view"}>
          <button type="button" onClick={() => { setView("front"); setScreen("model"); closeFlyout(); }}>前视</button>
          <button type="button" onClick={() => { setView("top"); setScreen("model"); closeFlyout(); }}>顶视</button>
          <button type="button" onClick={() => { setView("right"); setScreen("model"); closeFlyout(); }}>右视</button>
          <button type="button" onClick={() => { setView("iso"); setScreen("model"); closeFlyout(); }}>轴测</button>
          <button type="button" onClick={() => { setScreen("model"); getViewport()?.alignToActiveSketch(); closeFlyout(); }}>正对草图</button>
          <button type="button" onClick={() => { setHistory(true); setScreen("model"); closeFlyout(); }}>历史记录</button>
        </MenuButton>
        <MenuButton id="help" label="帮助" open={shell.flyout === "help"}>
          <button type="button" onClick={() => { setLicenseOpen(true); closeFlyout(); }}>开源许可</button>
          <p className="menu-note">按下滚轮拖动视图，右键绕当前坐标系原点旋转，滚轮缩放。绘制时按住 Alt 以 0.1 mm 吸附。</p>
        </MenuButton>
      </nav>
      <div className="top-right">
        <button type="button" className="icon-button" title="撤销" disabled={!editor.canUndo} onClick={undo}>
          <svg viewBox="0 0 24 24"><path d="M8 8H5V5" /><path d="M5.5 8.5A7 7 0 1 1 6 16" /></svg>
        </button>
        <button type="button" className="icon-button" title="重做" disabled={!editor.canRedo} onClick={redo}>
          <svg viewBox="0 0 24 24"><path d="M16 8h3V5" /><path d="M18.5 8.5A7 7 0 1 0 18 16" /></svg>
        </button>
        {nickname && (
          <div className="menu user-menu" onPointerDown={(event) => event.stopPropagation()}>
            <button
              type="button"
              className={userOpen ? "user-chip active" : "user-chip"}
              onClick={() => setUserOpen((open) => !open)}
            >
              <i className="avatar">{nickname.slice(0, 1)}</i>
              {nickname}
            </button>
            {userOpen && (
              <div className="menu-pop user-pop" role="menu">
                <p className="user-id">{nickname}<small>{username}</small></p>
                <button type="button" onClick={() => logout()}>切换用户</button>
                <button type="button" onClick={() => logout()}>退出登录</button>
              </div>
            )}
          </div>
        )}
        <button type="button" className="icon-button" title="帮助" onClick={() => setLicenseOpen(true)}>?</button>
      </div>
    </header>
  );
}

const EXPORTS: { id: ModelExportFormat | "dxf"; label: string; hint: string }[] = [
  { id: "step", label: "STEP…", hint: "精确实体" },
  { id: "stl", label: "STL…", hint: "切片" },
  { id: "3mf", label: "3MF…", hint: "切片" },
  { id: "obj", label: "OBJ…", hint: "网格" },
  { id: "glb", label: "GLB…", hint: "glTF" },
  { id: "brep", label: "BREP…", hint: "内核" },
  { id: "svg", label: "SVG…", hint: "视图" },
  { id: "dxf", label: "从草图导出 DXF…", hint: "草图" },
];

function MenuButton({
  id,
  label,
  open,
  children,
}: {
  id: "file" | "edit" | "projectMenu" | "view" | "help";
  label: string;
  open: boolean;
  children: ReactNode;
}) {
  return (
    <div className="menu">
      <button type="button" className={open ? "menu-label active" : "menu-label"} onClick={() => toggleFlyout(id)}>
        {label}
      </button>
      {open && <div className="menu-pop" role="menu">{children}</div>}
    </div>
  );
}

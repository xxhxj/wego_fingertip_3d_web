import { useEffect, useMemo, useState } from "react";
import type { Tool } from "../model/types";
import { downloadStep, newDocument, setTool, toggleSection } from "../state/editor";
import { setHistory, setScreen, setSearch } from "../state/shell";

const COMMANDS: { label: string; run: () => void; tool?: Tool }[] = [
  { label: "选择", tool: "select", run: () => setTool("select") },
  { label: "矩形", tool: "rectangle", run: () => setTool("rectangle") },
  { label: "圆", tool: "circle", run: () => setTool("circle") },
  { label: "直线", tool: "line", run: () => setTool("line") },
  { label: "多段线", tool: "polyline", run: () => setTool("polyline") },
  { label: "圆弧", tool: "arc", run: () => setTool("arc") },
  { label: "样条", tool: "spline", run: () => setTool("spline") },
  { label: "拉伸", tool: "extrude", run: () => setTool("extrude") },
  { label: "旋转", tool: "revolve", run: () => setTool("revolve") },
  { label: "扫掠", tool: "sweep", run: () => setTool("sweep") },
  { label: "放样", tool: "loft", run: () => setTool("loft") },
  { label: "推拉", tool: "push", run: () => setTool("push") },
  { label: "分割", tool: "split", run: () => setTool("split") },
  { label: "并集", tool: "fuse", run: () => setTool("fuse") },
  { label: "差集", tool: "cut", run: () => setTool("cut") },
  { label: "交集", tool: "common", run: () => setTool("common") },
  { label: "圆角", tool: "fillet", run: () => setTool("fillet") },
  { label: "倒角", tool: "chamfer", run: () => setTool("chamfer") },
  { label: "抽壳", tool: "shell", run: () => setTool("shell") },
  { label: "移动", tool: "move", run: () => setTool("move") },
  { label: "复制", tool: "copy", run: () => setTool("copy") },
  { label: "镜像", tool: "mirror", run: () => setTool("mirror") },
  { label: "线性阵列", tool: "linear", run: () => setTool("linear") },
  { label: "圆周阵列", tool: "circular", run: () => setTool("circular") },
  { label: "测量", tool: "measure", run: () => setTool("measure") },
  { label: "截面视图", run: () => toggleSection() },
  { label: "历史记录", run: () => { setScreen("model"); setHistory(true); } },
  { label: "教程", run: () => setScreen("learn") },
  { label: "新建", run: () => { newDocument(); setScreen("model"); } },
  { label: "导出 STEP", run: () => { void downloadStep(); } },
];

export function CommandPalette() {
  const [query, setQuery] = useState("");
  const items = useMemo(() => {
    const text = query.trim();
    return COMMANDS.filter((item) => !text || item.label.includes(text));
  }, [query]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSearch(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="palette-back" onMouseDown={() => setSearch(false)}>
      <div className="palette" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-label="搜索">
        <input
          autoFocus
          placeholder="搜索命令"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="palette-list">
          {items.length === 0 && <p className="empty">没有匹配的命令</p>}
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              data-tool={item.tool}
              onClick={() => {
                item.run();
                if (item.tool && item.tool !== "select" && item.tool !== "measure") setScreen("model");
                setSearch(false);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

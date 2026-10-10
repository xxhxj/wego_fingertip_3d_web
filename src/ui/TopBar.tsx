import { redo, setLicenseOpen, undo } from "../state/editor";
import { useEditor } from "../state/hooks";

export function TopBar() {
  const editor = useEditor();
  return (
    <header className="topbar">
      <div className="brand">
        <span className="mark">W</span>
        <div>
          <strong>Wego CAD</strong>
          <small>本地 B-Rep 建模</small>
        </div>
      </div>
      <div className="top-actions">
        <button type="button" disabled={!editor.canUndo} onClick={undo}>撤销</button>
        <button type="button" disabled={!editor.canRedo} onClick={redo}>重做</button>
        <button type="button" onClick={() => setLicenseOpen(true)}>开源许可</button>
      </div>
    </header>
  );
}

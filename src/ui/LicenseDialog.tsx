import { setLicenseOpen } from "../state/editor";
import { useEditor } from "../state/hooks";

export function LicenseDialog() {
  const editor = useEditor();
  if (!editor.licenseOpen) return null;
  return (
    <div className="modal-back" onClick={() => setLicenseOpen(false)}>
      <div className="modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-labelledby="license-title">
        <h2 id="license-title">开源组件</h2>
        <p>Wego CAD 是独立实现的网页建模器，使用与主流开源机械 CAD 相同的几何内核。界面、特征历史和工程数据都由本应用维护。</p>
        <table>
          <thead>
            <tr><th>组件</th><th>许可</th><th>用途</th></tr>
          </thead>
          <tbody>
            <tr>
              <td>Open CASCADE Technology</td>
              <td>LGPL-2.1-only</td>
              <td>B-Rep 内核。浏览器里通过 occt-wasm 加载，可用自备的 wasm 文件替换。</td>
            </tr>
            <tr>
              <td>occt-wasm</td>
              <td>MIT OR Apache-2.0</td>
              <td>OCCT 的 WebAssembly 接口。编译出的 wasm 继承 OCCT 的 LGPL-2.1。</td>
            </tr>
            <tr>
              <td>Three.js</td>
              <td>MIT</td>
              <td>WebGPU 视口。内核只输出三角网格和边线。</td>
            </tr>
          </tbody>
        </table>
        <button type="button" className="primary" onClick={() => setLicenseOpen(false)}>关闭</button>
      </div>
    </div>
  );
}

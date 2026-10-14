# Wego CAD

在浏览器里做精确实体建模。几何计算使用 Open CASCADE，画面使用 WebGPU。模型默认只留在本机，这一期不上传工程。

当前是 0.4.0：在 0.3.0 之外，还可以扫掠、放样、推拉面、按平面分割，测量距离和夹角，用平面做视口剖视。草图增加了直线和样条。视口是深色工作区，左上是视图方块，工具轨可以按实体、面、边或草图过滤点选。修改记录见 [CHANGELOG.md](CHANGELOG.md)，方案和取舍见 [docs/设计方案.md](docs/设计方案.md)，这一轮的范围见 [docs/对标规格.md](docs/对标规格.md)。

## 环境

- Node.js 22 或更高
- npm
- 桌面版 Chrome 或 Edge。内核需要 WASM SIMD、尾调用和异常处理；视口需要 WebGPU

| 浏览器 | 版本 |
| --- | --- |
| Chrome / Edge | 114+ |
| Safari | 17.2+ |
| Firefox | 121+ |

## 架构

```text
界面（React + TypeScript + Vite）
  视口：Three.js WebGPURenderer
  文档：草图、特征、实体、撤销栈

Web Worker
  occt-wasm（Open CASCADE V8）
    按特征顺序重放：拉伸、旋转、布尔、圆角、倒角、抽壳、阵列
    三角剖分 → 顶点 / 法线 / 索引 + 边线
```

坐标用毫米，Z 轴朝上。OCCT 不带浏览器里的交互视图，所以内核只产出边界表示，再剖成三角网格交给 WebGPU。边线单独画，实体看起来才有 CAD 的棱边。草图曲线用线段绘制，因为 WebGPU 不支持 `LineLoop`。

重放在 Worker 里进行，避免布尔和剖分卡住界面。浏览器只保存特征参数，网格是显示缓存。预览用较粗的剖分，确认后再出最终网格。圆角、布尔和移动都作用在上一步留下的形状上，所以每次修改都整树重算。

## 业务

1. 在 XY、XZ 或 YZ 基准面上开草图。
2. 画矩形、圆、封闭多段线，或三点圆弧（用弦封成截面）。按住 Alt 可以按 0.1 mm 输入，否则吸附到 1 mm。
3. 拉伸时输入起始距离和结束距离。距离沿平面法向，可以为负。也可以改成薄壁、片体，或加上拔模角。
4. 旋转时，轴通过草图原点，方向选 U 或 V。结果可以是新实体，也可以与已有实体求和、求差。
5. 选中实体后可以做并集、差集、交集、圆角、倒角、抽壳、移动、复制、镜像和阵列。布尔需要再点一个工具体，工具体随后隐藏。
6. 拖动视口里的端点，或在右侧改数字。拉伸和旋转在确认前有半透明预览。
7. 一个工程里可以有多个实体，各自有颜色，可以隐藏、单独显示或全部显示。
8. 撤销和重做作用于整份文档。改上游特征后，后面的布尔和圆角会按顺序重算。
9. 选中平面后可以偏置、转成斜面，或再点一个平面做等分。三个基准面不会被删掉。
10. 选中实体后可以点选一条边倒圆，也可以改整体弦高，或给一个方向上的面单独加密。
11. 顶栏可以导入、导出 STEP。布尔特征上可以填缝合公差。

中键旋转，右键平移，滚轮缩放。左下角可以切到前视、顶视、右视和轴测。

边的身份是它的位置和长度。草图把那条边挪开之后，圆角会提示找不到原来的边。STEP 目前不保留装配颜色和名称。

## 启动

```bash
npm install
npm run dev
```

开发服务器默认是 `http://127.0.0.1:5173`。请用系统浏览器打开。编辑器内嵌预览往往没有 WebGPU。

检查几何内核：

```bash
npm run smoke
```

在 Chrome 里跑一遍草图、拉伸、改高度、撤销和多实体：

```bash
npm run build
npm run e2e
```

`e2e` 会启动 `vite preview`。如果本机 Chrome 不能由脚本直接拉起，可以先开一个带远程调试的 Chrome，再执行：

```bash
BROWSER_URL=http://127.0.0.1:9222 npm run e2e
```

## 部署

构建静态文件：

```bash
npm install
npm run build
npm run preview
```

`dist/` 可以放到任何静态站点。站点需要能返回 `.wasm`，类型为 `application/wasm`。WASM 大约 21 MB，首次打开会下载并编译。

Nginx 示例：

```nginx
server {
  listen 80;
  root /var/www/wego-cad;
  location / {
    try_files $uri $uri/ /index.html;
  }
  location ~* \.wasm$ {
    default_type application/wasm;
  }
}
```

如果部署在子路径，构建时加上 Vite 的 `base`，例如 `base: "/wego-cad/"`。

## 开源组件

| 组件 | 许可 | 用途 |
| --- | --- | --- |
| Open CASCADE Technology | LGPL-2.1-only | B-Rep 内核。编译进 wasm，应用从 URL 加载，便于替换这份文件 |
| occt-wasm | MIT OR Apache-2.0 | 上述内核的 JavaScript 接口。wasm 本体仍遵循 OCCT 的 LGPL-2.1 |
| Three.js | MIT | WebGPU 视口 |

界面和工程格式是本仓库自己的。这里没有使用指尖 3D 的名称、图标或工程文件格式。

const { app, BrowserWindow, shell } = require("electron");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const PORT = 4715;
const DEV_URL = process.env.WEGO_DEV_URL || "";

app.commandLine.appendSwitch("ignore-gpu-blocklist");
app.commandLine.appendSwitch("enable-unsafe-webgpu");
app.commandLine.appendSwitch("enable-features", "WebGPU");

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

let windowRef = null;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

function distRoot() {
  return path.join(__dirname, "..", "dist");
}

function startServer(root) {
  const base = path.resolve(root);
  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      const url = new URL(request.url || "/", "http://127.0.0.1");
      let filePath = path.resolve(base, `.${decodeURIComponent(url.pathname)}`);
      if (filePath !== base && !filePath.startsWith(`${base}${path.sep}`)) {
        response.writeHead(403);
        response.end();
        return;
      }
      const missing = !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory();
      if (missing) {
        if (path.extname(url.pathname)) {
          response.writeHead(404);
          response.end();
          return;
        }
        filePath = path.join(base, "index.html");
      }
      const type = MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream";
      response.writeHead(200, { "Content-Type": type, "Cache-Control": "no-cache" });
      fs.createReadStream(filePath).pipe(response);
    });
    server.listen(PORT, "127.0.0.1", () => resolve(server));
    server.on("error", reject);
  });
}

function createWindow(url) {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: "Wego CAD",
    backgroundColor: "#e6e7ea",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.webContents.setWindowOpenHandler(({ url: target }) => {
    shell.openExternal(target);
    return { action: "deny" };
  });
  windowRef = window;
  void window.loadURL(url);
}

app.on("second-instance", () => {
  if (!windowRef) return;
  if (windowRef.isMinimized()) windowRef.restore();
  windowRef.show();
  windowRef.focus();
});

app.whenReady().then(async () => {
  if (!gotLock) return;
  if (DEV_URL) {
    createWindow(DEV_URL);
    return;
  }
  const root = distRoot();
  if (!fs.existsSync(path.join(root, "index.html"))) {
    throw new Error("缺少 dist/index.html，请先执行 npm run build");
  }
  await startServer(root);
  createWindow(`http://127.0.0.1:${PORT}/`);
}).catch((error) => {
  console.error(error);
  app.quit();
});

app.on("window-all-closed", () => {
  app.quit();
});

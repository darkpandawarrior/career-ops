import { app, BrowserWindow, dialog } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startNextServer, ensureDesktopDataRoot, waitForServer } from "./launcher.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.CAREER_OPS_DESKTOP_PORT || 3000);

let serverChild;
let window;

function sourceRoot() {
  return path.resolve(__dirname, "..", "web");
}

function packagedRoot() {
  return path.join(process.resourcesPath, "web");
}

function createWindow() {
  window = new BrowserWindow({
    width: 1440,
    height: 980,
    title: "Career Ops",
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  window.loadURL(`http://127.0.0.1:${port}`);
}

function showLaunchFailure(message) {
  const safe = message.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html = `<!doctype html><html><head><meta charset="utf-8" /><title>Career Ops could not start</title><style>body { font-family: system-ui, sans-serif; margin: 0; padding: 48px; background: #0f1115; color: #f3f4f6; } .card { max-width: 720px; margin: 0 auto; padding: 32px; border-radius: 20px; background: #171a21; border: 1px solid #2b3140; } h1 { margin: 0 0 12px; font-size: 28px; } p { line-height: 1.6; color: #cbd5e1; } code { display: block; margin-top: 16px; white-space: pre-wrap; background: #0b0d12; padding: 16px; border-radius: 12px; border: 1px solid #2b3140; }</style></head><body><div class="card"><h1>Career Ops could not start</h1><p>The desktop shell is open, but the internal dashboard server did not come up.</p><p>This usually means the packaged app is incomplete, the local build is broken, or a required CLI/runtime is missing on this machine.</p><code>${safe}</code></div></body></html>`;
  if (window && !window.isDestroyed()) {
    window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  }
}

app.whenReady().then(async () => {
  const dataRoot = ensureDesktopDataRoot(app);
  const env = {
    ...process.env,
    CAREER_OPS_ROOT: dataRoot,
    CAREER_OPS_DESKTOP_PORT: String(port),
  };

  const packaged = app.isPackaged;
  const srcRoot = sourceRoot();
  const pkgRoot = packagedRoot();
  serverChild = startNextServer({ sourceRoot: srcRoot, packagedRoot: pkgRoot, port, env, packaged });
  serverChild.on("exit", (code) => {
    if (code && !app.isQuitting) {
      const msg = `The internal Next.js server exited with code ${code}.`;
      dialog.showErrorBox("Career Ops failed to start", msg);
      showLaunchFailure(msg);
    }
  });

  try {
    await waitForServer(port);
    createWindow();
  } catch (err) {
    const msg = String(err instanceof Error ? err.message : err);
    dialog.showErrorBox("Career Ops failed to start", msg);
    showLaunchFailure(msg);
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  app.isQuitting = true;
  if (serverChild && !serverChild.killed) serverChild.kill();
});

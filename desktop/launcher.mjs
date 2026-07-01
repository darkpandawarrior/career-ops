import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import http from "node:http";

const DEFAULT_PORT = Number(process.env.CAREER_OPS_DESKTOP_PORT || 3000);

export function desktopDataRoot(app) {
  const envRoot = process.env.CAREER_OPS_ROOT?.trim();
  if (envRoot) return path.resolve(envRoot);
  return path.join(app.getPath("userData"), "career-ops-data");
}

export function ensureDesktopDataRoot(app) {
  const root = desktopDataRoot(app);
  for (const rel of ["data", "reports", "config", "modes", "output", "interview-prep"]) {
    mkdirSync(path.join(root, rel), { recursive: true });
  }
  return root;
}

export function waitForServer(port, host = "127.0.0.1", timeoutMs = 120_000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get({ host, port, path: "/", timeout: 2_000 }, (res) => {
        res.resume();
        resolve(true);
      });
      req.on("error", () => {
        if (Date.now() - started > timeoutMs) reject(new Error("Timed out waiting for Next.js server"));
        else setTimeout(tick, 500);
      });
      req.on("timeout", () => req.destroy());
    };
    tick();
  });
}

export function startNextServer({ sourceRoot, packagedRoot, port = DEFAULT_PORT, env, packaged = false }) {
  if (packaged) {
    const serverJs = path.join(packagedRoot, "server.js");
    return spawn(process.execPath, [serverJs], {
      cwd: packagedRoot,
      env: { ...env, PORT: String(port), HOSTNAME: "127.0.0.1" },
      stdio: "inherit",
      shell: false,
    });
  }
  const cmd = process.platform === "win32" ? "npm.cmd" : "npm";
  return spawn(cmd, ["run", "start", "--", "-p", String(port)], {
    cwd: sourceRoot,
    env,
    stdio: "inherit",
    shell: false,
  });
}

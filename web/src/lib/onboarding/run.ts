import { spawn } from "node:child_process";
import { careerOpsRoot, rootScript } from "@/lib/career-ops";

/**
 * Spawn the engine's onboarding bridge (onboarding-cli.mjs at the career-ops
 * root) — the same "spawn the real engine, never reimplement it" pattern as
 * /api/run. The CLI lives in the engine root (where dashboard-web/onboarding +
 * its deps live); we pass JSON on stdin and read one JSON object on stdout.
 *
 * `extraArgs` carries the target data root for the write step (activate), so
 * onboarding writes into the ACTIVE profile (resolved by the caller via
 * requestRoot()), keeping multi-profile correct.
 */
export function runOnboarding(
  step: "infer" | "activate",
  extraArgs: string[],
  input: unknown,
): Promise<{ ok: boolean; error?: string; errors?: string[]; [k: string]: unknown }> {
  return new Promise((resolve) => {
    const child = spawn("node", [rootScript("onboarding-cli"), step, ...extraArgs], {
      cwd: careerOpsRoot(),
      env: process.env,
    });
    let out = "";
    let err = "";
    const killer = setTimeout(() => {
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
    }, 60_000);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => {
      clearTimeout(killer);
      resolve({ ok: false, error: e.message });
    });
    child.on("close", () => {
      clearTimeout(killer);
      try {
        resolve(JSON.parse(out.trim().split("\n").pop() || "{}"));
      } catch {
        resolve({ ok: false, error: err.trim() || out.trim() || "onboarding bridge failed" });
      }
    });
    child.stdin.write(JSON.stringify(input ?? {}));
    child.stdin.end();
  });
}

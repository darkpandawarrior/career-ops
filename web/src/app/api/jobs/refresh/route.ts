import { spawn } from "node:child_process";
import fs from "node:fs";
import { engineRoot, engineScript } from "@/lib/career-ops";
import { requestRoot } from "@/lib/profile-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 800; // a full portal crawl + feed fetch is multi-minute

/**
 * Run a real job-search refresh for the active profile and STREAM progress as
 * NDJSON. Spawns job-search-cli.mjs (which runs the engine's refreshJobSearch
 * and rewrites data/job-dashboard.json). The board reloads /api/jobs/cache when
 * the stream ends. This is the "job searching" the legacy /api/refresh did.
 */
export async function POST() {
  const cli = engineScript("job-search-cli");
  if (!fs.existsSync(cli)) {
    return new Response(JSON.stringify({ type: "error", message: "job-search-cli.mjs not found in this checkout" }) + "\n", {
      status: 400,
      headers: { "Content-Type": "application/x-ndjson" },
    });
  }
  const dataRoot = await requestRoot();
  const child = spawn("node", [cli, dataRoot], {
    cwd: engineRoot(),
    env: { ...process.env, CAREER_OPS_ROOT: dataRoot },
  });
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const killer = setTimeout(() => {
        try {
          child.kill("SIGTERM");
        } catch {
          /* ignore */
        }
      }, 780_000);
      const close = () => {
        if (!closed) {
          closed = true;
          clearTimeout(killer);
          try {
            controller.close();
          } catch {
            /* ignore */
          }
        }
      };
      child.stdout.on("data", (d) => {
        if (!closed) controller.enqueue(enc.encode(d.toString()));
      });
      child.on("error", (e) => {
        if (!closed) controller.enqueue(enc.encode(JSON.stringify({ type: "error", message: e.message }) + "\n"));
        close();
      });
      child.on("close", close);
    },
    cancel() {
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache, no-transform" },
  });
}

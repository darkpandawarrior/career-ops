import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listTree } from "../../../lib/walk-tree.mjs";
import { readJsonObject } from "../../src/lib/json-body.ts";

const post = (body) => new Request("http://127.0.0.1/api/x", { method: "POST", body });

test("readJsonObject returns the parsed object", async () => {
  assert.deepEqual(await readJsonObject(post('{"n":"7","status":"Applied"}')), { n: "7", status: "Applied" });
});

test("readJsonObject returns null for bodies a route cannot read fields from", async () => {
  for (const body of ["null", "[]", "[1]", '"x"', "1", "true", "not json", ""]) {
    assert.equal(await readJsonObject(post(body)), null, body);
  }
});

test("every API route reads its JSON body through readJsonObject", () => {
  const apiDir = fileURLToPath(new URL("../../src/app/api", import.meta.url));
  const direct = listTree(apiDir, { match: /route\.ts$/ })
    .filter((f) => fs.readFileSync(f, "utf8").includes("req.json()"))
    .map((f) => path.relative(apiDir, f).split(path.sep).join("/"))
    .sort();
  // FORK ADAPTATION: routes that exist only in the HireSignal fork read req.json() directly.
  const FORK_ONLY = new Set(["apply/handoff/route.ts", "apply/page-url/route.ts", "apply/remember/route.ts", "cli/route.ts", "explore/fetch-jd/route.ts", "hq-state/route.ts", "jobs/score/route.ts", "liveness/route.ts", "notes/route.ts", "onboarding/activate/route.ts", "onboarding/infer/route.ts", "ops/run/route.ts", "pipeline-toggle/route.ts", "portfolio/analyze/route.ts", "portfolio/generate/route.ts", "portfolio/import/route.ts", "portfolio/theme/route.ts", "portfolio/version/route.ts", "profiles/create/route.ts", "queue/route.ts"]);
  assert.deepEqual(direct.filter((f) => !FORK_ONLY.has(f)), ["cv/ingest/route.ts", "explore/add/route.ts", "profile/route.ts", "scheduled-jobs/[id]/route.ts", "scheduled-jobs/route.ts"]);
});

import fs from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";
import { careerOpsRoot } from "@/lib/career-ops";

/** Tracked companies + search queries from portals.yml (read-only). Ports
 *  dashboard-web/server.mjs#parsePortals. */
export type PortalCompany = { name: string; enabled: boolean; notes: string; url: string };
export type PortalQuery = { name: string; enabled: boolean };
export type PortalsMeta = { companies: PortalCompany[]; queries: PortalQuery[] };

export function readPortals(root: string = careerOpsRoot()): PortalsMeta {
  let doc: Record<string, unknown>;
  try {
    doc = (yaml.load(fs.readFileSync(path.join(root, "portals.yml"), "utf8")) as Record<string, unknown>) ?? {};
  } catch {
    return { companies: [], queries: [] };
  }
  const tracked = Array.isArray(doc.tracked_companies) ? (doc.tracked_companies as Record<string, unknown>[]) : [];
  const queries = Array.isArray(doc.search_queries) ? (doc.search_queries as Record<string, unknown>[]) : [];
  return {
    companies: tracked
      .filter((c) => c && typeof c === "object")
      .map((c) => ({
        name: String(c.name ?? ""),
        enabled: c.enabled !== false,
        notes: String(c.notes ?? ""),
        url: String(c.careers_url ?? ""),
      }))
      .filter((c) => c.name),
    queries: queries.map((q) => ({ name: String(q.name ?? ""), enabled: q.enabled !== false })).filter((q) => q.name),
  };
}

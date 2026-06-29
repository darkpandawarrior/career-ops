import type { JobSearchConfig, SearchPlan } from "@/lib/jobs/types";

export function buildSearchPlan(rawConfig: JobSearchConfig | unknown, options?: Record<string, unknown>): SearchPlan;
export function buildPortalFilters(rawConfig: JobSearchConfig | unknown, queries?: unknown[]): unknown;

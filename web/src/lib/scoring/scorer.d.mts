import type { RawJob, ScoredJob, JobSearchConfig } from "@/lib/jobs/types";

/** Score a single raw job against a (raw or normalized) config. */
export function scoreJob(rawJob: RawJob, rawConfig: unknown): ScoredJob;

/** Score + assign a stable id and a `section` bucket. */
export function normalizeJob(rawJob: RawJob, config: JobSearchConfig | unknown): ScoredJob;

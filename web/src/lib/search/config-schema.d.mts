import type { JobSearchConfig, ConfigValidation } from "@/lib/jobs/types";

export function normalizeJobSearchConfig(input?: unknown): JobSearchConfig;
export function validateJobSearchConfig(input: unknown): ConfigValidation;

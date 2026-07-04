// Shared read-only access to the "career-ops:config" localStorage blob.
// config-form.tsx remains the sole writer; this just centralizes the
// parse-and-default logic so read-only consumers (company-logo, usage-meter)
// don't each reimplement it slightly differently.

const CONFIG_KEY = "career-ops:config";

export type LocalConfig = {
  mode?: string;
  cliId?: string;
  provider?: string;
  apiKey?: string;
  logos?: boolean;
};

export function readLocalConfig(): LocalConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    return raw ? (JSON.parse(raw) as LocalConfig) : {};
  } catch {
    return {};
  }
}

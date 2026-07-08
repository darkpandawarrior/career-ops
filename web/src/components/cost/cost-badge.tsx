import { Leaf, Coins, Sparkles } from "lucide-react";
import { COST_META, type CostClass } from "@/lib/explore-cost";

// One primitive, four variants. free/free-network/free-gemini = emerald (no cost);
// spend = BRAND ORANGE (not red — spending on a chosen evaluation is the valuable
// action, not a hazard; red stays reserved for the usage-meter plan brake).
// Muted spend AA-verified in both themes. Styles live in globals.css (.co-cost).

export function CostBadge({ kind, size = "sm", className = "" }: { kind: CostClass; size?: "xs" | "sm"; className?: string }) {
  const tone = kind === "spend" ? "spend" : "free";
  const Icon = kind === "spend" ? Coins : kind === "free-gemini" ? Sparkles : Leaf;
  const meta = COST_META[kind];
  return (
    <span className={`co-cost ${className}`} data-tone={tone} data-size={size} title={meta.tip}>
      <Icon aria-hidden />
      {meta.label}
    </span>
  );
}

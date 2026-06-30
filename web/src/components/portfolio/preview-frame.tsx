"use client";

import { useState } from "react";
import { Monitor, Smartphone } from "lucide-react";
import { cn } from "@/lib/cn";

// Render the generated portfolio HTML in a SANDBOXED iframe (srcDoc). The markup is
// AI-generated → untrusted, so it never touches the app DOM and scripts are not
// allowed (sandbox without allow-scripts). A device toggle previews responsiveness.
export function PreviewFrame({ html }: { html: string }) {
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 self-end">
        <button
          type="button"
          onClick={() => setDevice("desktop")}
          aria-label="Desktop preview"
          className={cn("rounded-md p-1.5", device === "desktop" ? "bg-brand-soft text-brand" : "text-muted hover:text-foreground")}
        >
          <Monitor className="size-4" />
        </button>
        <button
          type="button"
          onClick={() => setDevice("mobile")}
          aria-label="Mobile preview"
          className={cn("rounded-md p-1.5", device === "mobile" ? "bg-brand-soft text-brand" : "text-muted hover:text-foreground")}
        >
          <Smartphone className="size-4" />
        </button>
      </div>
      <div className="flex justify-center rounded-xl border border-border bg-surface/30 p-3">
        <iframe
          title="Portfolio preview"
          sandbox=""
          srcDoc={html}
          className={cn(
            "h-[70vh] rounded-lg border border-border bg-white transition-all",
            device === "mobile" ? "w-[390px]" : "w-full",
          )}
        />
      </div>
    </div>
  );
}

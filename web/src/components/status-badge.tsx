import { cn } from "@/lib/utils";
import { LEFT_FOR_YOU, humanStatus } from "@/lib/api";

const TONE: Record<string, string> = {
  applied: "bg-success/12 text-success ring-success/25",
  queued: "bg-info/10 text-info ring-info/25",
  skipped: "bg-muted text-muted-foreground ring-border",
  failed: "bg-destructive/10 text-destructive ring-destructive/25",
};

/** A job's status as a small pill: green when sent, amber when it waits on the person. */
export function StatusBadge({ statusKey, label, className }: { statusKey: string; label?: string; className?: string }) {
  const tone = TONE[statusKey] ?? (LEFT_FOR_YOU.includes(statusKey) ? "bg-warning/12 text-warning ring-warning/25" : "bg-muted text-muted-foreground ring-border");
  return (
    <span className={cn("inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[11px] leading-none font-semibold whitespace-nowrap capitalize ring-1 ring-inset", tone, className)}>
      {label ?? humanStatus(statusKey || "unknown")}
    </span>
  );
}

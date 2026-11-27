import { ArrowRightIcon, SendIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { StatusBadge } from "@/components/status-badge";
import { PageHeader } from "@/components/page";
import { LiveRun } from "@/components/live-run";
import { needCount, type LiveView, type Needs, type Report } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { Screen } from "@/App";

/** A YYYY-MM-DD day as "Nov 23", read in this machine's time zone. */
const shortDay = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y ?? 0, (m ?? 1) - 1, d ?? 1).toLocaleDateString([], { month: "short", day: "numeric" });
};

function Stat({ label, value, hint, tone, onClick }: { label: string; value: number; hint?: ReactNode; tone?: "warn"; onClick?: () => void }) {
  const body = (
    <>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span className={cn("text-2xl leading-8 font-semibold tracking-tight tabular-nums", tone === "warn" && value > 0 && "text-warning")}>{value.toLocaleString()}</span>
      <span className="truncate text-xs text-muted-foreground">{hint ?? " "}</span>
    </>
  );
  const frame = "flex min-w-0 flex-col gap-0.5 rounded-lg bg-card px-4 py-3 text-left ring-1 ring-foreground/10";
  return onClick ? (
    <button type="button" onClick={onClick} className={cn(frame, "cursor-pointer transition-colors hover:bg-raised focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none")}>
      {body}
    </button>
  ) : (
    <div className={frame}>{body}</div>
  );
}

export function Overview({ report, needs, live, run, go }: { report: Report; needs: Needs | undefined; live: boolean; run: LiveView | null; go: (s: Screen) => void }) {
  const t = report.totals;
  const waiting = needs ? needCount(needs) : t.leftForYou;
  const replies = t.replies;
  const days = report.recentDays.map((d) => ({ key: d.day, label: shortDay(d.day), n: d.applied }));
  const max = Math.max(1, ...days.map((d) => d.n));
  const inWindow = days.reduce((s, d) => s + d.n, 0);

  const recent = report.rows
    .filter((r) => r.status_key === "applied" && r.applied_on)
    .sort((a, b) => b.applied_on.localeCompare(a.applied_on))
    .slice(0, 6);

  const line = [`${t.appliedToday} sent today`, waiting ? `${waiting} waiting for you` : null, `${t.queued} ready to apply to`].filter(Boolean).join(" · ");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Overview" description={line} />

      {live ? <LiveRun view={run} /> : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Applications sent" value={t.applied} hint={t.appliedToday ? `+${t.appliedToday} today` : undefined} onClick={() => go("applications")} />
        <Stat label="Replies" value={replies} hint={replies ? "from employers" : undefined} />
        <Stat label="Needs you" value={waiting} tone="warn" hint={waiting ? "Open the list" : "All caught up"} onClick={live ? () => go("needs") : undefined} />
        <Stat label="Ready to apply" value={t.queued} hint={`of ${t.considered.toLocaleString()} considered`} />
      </div>

      {t.applied ? (
      <Card>
        <CardHeader>
          <CardTitle>Applications, last {days.length} days</CardTitle>
          <CardDescription>{inWindow ? `${inWindow} sent` : "None sent in this time"}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex h-40 items-end gap-1.5" role="img" aria-label={`Applications per day, last ${days.length} days`}>
            {days.map((d) => (
              <div key={d.key} className="group flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5" title={`${d.label}: ${d.n}`}>
                <span className="text-[10px] text-muted-foreground tabular-nums opacity-0 transition-opacity group-hover:opacity-100">{d.n}</span>
                <div className={cn("w-full max-w-7 rounded-sm", d.n ? "bg-primary/85 group-hover:bg-primary" : "bg-muted")} style={{ height: d.n ? `${Math.max(6, (100 * d.n) / max)}%` : "3px" }} />
              </div>
            ))}
          </div>
          <div className="mt-2 flex justify-between text-[11px] text-muted-foreground">
            <span>{days[0]!.label}</span>
            <span>Today</span>
          </div>
        </CardContent>
      </Card>
      ) : null}

      <Card className="gap-0 pb-0">
        <CardHeader className="border-b pb-4">
          <CardTitle>Recent applications</CardTitle>
          <CardAction>
            <Button variant="ghost" size="sm" onClick={() => go("applications")}>
              View all <ArrowRightIcon data-icon="inline-end" />
            </Button>
          </CardAction>
        </CardHeader>
        {recent.length ? (
          <ul className="divide-y">
            {recent.map((r) => (
              <li key={r.job_id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{r.company}</p>
                  <p className="truncate text-xs text-muted-foreground">{r.role}</p>
                </div>
                {r.response ? <StatusBadge statusKey="queued" label={r.response} /> : null}
                <span className="hidden font-mono text-xs text-muted-foreground tabular-nums sm:inline">{r.applied_on.slice(0, 10)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <Empty className="border-0 py-10">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <SendIcon />
              </EmptyMedia>
              <EmptyTitle>Nothing sent yet</EmptyTitle>
              <EmptyDescription>
                {t.queued ? `${t.queued} jobs are ready. Type /apply in Claude Code to start sending.` : "Type /discover in Claude Code to find jobs."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </Card>
    </div>
  );
}

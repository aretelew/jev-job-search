import { useEffect, useState } from "react";
import { ChevronDownIcon, CircleAlertIcon, CircleCheckIcon, CircleDashedIcon, CircleMinusIcon, CircleStopIcon, CircleXIcon, HourglassIcon, LoaderCircleIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { boardName, useChange, type Live, type LiveJob, type LiveView } from "@/lib/api";
import { cn } from "@/lib/utils";

type Outcome = NonNullable<LiveJob["outcome"]>;

/** How each ending is drawn: its colour in the bar and the list, and its words in the legend. */
const ENDING: Record<Outcome, { bar: string; text: string; words: string; icon: typeof CircleCheckIcon }> = {
  applied: { bar: "bg-success", text: "text-success", words: "sent", icon: CircleCheckIcon },
  ready: { bar: "bg-success/60", text: "text-success", words: "ready", icon: CircleCheckIcon },
  unconfirmed: { bar: "bg-warning", text: "text-warning", words: "not confirmed", icon: CircleAlertIcon },
  waiting: { bar: "bg-warning", text: "text-warning", words: "waiting for you", icon: HourglassIcon },
  left: { bar: "bg-warning/70", text: "text-warning", words: "left for you", icon: CircleAlertIcon },
  rehearsed: { bar: "bg-info/60", text: "text-info", words: "rehearsed", icon: CircleMinusIcon },
  skipped: { bar: "bg-muted-foreground/40", text: "text-muted-foreground", words: "skipped", icon: CircleMinusIcon },
  failed: { bar: "bg-destructive", text: "text-destructive", words: "failed", icon: CircleXIcon },
};
const ORDER: Outcome[] = ["applied", "ready", "unconfirmed", "waiting", "left", "rehearsed", "skipped", "failed"];

/** The four stages a person would name, and which steps of the run belong to each. */
const STAGES = [
  { label: "Open", steps: ["opening", "signing_in"] },
  { label: "Fill", steps: ["mapping", "filling", "checking", "next_page"] },
  { label: "Answer", steps: ["writing"] },
  { label: "Send", steps: ["submitting", "watching"] },
] as const;
const stageOf = (step: LiveJob["step"]) => STAGES.findIndex((s) => (s.steps as readonly string[]).includes(step));

/** The time now, once a second while `on`, so clocks on the page move by themselves. */
function useNow(on: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [on]);
  return now;
}

/** A span of time as "45s", "4m 12s" or "1h 3m". */
export function span(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const clockSeconds = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });

/** What kind of run this is, from the command it was started with. */
function kindOf(command: string): { name: string; doing: string } {
  const word = command.split(" ")[0] ?? "";
  const rehearsal = /--dry\b/.test(command);
  if (word === "daily") return { name: rehearsal ? "Daily run rehearsal" : "Daily run", doing: rehearsal ? "Rehearsing the daily run" : "The daily run is applying" };
  if (word === "apply") return { name: rehearsal ? "Rehearsal" : "Apply", doing: rehearsal ? "Rehearsing applications" : /--submit\b/.test(command) ? "Applying now" : "Filling forms" };
  if (word === "resume") return { name: "Resume", doing: "Watching the forms left open for you" };
  if (word === "reconcile") return { name: "Reconcile", doing: "Settling unconfirmed submissions" };
  if (word === "submit") return { name: "Submit", doing: "Sending ready forms" };
  if (word === "fill") return { name: "Fill", doing: "Filling forms" };
  return { name: word || "Run", doing: "A run is working" };
}

/** One bar for every job the run took: a segment per ending, then the one being worked on, then what waits. */
function JobsBar({ jobs }: { jobs: LiveJob[] }) {
  const total = jobs.length;
  if (!total) return null;
  const working = jobs.filter((j) => j.step !== "done" && j.startedAt).length;
  const ended = ORDER.map((o) => ({ o, n: jobs.filter((j) => j.step === "done" && j.outcome === o).length })).filter((x) => x.n);
  return (
    <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={jobs.filter((j) => j.step === "done").length}>
      {ended.map(({ o, n }) => (
        <div key={o} className={cn("h-full transition-[width] duration-500", ENDING[o].bar)} style={{ width: `${(100 * n) / total}%` }} />
      ))}
      {working ? <div className="h-full animate-pulse bg-primary/50 transition-[width] duration-500" style={{ width: `${(100 * working) / total}%` }} /> : null}
    </div>
  );
}

function Stages({ step }: { step: LiveJob["step"] }) {
  const at = stageOf(step);
  return (
    <ol className="flex items-center gap-1.5" aria-label="Where this form is">
      {STAGES.map((s, i) => (
        <li key={s.label} className="flex items-center gap-1.5">
          <span
            className={cn(
              "inline-flex h-5 items-center rounded-full px-2 text-[11px] leading-none font-medium ring-1 ring-inset",
              i < at && "bg-success/12 text-success ring-success/25",
              i === at && "bg-primary text-primary-foreground ring-primary",
              i > at && "text-muted-foreground ring-border",
            )}
          >
            {s.label}
          </span>
          {i < STAGES.length - 1 ? <span className={cn("h-px w-3", i < at ? "bg-success/50" : "bg-border")} /> : null}
        </li>
      ))}
    </ol>
  );
}

function JobIcon({ job, running }: { job: LiveJob; running: boolean }) {
  if (job.step === "done" && job.outcome) {
    const E = ENDING[job.outcome];
    return <E.icon className={cn("size-4 shrink-0", E.text)} />;
  }
  if (job.startedAt && running) return <LoaderCircleIcon className="size-4 shrink-0 animate-spin text-primary" />;
  if (job.startedAt) return <CircleAlertIcon className="size-4 shrink-0 text-muted-foreground" />;
  return <CircleDashedIcon className="size-4 shrink-0 text-muted-foreground/60" />;
}

/** The form being worked on now, large: where it is, what it does, and for how long. */
function Current({ job, now }: { job: LiveJob; now: number }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg bg-muted/50 p-4 ring-1 ring-foreground/5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{job.company}</p>
          <p className="truncate text-xs text-muted-foreground">
            {job.title}
            {job.board ? ` · ${boardName(job.board)}` : ""}
            {job.page > 1 ? ` · page ${job.page}` : ""}
          </p>
        </div>
        {job.startedAt ? <span className="font-mono text-xs text-muted-foreground tabular-nums">{span(now - Date.parse(job.startedAt))} on this form</span> : null}
      </div>
      <Stages step={job.step} />
      <p className="flex items-center gap-2 text-sm">
        <LoaderCircleIcon className="size-3.5 shrink-0 animate-spin text-primary" />
        <span className="min-w-0">{job.detail}</span>
      </p>
    </div>
  );
}

function Legend({ jobs }: { jobs: LiveJob[] }) {
  const parts = ORDER.map((o) => ({ o, n: jobs.filter((j) => j.step === "done" && j.outcome === o).length })).filter((x) => x.n);
  const waiting = jobs.filter((j) => !j.startedAt).length;
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {parts.map(({ o, n }) => (
        <span key={o} className="flex items-center gap-1.5">
          <span className={cn("size-2 rounded-full", ENDING[o].bar)} />
          {n} {ENDING[o].words}
        </span>
      ))}
      {waiting ? (
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-muted ring-1 ring-border" />
          {waiting} up next
        </span>
      ) : null}
    </div>
  );
}

function JobList({ jobs, running }: { jobs: LiveJob[]; running: boolean }) {
  return (
    <ul className="divide-y rounded-lg ring-1 ring-foreground/10">
      {jobs.map((j) => (
        <li key={j.id} className={cn("flex items-start gap-3 px-3 py-2.5", !j.startedAt && "opacity-60")}>
          <span className="mt-0.5">
            <JobIcon job={j} running={running} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">
              {j.company} <span className="font-normal text-muted-foreground">· {j.title}</span>
            </p>
            <p className="line-clamp-2 text-xs text-muted-foreground">{j.detail}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

const TONE = { info: "bg-muted-foreground/40", good: "bg-success", warn: "bg-warning", bad: "bg-destructive" } as const;

function Activity({ live, all }: { live: Live; all: boolean }) {
  const names = new Map(live.jobs.map((j) => [j.id, j.company]));
  const events = [...live.events].reverse().slice(0, all ? undefined : 10);
  return (
    <ol className="flex flex-col" aria-live="polite">
      {events.map((e, i) => (
        <li key={`${e.at}-${i}`} className="flex gap-3 py-1.5 text-xs">
          <span className="w-[4.5rem] shrink-0 font-mono text-muted-foreground tabular-nums">{clockSeconds(e.at)}</span>
          <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", TONE[e.tone])} />
          <span className="min-w-0">
            {e.job && names.get(e.job) ? <span className="font-medium">{names.get(e.job)}: </span> : null}
            <span className="text-muted-foreground">{e.text}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * The overview's live panel: what the run working now is doing, how far it has come, and its latest
 * steps, moving as the run goes. After a run ends it says what that run did, folded up.
 */
export function LiveRun({ view }: { view: LiveView | null }) {
  const running = view?.state === "running";
  const now = useNow(running);
  const [open, setOpen] = useState(false);
  const [allEvents, setAllEvents] = useState(false);
  const [stopAsked, setStopAsked] = useState(false);
  const { busy, run } = useChange();
  useEffect(() => {
    if (!running) setStopAsked(false);
  }, [running]);

  if (!view || view.state === "none") return null;
  const live = view.live;
  const kind = kindOf(live.command);
  const jobs = live.jobs;
  const done = jobs.filter((j) => j.step === "done").length;
  const current = jobs.filter((j) => j.step !== "done" && j.startedAt);
  const isDaily = live.command.startsWith("daily");
  const elapsed = Date.parse(live.endedAt ?? (running ? new Date(now).toISOString() : live.updatedAt)) - Date.parse(live.startedAt);

  // A guess at the time left, from how long each finished form took. A daily run waits minutes between boards on purpose, so it gets none.
  const finished = jobs.filter((j) => j.step === "done" && j.startedAt && j.endedAt);
  const perJob = finished.length ? finished.reduce((s, j) => s + Date.parse(j.endedAt!) - Date.parse(j.startedAt!), 0) / finished.length : 0;
  const left = running && !isDaily && perJob ? perJob * (jobs.length - done) : 0;
  const pause = running && live.until ? Date.parse(live.until) - now : 0;

  if (!running) {
    const stopped = view.state === "stopped";
    return (
      <Card size="sm" className="gap-3">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {stopped ? <CircleAlertIcon className="size-4 text-warning" /> : <CircleCheckIcon className="size-4 text-success" />}
            {stopped ? `${kind.name} stopped before it finished` : `Last run: ${kind.name.toLowerCase()}`}
          </CardTitle>
          <CardDescription>
            {stopped ? `Last heard from at ${clock(live.updatedAt)}` : `Finished at ${clock(live.endedAt ?? live.updatedAt)}`} · took {span(elapsed)} · {jobs.length} job{jobs.length === 1 ? "" : "s"}
          </CardDescription>
          <CardAction>
            <Button variant="ghost" size="sm" onClick={() => setOpen(!open)} aria-expanded={open}>
              {open ? "Hide" : "Details"} <ChevronDownIcon data-icon="inline-end" className={cn("transition-transform", open && "rotate-180")} />
            </Button>
          </CardAction>
        </CardHeader>
        {jobs.length || open ? (
          <CardContent className="flex flex-col gap-3">
            {jobs.length ? <JobsBar jobs={jobs} /> : null}
            {jobs.length ? <Legend jobs={jobs} /> : null}
            {open ? (
              <div className="grid gap-4 pt-1 lg:grid-cols-2 *:min-w-0">
                {jobs.length ? <JobList jobs={jobs} running={false} /> : null}
                <Activity live={live} all />
              </div>
            ) : null}
          </CardContent>
        ) : null}
      </Card>
    );
  }

  return (
    <Card className="gap-4 ring-primary/25" id="live-run">
      <CardHeader>
        <CardTitle className="flex items-center gap-2.5">
          <span className="relative flex size-2.5">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60" />
            <span className="relative inline-flex size-2.5 rounded-full bg-success" />
          </span>
          {kind.doing}
        </CardTitle>
        <CardDescription>
          Started {clock(live.startedAt)} · {span(elapsed)} so far
          {left ? ` · about ${span(left)} left` : ""}
        </CardDescription>
        {isDaily ? (
          <CardAction>
            <Button
              variant="outline"
              size="sm"
              disabled={busy || stopAsked}
              onClick={() => void run("/api/stop", {}, "The daily run stops after the application it is on").then((ok) => ok && setStopAsked(true))}
            >
              <CircleStopIcon data-icon="inline-start" />
              {stopAsked ? "Stopping after this one" : "Stop after this one"}
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {live.goal ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between text-sm">
              <span className="font-medium">Today's applications</span>
              <span className="tabular-nums text-muted-foreground">
                <span className="text-base font-semibold text-foreground">{live.goal.done}</span> of {live.goal.target}
              </span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={live.goal.target} aria-valuenow={live.goal.done}>
              <div className="h-full rounded-full bg-success transition-[width] duration-500" style={{ width: `${Math.min(100, (100 * live.goal.done) / Math.max(1, live.goal.target))}%` }} />
            </div>
          </div>
        ) : null}

        {jobs.length ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between text-sm">
              <span className="font-medium">{isDaily ? "Jobs opened this run" : "Jobs in this run"}</span>
              <span className="tabular-nums text-muted-foreground">
                <span className="text-base font-semibold text-foreground">{done}</span> of {jobs.length} done
              </span>
            </div>
            <JobsBar jobs={jobs} />
            <Legend jobs={jobs} />
          </div>
        ) : null}

        {current.length ? (
          <div className="flex flex-col gap-3">
            {current.map((j) => (
              <Current key={j.id} job={j} now={now} />
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-3 rounded-lg bg-muted/50 p-4 text-sm ring-1 ring-foreground/5">
            {pause > 0 ? <HourglassIcon className="size-4 shrink-0 text-muted-foreground" /> : <LoaderCircleIcon className="size-4 shrink-0 animate-spin text-primary" />}
            <span className="min-w-0 flex-1">{live.activity}</span>
            {pause > 0 ? <span className="font-mono text-xs text-muted-foreground tabular-nums">{span(pause)} left</span> : null}
          </div>
        )}

        <div className="grid gap-5 lg:grid-cols-2 *:min-w-0">
          {jobs.length ? (
            <div className="flex flex-col gap-2">
              <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Jobs</h3>
              <JobList jobs={jobs} running />
            </div>
          ) : null}
          <div className={cn("flex flex-col gap-1", !jobs.length && "lg:col-span-2")}>
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Latest steps</h3>
              {live.events.length > 10 ? (
                <Button variant="ghost" size="xs" onClick={() => setAllEvents(!allEvents)}>
                  {allEvents ? "Fewer" : `All ${live.events.length}`}
                </Button>
              ) : null}
            </div>
            <Activity live={live} all={allEvents} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * What the run working now is doing, for the dashboard's live panel. The run that holds the
 * browser writes data/runs/live.json as it goes: which jobs it took, the step each one is on, how
 * each one ended, and its latest steps in words. The dashboard only reads the file.
 *
 * Nothing is written unless this process began a live run (`beginLive`), so a test or a command
 * that does not drive the browser never touches the file. Every text goes through `scrub`, and the
 * file holds no value a form was given: only companies, roles, steps and the reasons the records
 * already carry.
 */
import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import { PATHS, REPORT } from "../config.js";
import type { QueueEntry } from "../jobs/queue.js";
import { scrub } from "../util/redact.js";
import { currentRun, writeAtomic, type RunInfo } from "../util/store.js";
import { UNKNOWN_REASON } from "./outcome.js";

/** The steps of one job, in the order a form goes through them. */
export const LiveStep = z.enum(["waiting", "opening", "signing_in", "mapping", "filling", "checking", "writing", "next_page", "submitting", "watching", "done"]);
export type LiveStep = z.infer<typeof LiveStep>;

/** How a job ended in this run. */
export const LiveOutcome = z.enum(["applied", "unconfirmed", "waiting", "left", "skipped", "ready", "rehearsed", "failed"]);
export type LiveOutcome = z.infer<typeof LiveOutcome>;

const Tone = z.enum(["info", "good", "warn", "bad"]);
type Tone = z.infer<typeof Tone>;

const LiveJob = z.object({
  id: z.string(),
  company: z.string(),
  title: z.string(),
  board: z.string(),
  step: LiveStep,
  page: z.number().int().min(1),
  detail: z.string(),
  outcome: LiveOutcome.nullable(),
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
});
export type LiveJob = z.infer<typeof LiveJob>;

const LiveEvent = z.object({ at: z.string(), text: z.string(), tone: Tone, job: z.string().nullable() });

export const Live = z.object({
  pid: z.number().int(),
  command: z.string(),
  startedAt: z.string(),
  updatedAt: z.string(),
  endedAt: z.string().nullable(),
  /** What the run as a whole is doing when no one job says it: looking for jobs, waiting for a board. */
  activity: z.string(),
  /** When a pause the run is in ends. */
  until: z.string().nullable(),
  /** A run that works toward a number of applications (the daily run): how many, and how many are done, earlier today included. */
  goal: z.object({ target: z.number().int(), done: z.number().int() }).nullable(),
  jobs: z.array(LiveJob),
  /** The run's latest steps, newest last. */
  events: z.array(LiveEvent),
});
export type Live = z.infer<typeof Live>;

/** What the page is told: a run working now, one that ended a little while ago, one whose process ended before it could say so, or nothing. */
export type LiveView = { state: "running" | "ended" | "stopped"; live: Live } | { state: "none"; live: null };

let state: Live | null = null;
let file = PATHS.live;
const now = () => new Date().toISOString();
const clean = (text: string, max = 300) => scrub(text).replace(/\s+/g, " ").trim().slice(0, max);

function save(): void {
  if (!state) return;
  state.updatedAt = now();
  state.events = state.events.slice(-REPORT.liveEvents);
  try {
    writeAtomic(file, JSON.stringify(state));
  } catch {
    // The panel is a view of the run. A write that fails never stops the run itself.
  }
}

function event(text: string, tone: Tone = "info", job: string | null = null): void {
  state?.events.push({ at: now(), text: clean(text), tone, job });
}

const jobOf = (id: string) => state?.jobs.find((j) => j.id === id);

/** Starts the live record of a run. Called by the command that takes the run lock. */
export function beginLive(command: string, to = PATHS.live): void {
  file = to;
  const at = now();
  state = { pid: process.pid, command: clean(command, 80), startedAt: at, updatedAt: at, endedAt: null, activity: "Starting", until: null, goal: null, jobs: [], events: [] };
  event(`Started: ${command}`);
  save();
}

/** Ends the live record: the file stays, so the page can show what the run did. */
export function endLive(): void {
  if (!state) return;
  state.endedAt = now();
  state.activity = "Finished";
  state.until = null;
  event("Finished", "good");
  save();
  state = null;
}

/** Adds the jobs a run took, each waiting its turn. A job already listed keeps its place. */
export function liveJobs(entries: readonly QueueEntry[]): void {
  if (!state) return;
  for (const e of entries) {
    if (jobOf(e.job.id)) continue;
    state.jobs.push({ id: e.job.id, company: clean(e.job.company, 120), title: clean(e.job.title, 160), board: e.job.ats, step: "waiting", page: 1, detail: "Up next", outcome: null, startedAt: null, endedAt: null });
  }
  save();
}

/** One job moved to a step. `detail` says it in words, and goes to the run's latest steps too. */
export function liveStep(id: string, step: Exclude<LiveStep, "done">, detail: string, page?: number): void {
  const j = jobOf(id);
  if (!state || !j) return;
  // A job that ended keeps its ending, unless it is taken up again (a second go, a form signed in to).
  if (j.step === "done" && step === "waiting") return;
  if (j.step === "done") Object.assign(j, { outcome: null, endedAt: null });
  j.step = step;
  j.detail = clean(detail);
  if (page) j.page = page;
  j.startedAt ??= now();
  state.activity = `${j.company}: ${j.detail}`;
  state.until = null;
  event(j.detail, "info", id);
  save();
}

/** One job ended in this run, with what became of it. */
export function liveDone(id: string, outcome: LiveOutcome, detail: string): void {
  const j = jobOf(id);
  if (!state || !j) return;
  Object.assign(j, { step: "done", outcome, detail: clean(detail), endedAt: now() });
  j.startedAt ??= j.endedAt;
  event(j.detail, TONES[outcome], id);
  save();
}

const TONES: Record<LiveOutcome, Tone> = { applied: "good", ready: "good", rehearsed: "info", unconfirmed: "warn", waiting: "warn", left: "warn", skipped: "info", failed: "bad" };

/** The words and the ending for a status a run records. Null for a status that is not an ending (a job put back in the queue). */
export function outcomeOfStatus(status: QueueEntry["status"], reason: string | null): { outcome: LiveOutcome; detail: string } | null {
  const why = reason ? `: ${reason}` : "";
  switch (status) {
    case "applied":
      return { outcome: "applied", detail: "Sent. The page confirmed it" };
    case "submission_unknown":
      return { outcome: "unconfirmed", detail: `Submit clicked, waiting for the confirmation${reason && reason !== UNKNOWN_REASON ? `: ${reason}` : ""}` };
    case "awaiting_user_action":
    case "awaiting_email_verification":
      return { outcome: "waiting", detail: `Waiting for you${why}` };
    case "needs_review":
    case "blocked":
    case "login_required":
      return { outcome: "left", detail: `Left for you${why}` };
    case "skipped":
      return { outcome: "skipped", detail: `Skipped${why}` };
    case "failed":
      return { outcome: "failed", detail: `Failed${why}` };
    default:
      return null;
  }
}

/** A status a run recorded for a job it is working on. */
export function liveRecorded(id: string, status: QueueEntry["status"], reason: string | null): void {
  const o = outcomeOfStatus(status, reason);
  if (o) liveDone(id, o.outcome, o.detail);
}

/** What the run as a whole is doing, with when a pause ends. Also goes to the run's latest steps. */
export function liveActivity(text: string, until: Date | null = null): void {
  if (!state) return;
  state.activity = clean(text);
  state.until = until ? until.toISOString() : null;
  event(text);
  save();
}

/** A line the run printed that the person should see on the page too. */
export function liveNote(text: string, tone: Tone = "info"): void {
  if (!state || !text.trim()) return;
  event(text, tone);
  save();
}

/** How far a run that works toward a number of applications has come. Written only when it changed. */
export function liveGoal(target: number, done: number): void {
  if (!state || (state.goal?.target === target && state.goal.done === done)) return;
  state.goal = { target, done };
  save();
}

/** The live file as it is, or null when there is none or it cannot be read. */
export function readLive(from = PATHS.live): Live | null {
  try {
    if (!existsSync(from)) return null;
    const p = Live.safeParse(JSON.parse(readFileSync(from, "utf8")));
    return p.success ? p.data : null;
  } catch {
    return null;
  }
}

/**
 * What the page shows. A run is working only while the run lock names the process that wrote the
 * file; without that the file is what a run left behind, shown for a while after it ended.
 */
export function liveView(o: { file?: string; run?: RunInfo | null; at?: Date } = {}): LiveView {
  const live = readLive(o.file);
  if (!live) return { state: "none", live: null };
  const run = o.run === undefined ? currentRun() : o.run;
  if (!live.endedAt && run?.pid === live.pid) return { state: "running", live };
  const at = (o.at ?? new Date()).getTime();
  const last = Date.parse(live.endedAt ?? live.updatedAt);
  if (!(at - last <= REPORT.lastRunHours * 60 * 60_000)) return { state: "none", live: null };
  return { state: live.endedAt ? "ended" : "stopped", live };
}

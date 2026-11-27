/**
 * What the page is given and what it can ask for. The shapes are the server's own types, imported
 * as types only, so the page and the server cannot drift apart and nothing from the server is bundled.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import type { Report, ReportRow } from "../../../src/report/data.js";
import type { Needs, Question } from "../../../src/report/needs.js";
import type { automation } from "../../../src/report/server.js";
import type { Live, LiveJob, LiveView } from "../../../src/run/live.js";

export type { Live, LiveJob, LiveView, Needs, Question, Report };
export type Row = ReportRow;
export type Automation = ReturnType<typeof automation>;
export type Policy = Automation["defaults"];

/** What the server writes into the page: the token for changes, the statuses it offers, the statuses that wait on the person, and a snapshot's data. */
type Boot = { token: string; statuses: string[]; left: string[]; snapshot: Report | null; poll?: { live: number; idle: number } };

function readBoot(): Boot {
  try {
    const text = document.getElementById("data")?.textContent;
    if (text) return JSON.parse(text) as Boot;
  } catch {
    // An unbuilt page under `vite dev` has no data written into it.
  }
  return { token: "", statuses: [], left: [], snapshot: null };
}

const boot = readBoot();
export const STATUSES = boot.statuses;
export const LEFT_FOR_YOU = boot.left;
const POLL = boot.poll ?? { live: 1500, idle: 6000 };

/** One request's outcome: its value, or why it could not be had. */
export type Loaded<T> = { value: T; error?: undefined } | { value?: undefined; error: string };

/** A saved snapshot has only the records. A live page also has what waits for the person and the daily run, each loaded on its own. */
export type Data = { live: false; report: Loaded<Report> } | { live: true; report: Loaded<Report>; needs: Loaded<Needs>; auto: Loaded<Automation> };

export const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

async function get<T>(path: string): Promise<Loaded<T>> {
  try {
    const res = await fetch(path);
    if (!res.ok) return { error: `${path} answered ${res.status}` };
    return { value: (await res.json()) as T };
  } catch (err) {
    return { error: errorText(err) };
  }
}

export async function loadAll(): Promise<Data> {
  if (boot.snapshot) return { live: false, report: { value: boot.snapshot } };
  const [report, needs, auto] = await Promise.all([get<Report>("/api/data"), get<Needs>("/api/needs"), get<Automation>("/api/automation")]);
  return { live: true, report, needs, auto };
}

/** Sends a change. Throws with the server's own words when it is refused. */
export async function post<T = { ok: boolean }>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json", "x-jev-token": boot.token }, body: JSON.stringify(body) });
  const parsed = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok || !parsed) throw new Error(parsed?.error || `not saved (${res.status})`);
  return parsed;
}

/**
 * What the run working now is doing, asked for again and again: often while a run works, now and
 * then while none does, so a run that starts is noticed. A saved snapshot asks nothing. A request
 * that fails keeps what was last seen, so a slow moment never empties the panel.
 */
export function useLive(live: boolean): LiveView | null {
  const [view, setView] = useState<LiveView | null>(null);
  useEffect(() => {
    if (!live) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      const got = await get<LiveView>("/api/live");
      if (stopped) return;
      if (got.value) setView(got.value);
      const running = (got.value ?? null)?.state === "running";
      // A tab in the background asks as seldom as when no run works.
      timer = setTimeout(() => void tick(), running && !document.hidden ? POLL.live : POLL.idle);
    };
    const onShow = () => {
      if (document.hidden) return;
      clearTimeout(timer);
      void tick();
    };
    void tick();
    document.addEventListener("visibilitychange", onShow);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [live]);
  return view;
}

/** Reloads every record. Given by the page's root, so a screen never threads it through. */
export const ReloadContext = createContext<() => Promise<void>>(async () => {});

/**
 * Sends one change, says how it went, and reloads. `busy` is true while a change is on its way, and a
 * second one is refused until then, so a double click never sends twice.
 */
export function useChange() {
  const reload = useContext(ReloadContext);
  const sending = useRef(false);
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async (path: string, body: unknown, done: string): Promise<boolean> => {
      if (sending.current) return false;
      sending.current = true;
      setBusy(true);
      try {
        await post(path, body);
        toast.success(done);
        await reload();
        return true;
      } catch (err) {
        toast.error("Not saved", { description: errorText(err) });
        return false;
      } finally {
        sending.current = false;
        setBusy(false);
      }
    },
    [reload],
  );
  return { busy, run };
}

export const needCount = (n: Needs) => n.waiting.length + n.questions.length + n.unconfirmed.length + n.mail.length;

/** The status's own words, without the reason after the colon. */
export const statusWords = (r: Row) => r.status.replace(/:.*$/, "");
/** The reason a record gives, from its skip reason or the words after the status. */
export const reasonOf = (r: Row) => r.skip_reason || r.status.replace(/^[^:]*:\s*/, "").replace(statusWords(r), "").trim();

export const humanStatus = (s: string) => {
  const w = s.replace(/_/g, " ");
  return w.charAt(0).toUpperCase() + w.slice(1);
};

const BOARDS: Record<string, string> = {
  ashby: "Ashby",
  bamboohr: "BambooHR",
  greenhouse: "Greenhouse",
  icims: "iCIMS",
  jobvite: "Jobvite",
  lever: "Lever",
  smartrecruiters: "SmartRecruiters",
  successfactors: "SuccessFactors",
  workday: "Workday",
};
/** A job board's name as the board writes it. */
export const boardName = (ats: string) => BOARDS[ats.toLowerCase()] ?? (ats ? ats.charAt(0).toUpperCase() + ats.slice(1) : "");

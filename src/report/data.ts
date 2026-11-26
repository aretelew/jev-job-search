/**
 * What the dashboard shows: every record as one list of plain rows, and the totals above them.
 * Pure over the rows, so the same numbers come out of a test and of the page.
 */
import { z } from "zod";
import { REPORT } from "../config.js";
import { QueueStatus } from "../jobs/queue.js";
import { statusKeyOf, takehomeRecords, toRecord, type Row } from "../log/csv.js";

/** One job as the page shows it. status_key is the status itself; status is the words in the record. */
export type ReportRow = ReturnType<typeof toRecord> & { takehome_link: string; status_key: string; posted_on: string };

export type Report = {
  rows: ReportRow[];
  totals: { applied: number; appliedToday: number; replies: number; leftForYou: number; queued: number; considered: number };
  /** Applications sent on each of the last REPORT.chartDays days, oldest first, with the days nothing was sent. */
  recentDays: { day: string; applied: number }[];
  generatedAt: string;
};

/** A date as YYYY-MM-DD in this machine's own time zone. */
const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** The page's rows and totals, from the records and the queue. The queue gives the day each job was posted. */
export function buildReport(rows: Row[], entries: readonly { job: { id: string; postedAt: string | null } }[], today = new Date()): Report {
  const posted = new Map(entries.flatMap((e) => (e.job.postedAt ? [[e.job.id, e.job.postedAt.slice(0, 10)] as [string, string]] : [])));
  const takehome = new Map(takehomeRecords(rows).map((t) => [t.job_id, t.takehome_link]));
  const all = rows.map((r) => ({ ...toRecord(r), takehome_link: takehome.get(r["Job ID"]) ?? "", status_key: statusKeyOf(r["App. Status"]) ?? "", posted_on: posted.get(r["Job ID"]) ?? "" }));
  const count = (f: (r: ReportRow) => boolean) => all.filter(f).length;
  const applied = all.filter((r) => r.status_key === "applied");
  const perDay = new Map<string, number>();
  for (const r of applied) if (r.applied_on) perDay.set(r.applied_on.slice(0, 10), (perDay.get(r.applied_on.slice(0, 10)) ?? 0) + 1);
  const recentDays = Array.from({ length: REPORT.chartDays }, (_, i) => {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (REPORT.chartDays - 1 - i));
    return { day: localDay(d), applied: perDay.get(localDay(d)) ?? 0 };
  });
  return {
    rows: all,
    totals: {
      applied: applied.length,
      appliedToday: perDay.get(localDay(today)) ?? 0,
      replies: count((r) => !!r.response),
      leftForYou: count((r) => LEFT_FOR_YOU.includes(r.status_key)),
      queued: count((r) => r.status_key === "queued"),
      considered: all.length,
    },
    recentDays,
    generatedAt: new Date().toISOString(),
  };
}

/** Statuses that put a job in front of the person: on the by-hand list, or open and waiting. */
export const LEFT_FOR_YOU: readonly string[] = ["needs_review", "blocked", "login_required", "awaiting_user_action", "awaiting_email_verification", "submission_unknown"];

/** A status change sent from the page. */
export const StatusChange = z.object({
  id: z.string().min(1).max(64),
  status: QueueStatus.refine((s) => (REPORT.statuses as readonly string[]).includes(s), "not a status the page offers").optional(),
  reason: z.string().max(500).optional(),
  notes: z.string().max(2000).optional(),
  /** The status the page was showing when the person chose. A change is refused when the job has moved on since. */
  was: z.string().max(40).optional(),
});
export type StatusChange = z.infer<typeof StatusChange>;

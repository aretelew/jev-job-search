/**
 * One outreach run: for each job, find the employer on LinkedIn, read a few search pages of people
 * who work there now, ask JEV who each one is, keep the ones worth reaching out to, and write them
 * down. The person reaches out to them; the tool writes no message. The run loads pages and reads them, nothing more: it never clicks, types or
 * sends on LinkedIn. It keeps the tool's own limits (pages a day, a person's pace between pages)
 * and stops at the first page that is a sign-in, a check or a limit, and a check or a limit pauses
 * outreach until the next day. A person runs it and watches; nothing schedules it.
 */
import { OUTREACH } from "../config.js";
import type { JevClient } from "../jev/client.js";
import type { QueueEntry } from "../jobs/queue.js";
import { dayOfMail } from "../mail/status.js";
import type { Profile } from "../profile/schema.js";
import type { Page } from "../browser/cdp.js";
import { companyIdFrom, companyPageUrl, companySearchUrl, companySlugFrom, pageState, parseCard, PageRead, personId, READ_EXPR, searchesFor, type Card } from "./linkedin.js";
import { judge, pick, whyOf, type Judged } from "./rank.js";
import { loadOutreach, mutateOutreach, type OutreachFile, type Person } from "./records.js";

/** Loads a page and says what it shows. The real one drives the tool's Chrome; a test gives a scripted one. */
export interface Browse {
  read(url: string): Promise<PageRead>;
}

export type RunDeps = {
  browse: Browse;
  jev: Pick<JevClient, "decide">;
  sleep: (ms: number) => Promise<void>;
  now?: () => Date;
  random?: () => number;
  file?: string;
  cacheFile?: string;
  log?: (line: string) => void;
};

export type JobResult = { jobId: string; company: string; title: string; kept: Person[]; executives: number; note: string | null };
export type RunResult = { jobs: JobResult[]; pages: number; stopped: string | null };

/** Thrown when LinkedIn shows something other than results. It ends the run, never retried. */
export class Stop extends Error {}

/** Why a run may not start now, or null when it may. */
export function refusal(f: OutreachFile, now: Date): string | null {
  if (!f.riskAcknowledgedAt) return "outreach has not been set up. Run outreach signin first: it explains the risk to your LinkedIn account and opens the sign-in.";
  if (f.pausedUntil && Date.parse(f.pausedUntil) > now.getTime()) return `outreach is paused until ${f.pausedUntil.slice(0, 16).replace("T", " ")} because ${f.pausedWhy ?? "LinkedIn asked it to stop"}.`;
  if (f.pagesToday.date === dayOfMail(now.getTime()) && f.pagesToday.count >= OUTREACH.pagesPerDay) return `today's ${OUTREACH.pagesPerDay} LinkedIn pages are used. Try again tomorrow.`;
  return null;
}

/** The next local midnight: a pause lasts until then. */
const tomorrow = (now: Date) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();

/**
 * The jobs a run takes. Named ones, unless outreach already looked at them and `again` was not
 * given; with none named, applications sent in the last days that outreach has not looked at, best
 * fit first. `skipped` are the named jobs left out because they were looked at already.
 */
export function chooseJobs(entries: QueueEntry[], f: OutreachFile, now: Date, named: string[], again = false): { jobs: QueueEntry[]; missing: string[]; skipped: number } {
  if (named.length) {
    const found = entries.filter((e) => named.includes(e.job.id));
    const jobs = found.filter((e) => again || !f.jobs[e.job.id]);
    return { jobs, missing: named.filter((id) => !found.some((e) => e.job.id === id)), skipped: found.length - jobs.length };
  }
  const since = now.getTime() - OUTREACH.appliedWithinDays * 86_400_000;
  const jobs = entries
    .filter((e) => e.status === "applied" && e.appliedAt && Date.parse(e.appliedAt) >= since && !f.jobs[e.job.id])
    .sort((a, b) => (b.fit?.score ?? 0) - (a.fit?.score ?? 0))
    .slice(0, OUTREACH.jobsPerRun);
  return { jobs, missing: [], skipped: 0 };
}

/** One person found for a job, as the record keeps them. */
export function personFrom(j: Judged, entry: QueueEntry, executive: boolean, at: string): Person {
  const c = j.card;
  return {
    id: personId(c.profileUrl),
    profileUrl: c.profileUrl,
    name: c.name,
    headline: c.headline,
    location: c.location,
    mutualLine: c.mutualLine,
    company: entry.job.company,
    role: entry.job.title,
    kind: j.kind,
    degree: c.degree,
    warm: { sharedSchool: c.sharedSchool, mutuals: c.mutuals },
    executive,
    why: whyOf(j),
    jobId: entry.job.id,
    status: "found",
    foundAt: at,
    sentAt: null,
    updatedAt: at,
  };
}

/** Runs outreach for the given jobs. Returns what each job came to, and why the run stopped early, if it did. */
export async function findPeople(profile: Profile, entries: QueueEntry[], deps: RunDeps): Promise<RunResult> {
  const now = deps.now ?? (() => new Date());
  const random = deps.random ?? Math.random;
  const log = deps.log ?? (() => {});
  const file = deps.file;
  const school = profile.education[0]?.school ?? null;
  const result: RunResult = { jobs: [], pages: 0, stopped: null };

  /** Loads one page inside the day's budget and at a person's pace, and stops the run at anything but results. */
  const load = async (url: string): Promise<PageRead> => {
    const at = now();
    const day = dayOfMail(at.getTime());
    mutateOutreach((f) => {
      const why = refusal(f, at);
      if (why) throw new Stop(why);
      if (f.pagesToday.date !== day) f.pagesToday = { date: day, count: 0 };
      f.pagesToday.count += 1;
    }, file);
    if (result.pages > 0) {
      const [lo, hi] = OUTREACH.pageGapMs;
      await deps.sleep(Math.round(lo + random() * (hi - lo)));
    }
    result.pages += 1;
    const read = await deps.browse.read(url);
    const state = pageState(read);
    if (state === "results") return read;
    if (state === "signed_out") throw new Stop("LinkedIn showed its sign-in page. Run outreach signin and sign in again in the tool's window.");
    const why = state === "check" ? "LinkedIn asked for a security check" : "LinkedIn said a limit was reached";
    mutateOutreach((f) => {
      f.pausedUntil = tomorrow(now());
      f.pausedWhy = why;
    }, file);
    throw new Stop(`${why}. Outreach is paused until tomorrow. If there is a check in the tool's window, it is yours to pass, or leave it.`);
  };

  /** The employer's LinkedIn id, from the record or looked up once (two pages, or one for a page the person named). Null when LinkedIn has no clear match. */
  const companyOf = async (company: string): Promise<string | null> => {
    const known = loadOutreach(file).companies[company];
    if (known === null) return null;
    if (known?.id) return known.id;
    const slug = known?.slug ?? companySlugFrom(await load(companySearchUrl(company)), company);
    const id = slug ? companyIdFrom(await load(companyPageUrl(slug))) : null;
    mutateOutreach((f) => {
      f.companies[company] = slug && id ? { id, slug } : null;
    }, file);
    if (slug && id) log(`  LinkedIn page: ${companyPageUrl(slug)}  (wrong one? outreach company "${company}" <the right page's name in its link>)`);
    return id;
  };

  /** The people on one job's search pages that the record does not hold yet, each once. */
  const cardsFor = async (companyId: string, known: Set<string>): Promise<Card[]> => {
    const cards = new Map<string, Card>();
    for (const s of searchesFor(companyId, school)) {
      const read = await load(s.url);
      for (const card of read.cards.map(parseCard)) if (card && !known.has(card.profileUrl)) cards.set(card.profileUrl, card);
      log(`  searched "${s.keywords}": ${read.cards.length} people`);
    }
    return [...cards.values()];
  };

  /** One job, start to finish. The people and the job's own entry go into the record together. */
  const oneJob = async (entry: QueueEntry): Promise<JobResult> => {
    const job: JobResult = { jobId: entry.job.id, company: entry.job.company, title: entry.job.title, kept: [], executives: 0, note: null };
    let people: Person[] = [];
    log(`${entry.job.company} | ${entry.job.title}`);
    const companyId = await companyOf(entry.job.company);
    if (!companyId) job.note = `LinkedIn had no company page that clearly matches "${entry.job.company}"`;
    else {
      const before = loadOutreach(file);
      const judged = await judge(entry, await cardsFor(companyId, new Set(before.people.map((p) => p.profileUrl))), deps.jev, deps.cacheFile);
      const atCompany = before.people.filter((p) => p.company === entry.job.company && p.status !== "skipped" && !p.executive).length;
      const { kept, executives } = pick(judged, OUTREACH.perCompany - atCompany);
      const at = now().toISOString();
      job.kept = kept.map((j) => personFrom(j, entry, false, at));
      job.executives = executives.length;
      people = [...job.kept, ...executives.map((j) => personFrom(j, entry, true, at))];
      if (!kept.length) job.note = atCompany >= OUTREACH.perCompany ? `already ${atCompany} people at ${entry.job.company} in the record` : "nobody on these pages was a clear fit";
    }
    mutateOutreach((f) => {
      const have = new Set(f.people.map((p) => p.id));
      f.people.push(...people.filter((p) => !have.has(p.id)));
      f.jobs[entry.job.id] = { at: now().toISOString(), found: job.kept.length, note: job.note };
    }, file);
    return job;
  };

  for (const entry of entries) {
    try {
      result.jobs.push(await oneJob(entry));
    } catch (err) {
      if (!(err instanceof Stop)) throw err;
      result.stopped = err.message;
      result.jobs.push({ jobId: entry.job.id, company: entry.job.company, title: entry.job.title, kept: [], executives: 0, note: "stopped before this job was finished" });
      break;
    }
  }
  return result;
}

/** The real pages: one tab of the tool's Chrome, loaded by address, read with the one fixed expression, never clicked. */
export function chromeBrowse(page: Page, sleep: (ms: number) => Promise<void>): Browse {
  return {
    async read(url: string): Promise<PageRead> {
      await page.navigate(url);
      const started = Date.now();
      let last: PageRead | null = null;
      while (Date.now() - started < OUTREACH.pageWaitMs) {
        await sleep(OUTREACH.pollMs);
        try {
          last = PageRead.parse(JSON.parse(await page.evaluate<string>(READ_EXPR)));
        } catch {
          continue; // mid-navigation
        }
        if (pageState(last) !== "results") return last;
        // Results are in, a company page has its employees link, or the page says it found nobody.
        const shown = last.cards.length > 0 || !!last.employeeSearch || last.companyLinks.length > 2 || /no results found/i.test(last.text);
        if (shown && Date.now() - started > OUTREACH.minLoadMs) return last;
      }
      if (last) return last;
      throw new Stop(`LinkedIn did not load ${new URL(url).pathname} within ${Math.round(OUTREACH.pageWaitMs / 1000)} seconds. Stopped so nothing is hammered.`);
    },
  };
}

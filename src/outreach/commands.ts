/**
 * What the `outreach` command says and records: the risk note the person confirms once, the wait
 * for them to sign in to LinkedIn in the tool's window, the list of people and drafts, the person's
 * own marks, a note written again, and the company page they name when the run found the wrong one.
 * The browser work itself is in run.ts. Nothing here sends anything.
 */
import { OUTREACH, PATHS } from "../config.js";
import { runWriter } from "../answers/resolve.js";
import { closeTab, listTargets, newTab, Page, sleep } from "../browser/cdp.js";
import { JevClient } from "../jev/client.js";
import { loadQueue, type QueueEntry } from "../jobs/queue.js";
import { loadProfile, type Profile } from "../profile/schema.js";
import { writeNotes } from "./draft.js";
import type { Card } from "./linkedin.js";
import { followUpsDue, loadOutreach, markPerson, mutateOutreach, personById, PersonStatus, type OutreachFile, type Person } from "./records.js";
import { chooseJobs, chromeBrowse, findPeople, refusal } from "./run.js";

export const RISK_NOTE = [
  "Before outreach runs, the risk, in plain words.",
  "",
  "LinkedIn's user agreement does not allow automated access, and the account at stake is your own.",
  "To keep that risk low the tool only loads search pages and reads them, in its own Chrome window,",
  `at a person's pace: ${OUTREACH.pagesPerDay} pages a day at most, ${Math.round(OUTREACH.pageGapMs[0] / 1000)} to ${Math.round(OUTREACH.pageGapMs[1] / 1000)} seconds apart. It never clicks Connect, Message`,
  "or anything else, never types on LinkedIn, and never reads your sign-in. It stops at the first",
  "security check or limit and leaves LinkedIn alone until the next day. Premium does not change",
  "how LinkedIn spots automation. Low is not zero: if LinkedIn objects, outreach stops for good",
  "until you say otherwise.",
  "",
  "You send every note yourself. Nothing is scheduled.",
].join("\n");

/** Records that the person read the risk note and wants outreach. */
export const acceptRisk = (now = new Date(), file: string = PATHS.outreach) =>
  mutateOutreach((f) => {
    f.riskAcknowledgedAt ??= now.toISOString();
  }, file);

/** Lifts a pause the person decided to lift. */
export const lift = (file: string = PATHS.outreach) =>
  mutateOutreach((f) => {
    f.pausedUntil = null;
    f.pausedWhy = null;
  }, file);

/** True when a tab's address is a LinkedIn page past the sign-in: the feed, or anything that is not a sign-in or a check. */
export function signedInAt(url: string): boolean {
  try {
    const u = new URL(url);
    return /(^|\.)linkedin\.com$/.test(u.hostname) && !OUTREACH.stopPaths.test(u.pathname) && u.pathname !== "/";
  } catch {
    return false;
  }
}

/** Waits for the person to sign in, by watching the tab's address and nothing else. True once they have. */
export async function waitForSignIn(targetId: string, limitMs: number = OUTREACH.signInWaitMs): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < limitMs) {
    await sleep(OUTREACH.signInPollMs);
    const t = ((await listTargets()) ?? []).find((x) => x.id === targetId);
    if (!t) return false;
    if (signedInAt(t.url)) return true;
  }
  return false;
}

/** The person's own correction: the company page that is the employer, by the name in its link. */
export function setCompanyPage(company: string, slug: string, file: string = PATHS.outreach): void {
  const clean = slug.replace(/^.*\/company\//, "").replace(/\/.*$/, "").trim();
  if (!/^[A-Za-z0-9\-_.%]+$/.test(clean)) throw new Error(`"${slug}" is not the name in a LinkedIn company link (linkedin.com/company/<name>/).`);
  mutateOutreach((f) => {
    f.companies[company] = { id: null, slug: clean };
    // Its jobs are looked at again on the next run.
    for (const [id, j] of Object.entries(f.jobs)) if (j.found === 0) delete f.jobs[id];
  }, file);
}

const cardOf = (p: Person): Card => ({ profileUrl: p.profileUrl, name: p.name, degree: p.degree, headline: p.headline, location: p.location, summary: p.summary, sharedSchool: p.warm.sharedSchool, mutuals: p.warm.mutuals, mutualLine: p.mutualLine });

/** Writes one person's notes again, the same way a run does, and keeps them only if they pass the same checks. */
export async function redraft(id: string, profile: Profile, entries: QueueEntry[], write: (prompt: string, system: string) => Promise<string>, file: string = PATHS.outreach): Promise<Person> {
  const p = personById(loadOutreach(file), id);
  const entry = entries.find((e) => e.job.id === p.jobId);
  if (!entry) throw new Error(`the job this person was found for (${p.jobId}) is no longer in the queue.`);
  const [w] = await writeNotes(profile, entry, [{ id: p.id, card: cardOf(p), kind: p.kind, why: p.why }], entry.status === "applied", write);
  return mutateOutreach((f) => {
    const now = personById(f, p.id);
    now.drafts = w?.drafts ?? null;
    now.draftNote = w?.note ?? null;
    now.updatedAt = new Date().toISOString();
    return { ...now };
  }, file);
}

const indent = (text: string, pad: string) => text.split("\n").map((l) => `${pad}${l}`).join("\n");

/** The people and drafts, by job, for a person to read and send from. */
export function formatList(f: OutreachFile, entries: QueueEntry[], o: { jobId?: string; now?: Date } = {}): string {
  const byJob = new Map<string, Person[]>();
  for (const p of f.people) {
    if (o.jobId && p.jobId !== o.jobId) continue;
    byJob.set(p.jobId, [...(byJob.get(p.jobId) ?? []), p]);
  }
  if (!byJob.size) return o.jobId ? `Nobody found yet for ${o.jobId}.` : "Nobody found yet. Run: outreach find";
  const out: string[] = [];
  for (const [jobId, people] of byJob) {
    const e = entries.find((x) => x.job.id === jobId);
    out.push(`== ${e ? `${e.job.company} | ${e.job.title}` : people[0]?.company ?? ""} [${jobId}]`);
    for (const p of people.filter((x) => !x.executive)) {
      out.push(`  ${p.id}  ${p.name}, ${p.headline}`, `      why: ${p.why}`, `      status: ${p.status}${p.sentAt ? ` (sent ${p.sentAt.slice(0, 10)})` : ""}`, `      profile: ${p.profileUrl}`);
      if (p.drafts) {
        if (p.drafts.connect) out.push(`      connection note (${p.drafts.connect.length} characters):`, indent(p.drafts.connect, "        "));
        out.push("      message after they accept:", indent(p.drafts.message, "        "));
        if (p.drafts.inmail) out.push(`      InMail, subject "${p.drafts.inmail.subject}":`, indent(p.drafts.inmail.body, "        "));
      } else if (p.draftNote) out.push(`      ${p.draftNote}`);
    }
    const execs = people.filter((x) => x.executive);
    if (execs.length) {
      out.push("  Executives, left out by default (outreach redraft <id> writes a note for one):");
      for (const p of execs) out.push(`    ${p.id}  ${p.name}, ${p.headline}`);
    }
    out.push("");
  }
  const due = followUpsDue(f, OUTREACH.followUpDays, o.now);
  if (due.length) out.push(`${due.length} note(s) sent over ${OUTREACH.followUpDays} days ago with no answer. One follow-up each is fair, then let it go: ${due.map((p) => p.name).join(", ")}`, "");
  out.push("Send each note yourself from their profile. Then: outreach mark <id> sent");
  return out.join("\n");
}

export type OutreachOptions = { acceptRisk?: boolean; again?: boolean; job?: string; json?: boolean };
/** What the command needs from the CLI: the run lock with the tool's Chrome, and somewhere to print. */
export type OutreachContext = { inRun: <T>(command: string, work: () => Promise<T>) => Promise<T>; say: (line: string) => void; progress: (line: string) => void };

const write = (prompt: string, system: string) => runWriter(prompt, system, { purpose: "outreach", jobId: "outreach" });

export const OUTREACH_ACTIONS = "signin | find [ids...] | list | mark <id> <status> | redraft <id> | company <employer> <page name> | resume";

/** The `outreach` command, one action at a time. */
export async function outreachCommand(action: string, args: string[], o: OutreachOptions, ctx: OutreachContext): Promise<void> {
  const { say } = ctx;
  switch (action) {
    case "signin": {
      if (!loadOutreach().riskAcknowledgedAt && !o.acceptRisk) return say(`${RISK_NOTE}\n\nIf you want it: outreach signin --accept-risk`);
      if (o.acceptRisk) acceptRisk();
      return ctx.inRun("outreach signin", async () => {
        const tab = await newTab(`${OUTREACH.origin}/login`);
        say(`Sign in to LinkedIn in the tool's Chrome window. Nothing is typed or read there by the tool. Waiting up to ${Math.round(OUTREACH.signInWaitMs / 60_000)} minutes.`);
        say((await waitForSignIn(tab.id)) ? "Signed in. The window keeps the session. Next: outreach find" : "Not signed in yet. Run outreach signin again when you are ready.");
      });
    }
    case "find": {
      const f = loadOutreach();
      const why = refusal(f, new Date());
      if (why) return say(`Outreach did not start: ${why}`);
      const { jobs, missing, skipped } = chooseJobs(loadQueue().entries, f, new Date(), args, o.again);
      for (const id of missing) say(`${id}  not in the queue`);
      if (skipped) say("Outreach already looked at some of those. Add --again to look again.");
      if (!jobs.length) return say(args.length ? "No job to look at." : `No application from the last ${OUTREACH.appliedWithinDays} days is waiting for outreach. Name a job: outreach find <id>`);
      return ctx.inRun("outreach find", async () => {
        const target = await newTab("about:blank");
        const page = await Page.attach(target);
        try {
          const r = await findPeople(loadProfile(), jobs, { browse: chromeBrowse(page, sleep), jev: new JevClient(), write, sleep, log: ctx.progress });
          for (const j of r.jobs) say(`${j.company} | ${j.title} [${j.jobId}]: ${j.kept.length} people${j.executives ? `, ${j.executives} executive(s) set apart` : ""}${j.note ? `. ${j.note}` : ""}`);
          say(`${r.pages} LinkedIn page(s) loaded.${r.stopped ? ` Stopped: ${r.stopped}` : ""}\nThe people and drafts: outreach list`);
        } finally {
          page.close();
          await closeTab(target.id).catch(() => {});
        }
      });
    }
    case "list": {
      const f = loadOutreach();
      return say(o.json ? JSON.stringify(o.job ? f.people.filter((p) => p.jobId === o.job) : f.people, null, 2) : formatList(f, loadQueue().entries, o.job ? { jobId: o.job } : {}));
    }
    case "mark": {
      const [id, status] = args;
      const s = PersonStatus.safeParse(status);
      if (!id || !s.success) return say(`outreach mark <id> <status>, where status is one of: ${PersonStatus.options.join(", ")}`);
      const p = markPerson(id, s.data);
      return say(`${p.name} is now ${p.status}`);
    }
    case "redraft": {
      const [id] = args;
      if (!id) return say("outreach redraft <id>");
      const p = await redraft(id, loadProfile(), loadQueue().entries, write);
      return say(p.drafts ? `New notes for ${p.name}. outreach list --job ${p.jobId} shows them.` : `${p.name}: ${p.draftNote}`);
    }
    case "company": {
      const [company, slug] = args;
      if (!company || !slug) return say("outreach company <employer as the queue names it> <the name in its LinkedIn link, linkedin.com/company/<name>/>");
      setCompanyPage(company, slug);
      return say(`${company} is linkedin.com/company/${slug}/ from now on.`);
    }
    case "resume":
      lift();
      return say("The pause is lifted. Outreach may load LinkedIn again on the next find.");
    default:
      return say(`The actions are: ${OUTREACH_ACTIONS}`);
  }
}

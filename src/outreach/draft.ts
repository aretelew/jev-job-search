/**
 * The notes to the people outreach found: a connection note, a message for after they accept, and
 * an InMail for someone outside the network. The writer writes them, with no tools, from the
 * profile, the voice rules, the job and the person's own card. Every note is then held to the same
 * truth check as a tailored cover letter: a number or a name that neither the profile, the posting
 * nor the card says is a claim the candidate did not make, and the note is asked for again once and
 * dropped if it still makes it. Nothing here sends anything.
 */
import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import { OUTREACH, PATHS } from "../config.js";
import { claimsIn, tellsIn } from "../documents/tailor.js";
import type { QueueEntry } from "../jobs/queue.js";
import type { Profile } from "../profile/schema.js";
import type { Card } from "./linkedin.js";
import type { Drafts, Kind } from "./records.js";

export type ToWrite = { id: string; card: Card; kind: Kind; why: string };

const SYSTEM = [
  "You write short LinkedIn notes from one candidate to people at a company where the candidate wants an internship. You are given the candidate's facts and voice rules, the job, and for each person what their LinkedIn card shows and why they were chosen.",
  "Reply with one JSON object and nothing else: {\"drafts\": [{\"id\": string, \"connect\": string, \"message\": string, \"inmail\": {\"subject\": string, \"body\": string} | null}]}, one entry per person, with the person's own id.",
  "",
  "What each note is.",
  `- connect: the note sent with a connection request, under ${OUTREACH.noteChars} characters. Empty for someone already connected (degree 1).`,
  `- message: for after they accept, so they have already read the connection note. Open with thanks for connecting, never with the note's own sentences: do not say again that the candidate applied or repeat the thing the note named. Add one new concrete detail from the facts and the ask. Two to four short sentences, under ${OUTREACH.messageChars} characters. For someone already connected (degree 1) it is the first note, so it says what the connection note would have.`,
  "- inmail: only for someone outside the network (degree 2 or 3): a subject under 60 characters and a body like the message. Null for degree 1.",
  "",
  "How they read.",
  "- Hi and the person's first name, then the point. Say the role the candidate applied for when applied is true (\"I just applied for\"), or is interested in when it is false.",
  "- One concrete thing the candidate built or did that matches this person's work or the posting, in plain words. Not a list of everything.",
  "- A small, easy ask that fits who they are: a recruiter can keep the application in mind or say what helps; an engineer or an alum can share what the work is like or spare fifteen minutes. Never ask for a referral in the first note.",
  "- Name the shared school or the mutual connection when the card shows it, and nothing else about how the two are linked. A mutual connection is someone you are both connected to: say that, never that you both know them. Never invent a shared class, event, friend or interest.",
  "- Follow the voice rules exactly: first person, short sentences, the way a person types to another person. No stock phrases, no flattery, no dashes as punctuation, no semicolons, no exclamation marks.",
  "",
  "Truth comes first.",
  "- Every fact about the candidate comes from the facts given. Never add a number, a tool, a company, a date or an outcome.",
  "- A fact about the person comes only from their card. Do not guess their team or their projects beyond it.",
  "- Never mention the GPA, citizenship, work authorization, visas or sponsorship.",
].join("\n");

const Reply = z.object({
  drafts: z.array(z.object({ id: z.string(), connect: z.string().default(""), message: z.string(), inmail: z.object({ subject: z.string(), body: z.string() }).nullable().default(null) })).default([]),
});

/** What the writer is told about the candidate: the voice rules and the facts. Contact details and anything about the right to work stay out. */
export function candidateFor(profile: Profile): Record<string, unknown> {
  const voice = existsSync(PATHS.voice) ? readFileSync(PATHS.voice, "utf8") : "";
  return {
    voice_rules: voice,
    candidate: { name: profile.name, summary: profile.summary, facts: profile.facts, education: profile.education.map((e) => ({ school: e.school, degree: e.degree, field: e.field, gradYear: e.gradYear, gradMonth: e.gradMonth })), experience: profile.experience, projects: profile.projects, skills: profile.skills },
  };
}

const schoolOf = (profile: Profile) => profile.education[0]?.school ?? "";

/** The text a note's claims may come from besides the profile: the posting and this person's own card. */
export const otherText = (entry: QueueEntry, card: Card, profile: Profile) =>
  [entry.job.company, entry.job.title, entry.job.description ?? "", card.name, card.headline, card.location, card.summary, card.mutualLine, schoolOf(profile)].join(" ");

const sentencesOf = (text: string) =>
  text
    .split(/(?<=[.?])\s+/)
    .map((x) => x.toLowerCase().replace(/^(?:hi|hello|hey)\s+[^,]+,\s*/, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim())
    .filter((x) => x.split(" ").length >= 5);

/** True when the second note says again a sentence the first one said, or opens the same way. */
export function repeats(first: string, second: string): boolean {
  const a = sentencesOf(first);
  const b = sentencesOf(second);
  if (!a.length || !b.length) return false;
  if (a[0] === b[0]) return true;
  return b.some((x) => a.includes(x));
}

/** What is wrong with one person's drafts: too long, a claim the facts do not hold, a phrase that reads as machine-made, a subject that is off limits. */
export function problemsOf(d: Drafts, card: Card, entry: QueueEntry, profile: Profile): string[] {
  const out: string[] = [];
  if (card.degree > 1 && !d.connect.trim()) out.push("the connection note is empty");
  if (d.connect.length > OUTREACH.noteChars) out.push(`the connection note is ${d.connect.length} characters, over ${OUTREACH.noteChars}`);
  if (d.message.length > OUTREACH.messageChars) out.push(`the message is ${d.message.length} characters, over ${OUTREACH.messageChars}`);
  if (d.inmail && d.inmail.body.length > OUTREACH.messageChars) out.push(`the InMail is ${d.inmail.body.length} characters, over ${OUTREACH.messageChars}`);
  if (card.degree > 1 && repeats(d.connect, d.message)) out.push("the message after they accept repeats the connection note: they have read it, so thank them and add something new");
  const all = [d.connect, d.message, d.inmail?.subject ?? "", d.inmail?.body ?? ""].join("\n");
  const claims = claimsIn(all, profile, otherText(entry, card, profile));
  if (claims.length) out.push(`claims the facts do not hold: ${claims.slice(0, 6).join(", ")}`);
  for (const t of tellsIn(all)) out.push(t);
  if (OUTREACH.offLimits.test(all)) out.push("mentions the GPA, citizenship, work authorization or sponsorship");
  return out;
}

export type Written = { id: string; drafts: Drafts | null; note: string | null };

/**
 * Writes the notes for a job's people in one writer call, checks each, asks once more for the ones
 * that failed with what was wrong, and gives up on a note that still fails.
 */
export async function writeNotes(profile: Profile, entry: QueueEntry, people: ToWrite[], applied: boolean, write: (prompt: string, system: string) => Promise<string>): Promise<Written[]> {
  if (!people.length) return [];
  const system = `${SYSTEM}\n\nThe candidate:\n${JSON.stringify(candidateFor(profile), null, 1)}`;
  const job = { company: entry.job.company, title: entry.job.title, applied, posting: (entry.job.description ?? "").slice(0, 2500) };
  const shown = (p: ToWrite) => ({ id: p.id, name: p.card.name, degree: p.card.degree, headline: p.card.headline, location: p.card.location, card_summary: p.card.summary, mutual_connections: p.card.mutualLine, shared_school: p.card.sharedSchool, chosen_because: p.why });
  const ask = async (who: ToWrite[], fix: Record<string, string[]> | null, before: Record<string, Drafts> | null) => {
    const prompt = JSON.stringify({ job, people: who.map(shown), ...(fix ? { rewrite_these_fixing: fix, previous_drafts: before } : {}) }, null, 1);
    const text = await write(prompt, system);
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("the writer did not return JSON");
    return Reply.parse(JSON.parse(text.slice(start, end + 1))).drafts;
  };
  const byId = new Map(people.map((p) => [p.id, p]));
  /** One reply's drafts, as kept: an InMail only for someone outside the network, and what is wrong with them. */
  const take = (d: z.infer<typeof Reply>["drafts"][number]) => {
    const p = byId.get(d.id);
    if (!p) return null;
    const drafts: Drafts = { connect: d.connect.trim(), message: d.message.trim(), inmail: p.card.degree > 1 ? d.inmail : null };
    return { drafts, problems: problemsOf(drafts, p.card, entry, profile) };
  };
  const result = new Map<string, Written>();
  const failed: Record<string, string[]> = {};
  const firstDrafts: Record<string, Drafts> = {};
  for (const d of await ask(people, null, null)) {
    const t = take(d);
    if (!t) continue;
    if (!t.problems.length) result.set(d.id, { id: d.id, drafts: t.drafts, note: null });
    else {
      failed[d.id] = t.problems;
      firstDrafts[d.id] = t.drafts;
    }
  }
  const retry = people.filter((p) => !result.has(p.id));
  if (retry.length) {
    for (const d of await ask(retry, Object.fromEntries(retry.map((p) => [p.id, failed[p.id] ?? ["no draft was written"]])), firstDrafts)) {
      const t = take(d);
      if (!t || result.has(d.id)) continue;
      result.set(d.id, t.problems.length ? { id: d.id, drafts: null, note: `no draft: ${t.problems.slice(0, 3).join("; ")}` } : { id: d.id, drafts: t.drafts, note: null });
    }
  }
  return people.map((p) => result.get(p.id) ?? { id: p.id, drafts: null, note: "no draft: the writer left this person out" });
}

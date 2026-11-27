/**
 * The outreach record, data/outreach.json: the people found on LinkedIn for each job, why each one,
 * and what the person did about them. It holds the names and links of people who never used the
 * tool, so it is git-ignored, and of it only a card's words go to JEV. Every change is a fresh read,
 * the change, and a whole-file write under the store lock, and the same change rewrites the sheet
 * of it, applications/people.csv, so the two always agree.
 */
import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import { PATHS } from "../config.js";
import { toCsv } from "../log/csv.js";
import { withStore, writeAtomic } from "../util/store.js";

export const KINDS = ["campus_recruiter", "recruiter", "team_manager", "team_engineer", "same_company", "intern_peer", "not_relevant"] as const;
// "alum" was a kind in the first records; a shared school is now a bonus on any kind, and those people were engineers.
export const Kind = z.preprocess((v) => (v === "alum" ? "team_engineer" : v), z.enum(KINDS));
export type Kind = (typeof KINDS)[number];

export const PersonStatus = z.enum(["found", "sent", "accepted", "replied", "no_reply", "skipped"]);
export type PersonStatus = z.infer<typeof PersonStatus>;

export const Person = z.object({
  /** A hash of the profile link, so one person is one record however many jobs they match. */
  id: z.string(),
  profileUrl: z.string(),
  name: z.string(),
  headline: z.string(),
  location: z.string().default(""),
  /** The card's own words about mutual connections ("A is a mutual connection"): who could introduce you. */
  mutualLine: z.string().default(""),
  company: z.string(),
  /** The job they were found for, by its title. */
  role: z.string().default(""),
  kind: Kind,
  /** 1, 2 or 3, where 3 stands for third and beyond. */
  degree: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  warm: z.object({ sharedSchool: z.boolean(), mutuals: z.number().int().min(0) }),
  executive: z.boolean().default(false),
  /** One line a person can read, built by code from the kind and the card. */
  why: z.string(),
  jobId: z.string(),
  status: PersonStatus,
  foundAt: z.string(),
  sentAt: z.string().nullable().default(null),
  updatedAt: z.string(),
});
export type Person = z.infer<typeof Person>;

export const OutreachFile = z.object({
  version: z.literal(1).default(1),
  people: z.array(Person).default([]),
  /**
   * Employer name, as the queue has it, to LinkedIn's company id and page, looked up once. Null when
   * LinkedIn had no clear match. A page with no id yet is one the person named
   * (`outreach company`): its id is read from that page on the next run.
   */
  companies: z.record(z.string(), z.object({ id: z.string().nullable(), slug: z.string() }).nullable()).default({}),
  /** Jobs looked at, so a job is not searched again unless asked, with what came of it. */
  jobs: z.record(z.string(), z.object({ at: z.string(), found: z.number().int(), note: z.string().nullable().default(null) })).default({}),
  /** The person confirmed the risk note in `outreach signin`. `find` does nothing without it. */
  riskAcknowledgedAt: z.string().nullable().default(null),
  /** Set when LinkedIn asked for a check or said a limit was reached. Nothing is loaded there before it. */
  pausedUntil: z.string().nullable().default(null),
  pausedWhy: z.string().nullable().default(null),
  /** Pages loaded on LinkedIn on one local day. */
  pagesToday: z.object({ date: z.string(), count: z.number().int().min(0) }).default({ date: "", count: 0 }),
});
export type OutreachFile = z.infer<typeof OutreachFile>;

export function loadOutreach(file: string = PATHS.outreach): OutreachFile {
  if (!existsSync(file)) return OutreachFile.parse({});
  // A file that does not parse is not replaced with an empty one: it may hold notes the person sent.
  return OutreachFile.parse(JSON.parse(readFileSync(file, "utf8")));
}

export const PEOPLE_COLUMNS = ["company", "role", "name", "headline", "why", "shared_school", "mutual_connections", "degree", "location", "status", "sent_on", "profile", "found_on", "job_id", "person_id"] as const;

/** The people as rows of the sheet: grouped by job, executives after the rest of their job, in the order they were found. */
export function peopleRows(f: OutreachFile): string[][] {
  const people = [...f.people].sort((a, b) => a.jobId.localeCompare(b.jobId) || Number(a.executive) - Number(b.executive));
  return [
    [...PEOPLE_COLUMNS],
    ...people.map((p) => [p.company, p.role, p.name, p.headline, p.executive ? `executive: ${p.why}` : p.why, p.warm.sharedSchool ? "yes" : "", p.mutualLine || (p.warm.mutuals ? String(p.warm.mutuals) : ""), ["", "1st", "2nd", "3rd+"][p.degree] ?? "", p.location, p.status, p.sentAt?.slice(0, 10) ?? "", p.profileUrl, p.foundAt.slice(0, 10), p.jobId, p.id]),
  ];
}

/**
 * Changes the record: a fresh read, the change, a whole-file write, and the sheet written again
 * from it, all under the store lock. `sheet` is applications/people.csv for the real record and
 * nothing for any other file, so a test never touches the person's own sheet.
 */
export const mutateOutreach = <T>(fn: (f: OutreachFile) => T, file: string = PATHS.outreach, sheet: string | null = file === PATHS.outreach ? PATHS.people : null): T =>
  withStore(() => {
    const f = loadOutreach(file);
    const out = fn(f);
    writeAtomic(file, JSON.stringify(f, null, 2));
    if (sheet) writeAtomic(sheet, toCsv(peopleRows(f)));
    return out;
  });

/** The person's own record of what they did: sent a message, heard back, or let it go. Returns the person, or throws when there is no such id. */
export function markPerson(id: string, status: PersonStatus, now = new Date(), file: string = PATHS.outreach): Person {
  return mutateOutreach((f) => {
    const p = personById(f, id);
    p.status = status;
    if (status === "sent" && !p.sentAt) p.sentAt = now.toISOString();
    p.updatedAt = now.toISOString();
    return { ...p };
  }, file);
}

/** One person by id, or by the start of one as `list` prints it. A start that fits two people is refused. */
export function personById(f: OutreachFile, id: string): Person {
  const exact = f.people.find((x) => x.id === id);
  if (exact) return exact;
  const starts = f.people.filter((x) => x.id.startsWith(id));
  if (starts.length === 1) return starts[0] as Person;
  throw new Error(starts.length ? `${id} fits ${starts.length} people. Give more of the id.` : `no person with id ${id} in the outreach record. outreach list shows the ids.`);
}

/** People who were sent a message this long ago and have not answered: one follow-up is due. */
export function followUpsDue(f: OutreachFile, days: number, now = new Date()): Person[] {
  const before = now.getTime() - days * 86_400_000;
  return f.people.filter((p) => p.status === "sent" && p.sentAt && Date.parse(p.sentAt) < before);
}

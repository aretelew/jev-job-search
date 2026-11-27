/**
 * The outreach record, data/outreach.json: the people found on LinkedIn for each job, why each one,
 * the drafts, and what the person did with them. It holds the names and links of people who never
 * used the tool, so it is git-ignored and goes nowhere but JEV and the writer. Every change is a
 * fresh read, the change, and a whole-file write under the store lock.
 */
import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import { PATHS } from "../config.js";
import { withStore, writeAtomic } from "../util/store.js";

export const Kind = z.enum(["campus_recruiter", "recruiter", "team_manager", "team_engineer", "same_company", "alum", "intern_peer", "not_relevant"]);
export type Kind = z.infer<typeof Kind>;

export const PersonStatus = z.enum(["found", "sent", "accepted", "replied", "no_reply", "skipped"]);
export type PersonStatus = z.infer<typeof PersonStatus>;

export const Drafts = z.object({
  /** The note sent with a connection request. Under LinkedIn's limit. */
  connect: z.string(),
  /** The longer note for after they accept, or for someone already connected. */
  message: z.string(),
  /** For someone outside the network: an InMail's subject and body. The person spends a credit on it only by choice. */
  inmail: z.object({ subject: z.string(), body: z.string() }).nullable().default(null),
});
export type Drafts = z.infer<typeof Drafts>;

export const Person = z.object({
  /** A hash of the profile link, so one person is one record however many jobs they match. */
  id: z.string(),
  profileUrl: z.string(),
  name: z.string(),
  headline: z.string(),
  /** The rest of what the card showed, kept so a note can be written again from the same words. */
  location: z.string().default(""),
  summary: z.string().default(""),
  mutualLine: z.string().default(""),
  company: z.string(),
  kind: Kind,
  /** 1, 2 or 3, where 3 stands for third and beyond. */
  degree: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  warm: z.object({ sharedSchool: z.boolean(), mutuals: z.number().int().min(0) }),
  executive: z.boolean().default(false),
  /** One line a person can read, built by code from the kind and the card. */
  why: z.string(),
  jobId: z.string(),
  drafts: Drafts.nullable(),
  /** Why there is no draft, when there is none. */
  draftNote: z.string().nullable().default(null),
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

export const mutateOutreach = <T>(fn: (f: OutreachFile) => T, file: string = PATHS.outreach): T =>
  withStore(() => {
    const f = loadOutreach(file);
    const out = fn(f);
    writeAtomic(file, JSON.stringify(f, null, 2));
    return out;
  });

/** The person's own record of what they did with a note. Returns the person, or throws when there is no such id. */
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

/** People who were sent a note this long ago and have not answered: one follow-up is due. */
export function followUpsDue(f: OutreachFile, days: number, now = new Date()): Person[] {
  const before = now.getTime() - days * 86_400_000;
  return f.people.filter((p) => p.status === "sent" && p.sentAt && Date.parse(p.sentAt) < before);
}

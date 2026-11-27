/**
 * Workable public job widget API. No auth. The board listing is whole and carries no description;
 * one posting's own endpoint carries it, so a description is read only for a job that gets that far.
 */
import { z } from "zod";
import { getJson } from "../../util/http.js";
import { htmlToText } from "../../util/text.js";
import { canonicalUrl, jobId, type Job } from "../../jobs/normalize.js";

const Place = z.object({ city: z.string().nullish(), region: z.string().nullish(), country: z.string().nullish(), hidden: z.boolean().nullish() });
const WorkableJob = z.object({
  title: z.string(),
  shortcode: z.string(),
  department: z.string().nullish(),
  published_on: z.string().nullish(),
  telecommuting: z.boolean().nullish(),
  locations: z.array(Place).nullish(),
});
const WorkableBoard = z.object({ jobs: z.array(z.unknown()) });
const WorkablePosting = z.object({ description: z.string().nullish(), requirements: z.string().nullish(), benefits: z.string().nullish() });

/** Paths on apply.workable.com that are Workable's own, not an account's board. */
const NOT_A_BOARD = /^(j|api)$/i;

/** The account a Workable link belongs to: apply.workable.com/coldquanta/j/EB77DE8198 names "coldquanta". */
export function workableSlug(url: string): string | null {
  const slug = /^https:\/\/apply\.workable\.com\/([^/?#]+)/i.exec(url)?.[1];
  return slug && !NOT_A_BOARD.test(slug) ? decodeURIComponent(slug) : null;
}

/** The posting's short code, which names it on every link Workable gives it. */
export function workableJobId(url: string): string | null {
  return /^https:\/\/apply\.workable\.com\/(?:[^/?#]+\/)?j\/([A-Z0-9]{6,})/i.exec(url)?.[1]?.toUpperCase() ?? null;
}

export async function fetchWorkableBoard(slug: string, companyFallback: string): Promise<Job[]> {
  return workableJobs(await getJson(`https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(slug)}`, { cacheMs: 20 * 60_000 }), slug, companyFallback);
}

/** What Workable says about a board, as jobs. A posting that does not parse is left out. */
export function workableJobs(raw: unknown, slug: string, company: string): Job[] {
  const board = WorkableBoard.safeParse(raw);
  if (!board.success) return [];
  return board.data.jobs.flatMap((item): Job[] => {
    const p = WorkableJob.safeParse(item);
    if (!p.success) return [];
    const j = p.data;
    // The widget's own link leaves the account out (apply.workable.com/j/CODE); the lists put it in, and so does this.
    const url = canonicalUrl(`https://apply.workable.com/${encodeURIComponent(slug)}/j/${j.shortcode}`);
    const places = (j.locations ?? []).filter((l) => !l.hidden).map((l) => [l.city, l.region, l.country].filter(Boolean).join(", "));
    return [{
      id: jobId(url),
      source: `workable:${slug}`,
      company,
      title: j.title.trim(),
      url,
      ats: "workable",
      locations: [...new Set([...places, j.telecommuting ? "Remote" : ""].filter(Boolean))],
      postedAt: j.published_on ? j.published_on.slice(0, 10) : null,
      terms: [],
      sponsorship: "unknown",
      degrees: [],
      category: j.department || null,
      description: "",
      descriptionSource: "none",
    }];
  });
}

/** One posting's description, requirements and benefits, as plain text. */
export function workableDescription(raw: unknown): string | null {
  const p = WorkablePosting.safeParse(raw);
  if (!p.success) return null;
  const parts = [["", p.data.description], ["Requirements", p.data.requirements], ["Benefits", p.data.benefits]]
    .map(([title, html]) => (html ? [title, htmlToText(html)].filter(Boolean).join("\n") : ""))
    .filter(Boolean);
  return parts.length ? parts.join("\n\n") : null;
}

export async function fetchWorkableJob(slug: string, id: string): Promise<string | null> {
  return workableDescription(await getJson(`https://apply.workable.com/api/v2/accounts/${encodeURIComponent(slug)}/jobs/${encodeURIComponent(id)}`, { cacheMs: 6 * 60 * 60_000 }));
}

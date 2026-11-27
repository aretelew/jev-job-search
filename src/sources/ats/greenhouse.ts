/** Greenhouse public job board API. No auth. */
import { z } from "zod";
import { getJson } from "../../util/http.js";
import { htmlToText } from "../../util/text.js";
import { canonicalUrl, greenhouseEmbedUrl, jobId, type Job } from "../../jobs/normalize.js";

const GhJob = z.object({
  id: z.number(),
  title: z.string(),
  absolute_url: z.string(),
  location: z.object({ name: z.string() }).optional(),
  offices: z.array(z.object({ name: z.string().nullable(), location: z.string().nullable() })).optional(),
  first_published: z.string().optional(),
  updated_at: z.string().optional(),
  content: z.string().optional(),
  company_name: z.string().optional(),
});
const GhBoard = z.object({ jobs: z.array(z.unknown()) });

export function greenhouseSlug(url: string): string | null {
  const m = /greenhouse\.io\/(?:embed\/job_board\?for=)?([a-z0-9_-]+)/i.exec(url);
  if (m && m[1] !== "embed" && m[1] !== "v1") return m[1] as string;
  const forParam = /[?&]for=([a-z0-9_-]+)/i.exec(url);
  return forParam ? (forParam[1] as string) : null;
}

export function greenhouseJobId(url: string): string | null {
  const m = /\/jobs\/(\d+)/.exec(url) ?? /[?&]gh_jid=(\d+)/.exec(url);
  return m ? (m[1] as string) : null;
}

/** Board names worth trying for an employer: its name run together, hyphenated, then its first word. */
export function slugGuesses(company: string): string[] {
  const words = company
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(inc|ltd|llc|corp|corporation|co|company|limited)\b\.?/g, " ")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return [...new Set([words.join(""), words.join("-"), words[0] ?? ""])].filter(Boolean);
}

const GhPosting = z.object({ id: z.number() });

/**
 * The board that holds a posting linked only by its id (a careers page with `?gh_jid=`). Each
 * guessed board is asked for that id, and a posting id belongs to one board only, so a board
 * that returns it is the right one. Null when none does.
 */
export async function findGreenhouseBoard(company: string, id: string, get: (url: string) => Promise<unknown> = getJson): Promise<string | null> {
  for (const slug of slugGuesses(company)) {
    try {
      const posting = GhPosting.parse(await get(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs/${id}`));
      if (String(posting.id) === id) return slug;
    } catch {
      /* not this board */
    }
  }
  return null;
}

/**
 * The board's own form for a job linked through the company's careers page (`?gh_jid=`), which
 * shows the posting without the form. The board is the one in the job's source when it was found
 * by polling the board, else the one Greenhouse confirms holds the posting. Null when neither.
 */
export async function greenhouseFormFor(job: Pick<Job, "url" | "ats" | "source" | "company">, get: (url: string) => Promise<unknown> = getJson): Promise<string | null> {
  const id = job.ats === "greenhouse" ? /[?&]gh_jid=(\d+)/.exec(job.url)?.[1] : undefined;
  if (!id) return null;
  const slug = /greenhouse:([a-z0-9_-]+)/i.exec(job.source)?.[1] ?? (await findGreenhouseBoard(job.company, id, get));
  return slug ? greenhouseEmbedUrl(slug, id) : null;
}

export async function fetchGreenhouseBoard(slug: string, companyFallback: string): Promise<Job[]> {
  const raw = await getJson(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs?content=true`, {
    cacheMs: 20 * 60_000,
  });
  const board = GhBoard.parse(raw);
  const out: Job[] = [];
  for (const item of board.jobs) {
    const p = GhJob.safeParse(item);
    if (!p.success) continue;
    const j = p.data;
    const url = canonicalUrl(j.absolute_url);
    const locations = [
      ...(j.location?.name ? [j.location.name] : []),
      ...(j.offices ?? []).map((o) => o.location ?? o.name ?? "").filter(Boolean),
    ];
    out.push({
      id: jobId(url),
      source: `greenhouse:${slug}`,
      company: j.company_name ?? companyFallback,
      title: j.title.trim(),
      url,
      ats: "greenhouse",
      locations: [...new Set(locations)],
      postedAt: (j.first_published ?? j.updated_at ?? "").slice(0, 10) || null,
      terms: [],
      sponsorship: "unknown",
      degrees: [],
      category: null,
      description: j.content ? htmlToText(j.content) : "",
      descriptionSource: j.content ? "api" : "none",
    });
  }
  return out;
}

export async function fetchGreenhouseJob(slug: string, id: string): Promise<string | null> {
  try {
    const raw = await getJson(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs/${id}`, {
      cacheMs: 6 * 60 * 60_000,
    });
    const j = GhJob.safeParse(raw);
    return j.success && j.data.content ? htmlToText(j.data.content) : null;
  } catch {
    return null;
  }
}

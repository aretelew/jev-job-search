/** Gem public job board API. No auth. The board listing carries every posting's full description. */
import { z } from "zod";
import { getJson } from "../../util/http.js";
import { canonicalUrl, jobId, type Job } from "../../jobs/normalize.js";

const Place = z.object({ name: z.string().nullish() }).nullish();
const GemPost = z.object({
  id: z.string(),
  title: z.string(),
  absolute_url: z.string(),
  content_plain: z.string().nullish(),
  employment_type: z.string().nullish(),
  first_published_at: z.string().nullish(),
  location: Place,
  location_type: z.string().nullish(),
  offices: z.array(z.object({ location: Place })).nullish(),
  departments: z.array(z.object({ name: z.string() })).nullish(),
});
const GemBoard = z.array(z.unknown());

export function gemSlug(url: string): string | null {
  const m = /^https:\/\/jobs\.gem\.com\/([^/?#]+)/i.exec(url);
  return m ? decodeURIComponent(m[1] as string) : null;
}

export function gemJobId(url: string): string | null {
  return /^https:\/\/jobs\.gem\.com\/[^/?#]+\/([^/?#]+)/i.exec(url)?.[1] ?? null;
}

export async function fetchGemBoard(slug: string, companyFallback: string): Promise<Job[]> {
  return gemJobs(await getJson(`https://api.gem.com/job_board/v0/${encodeURIComponent(slug)}/job_posts/`, { cacheMs: 20 * 60_000 }), slug, companyFallback);
}

/** What Gem says about a board, as jobs. A posting that does not parse is left out. */
export function gemJobs(raw: unknown, slug: string, company: string): Job[] {
  const board = GemBoard.safeParse(raw);
  if (!board.success) return [];
  return board.data.flatMap((item): Job[] => {
    const p = GemPost.safeParse(item);
    if (!p.success) return [];
    const j = p.data;
    const url = canonicalUrl(j.absolute_url);
    const locations = [...new Set([j.location?.name, ...(j.offices ?? []).map((o) => o.location?.name)].filter((l): l is string => !!l))];
    if (j.location_type === "remote" && !locations.some((l) => /remote/i.test(l))) locations.push("Remote");
    const description = j.content_plain ?? "";
    return [{
      id: jobId(url),
      source: `gem:${slug}`,
      company,
      title: j.title.trim(),
      url,
      ats: "gem",
      locations,
      postedAt: j.first_published_at ? j.first_published_at.slice(0, 10) : null,
      terms: [],
      sponsorship: "unknown",
      degrees: [],
      category: j.departments?.[0]?.name ?? null,
      description,
      descriptionSource: description ? "api" : "none",
    }];
  });
}

/** Gem has no public per-posting endpoint; the board listing carries full descriptions. */
export async function fetchGemJob(slug: string, id: string): Promise<string | null> {
  try {
    return (await fetchGemBoard(slug, slug)).find((j) => gemJobId(j.url) === id)?.description ?? null;
  } catch {
    return null;
  }
}

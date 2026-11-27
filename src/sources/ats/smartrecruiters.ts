/**
 * SmartRecruiters public postings API. No auth. The board listing is paged and carries no description;
 * one posting's own endpoint carries it, so a description is read only for a job that gets that far.
 */
import { z } from "zod";
import { DISCOVER } from "../../config.js";
import { getJson } from "../../util/http.js";
import { htmlToText } from "../../util/text.js";
import { canonicalUrl, jobId, type Job } from "../../jobs/normalize.js";

const Named = z.object({ label: z.string().nullish() }).nullish();
const SrPosting = z.object({
  id: z.string(),
  name: z.string(),
  releasedDate: z.string().nullish(),
  company: z.object({ identifier: z.string(), name: z.string().nullish() }),
  location: z.object({ fullLocation: z.string().nullish(), city: z.string().nullish(), remote: z.boolean().nullish() }).nullish(),
  department: Named,
  function: Named,
});
const SrPage = z.object({ totalFound: z.number(), content: z.array(z.unknown()) });
const SrSection = z.object({ title: z.string().nullish(), text: z.string().nullish() }).nullish();
const SrPostingDetail = z.object({
  jobAd: z.object({ sections: z.object({ companyDescription: SrSection, jobDescription: SrSection, qualifications: SrSection, additionalInformation: SrSection }) }),
});

/** Paths on jobs.smartrecruiters.com that are SmartRecruiters' own pages, not a company's board. */
const NOT_A_BOARD = /^(oneclick-ui|external-referrals|sr-jobs|api)$/i;

/** The company a SmartRecruiters link belongs to: jobs.smartrecruiters.com/AJBell1/744000163865709-... names "AJBell1". */
export function smartRecruitersSlug(url: string): string | null {
  const m = /^https:\/\/(?:jobs|careers)\.smartrecruiters\.com\/([^/?#]+)/i.exec(url);
  const slug = m ? decodeURIComponent(m[1] as string) : null;
  return slug && !NOT_A_BOARD.test(slug) ? slug : null;
}

/** The posting's number, which is the same however the link spells the company or the title after it. */
export function smartRecruitersJobId(url: string): string | null {
  return /^https:\/\/(?:jobs|careers)\.smartrecruiters\.com\/[^/?#]+\/(\d{6,})/i.exec(url)?.[1] ?? null;
}

/**
 * Every posting on one board, newest first, a page at a time. A board of thousands (a large employer) is
 * read only as far as DISCOVER.smartRecruitersMaxPages, which keeps its newest postings.
 */
export async function fetchSmartRecruitersBoard(slug: string, companyFallback: string, get: (url: string) => Promise<unknown> = (url) => getJson(url, { cacheMs: 20 * 60_000 })): Promise<Job[]> {
  const size = DISCOVER.smartRecruitersPageSize;
  const jobs: Job[] = [];
  for (let page = 0; page < DISCOVER.smartRecruitersMaxPages; page++) {
    const raw = await get(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(slug)}/postings?limit=${size}&offset=${page * size}`);
    const parsed = SrPage.safeParse(raw);
    if (!parsed.success) break;
    jobs.push(...smartRecruitersJobs(raw, slug, companyFallback));
    if (parsed.data.content.length < size || (page + 1) * size >= parsed.data.totalFound) break;
  }
  return jobs;
}

/** One posting as a job. The listing carries no description: it is read from the posting's own endpoint. */
function toJob(j: z.infer<typeof SrPosting>, slug: string, company: string, description = ""): Job {
  const url = canonicalUrl(`https://jobs.smartrecruiters.com/${encodeURIComponent(j.company.identifier)}/${j.id}`);
  // "Manchester, , United Kingdom": a region the board left empty.
  const place = (j.location?.fullLocation ?? j.location?.city ?? "").replace(/,\s*,/g, ",").trim();
  return {
    id: jobId(url),
    source: `smartrecruiters:${slug}`,
    company,
    title: j.name.trim(),
    url,
    ats: "smartrecruiters",
    locations: [place, j.location?.remote ? "Remote" : ""].filter(Boolean),
    postedAt: j.releasedDate ? j.releasedDate.slice(0, 10) : null,
    terms: [],
    sponsorship: "unknown",
    degrees: [],
    category: j.function?.label ?? j.department?.label ?? null,
    description,
    descriptionSource: description ? "api" : "none",
  };
}

/** What one page of a SmartRecruiters board says, as jobs. A posting that does not parse is left out. */
export function smartRecruitersJobs(raw: unknown, slug: string, company: string): Job[] {
  const page = SrPage.safeParse(raw);
  if (!page.success) return [];
  return page.data.content.flatMap((item) => {
    const p = SrPosting.safeParse(item);
    return p.success ? [toJob(p.data, slug, company)] : [];
  });
}

/** One posting's description: its sections in order, each under its own title, as plain text. */
export function smartRecruitersDescription(raw: unknown): string | null {
  const d = SrPostingDetail.safeParse(raw);
  if (!d.success) return null;
  const s = d.data.jobAd.sections;
  const parts = [s.companyDescription, s.jobDescription, s.qualifications, s.additionalInformation]
    .map((x) => (x?.text ? [x.title ?? "", htmlToText(x.text)].filter(Boolean).join("\n") : ""))
    .filter(Boolean);
  return parts.length ? parts.join("\n\n") : null;
}

const postingJson = (slug: string, id: string) => getJson(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(slug)}/postings/${encodeURIComponent(id)}`, { cacheMs: 6 * 60 * 60_000 });

export async function fetchSmartRecruitersJob(slug: string, id: string): Promise<string | null> {
  return smartRecruitersDescription(await postingJson(slug, id));
}

/** One posting as a job, with its description, from what its own endpoint says. Null when it does not parse. */
export function smartRecruitersPosting(raw: unknown, slug: string): Job | null {
  const p = SrPosting.safeParse(raw);
  return p.success ? toJob(p.data, slug, p.data.company.name ?? slug, smartRecruitersDescription(raw) ?? "") : null;
}

/** One posting by its link. Read from its own endpoint: a board of thousands is not read to find it. */
export async function fetchSmartRecruitersPosting(slug: string, id: string): Promise<Job | null> {
  return smartRecruitersPosting(await postingJson(slug, id), slug);
}

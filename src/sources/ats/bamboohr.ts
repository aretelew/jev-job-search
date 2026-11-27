/**
 * BambooHR careers pages, read as the JSON they load. No auth. The list is whole and carries no
 * description or date; one opening's own endpoint carries them, so a description is read only for a
 * job that gets that far.
 */
import { z } from "zod";
import { getJson } from "../../util/http.js";
import { htmlToText } from "../../util/text.js";
import { canonicalUrl, hostIs, jobId, type Job } from "../../jobs/normalize.js";

const Place = z.object({ city: z.string().nullish(), state: z.string().nullish(), province: z.string().nullish(), country: z.string().nullish() }).nullish();
const BambooOpening = z.object({
  id: z.string(),
  jobOpeningName: z.string(),
  departmentLabel: z.string().nullish(),
  location: Place,
  atsLocation: Place,
  isRemote: z.boolean().nullish(),
});
const BambooList = z.object({ result: z.array(z.unknown()) });
const BambooDetail = z.object({ result: z.object({ jobOpening: z.object({ description: z.string().nullish() }) }) });

/** Subdomains of bamboohr.com that are BambooHR's own, not an employer's careers page. */
const NOT_A_BOARD = /^(www|api|help|marketplace|partners)$/i;

/** The employer a BambooHR link belongs to: amii.bamboohr.com/careers/254 names "amii". */
export function bambooSlug(url: string): string | null {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  const slug = hostIs(host, "bamboohr.com") ? host.slice(0, -".bamboohr.com".length) : "";
  return slug && !slug.includes(".") && !NOT_A_BOARD.test(slug) ? slug : null;
}

export async function fetchBambooBoard(slug: string, companyFallback: string): Promise<Job[]> {
  return bambooJobs(await getJson(`https://${slug}.bamboohr.com/careers/list`, { cacheMs: 20 * 60_000 }), slug, companyFallback);
}

/** What a BambooHR careers page lists, as jobs. An opening that does not parse is left out. */
export function bambooJobs(raw: unknown, slug: string, company: string): Job[] {
  const list = BambooList.safeParse(raw);
  if (!list.success) return [];
  return list.data.result.flatMap((item): Job[] => {
    const p = BambooOpening.safeParse(item);
    if (!p.success) return [];
    const j = p.data;
    const url = canonicalUrl(`https://${slug}.bamboohr.com/careers/${j.id}`);
    // The place the employer typed, else the one BambooHR keeps for its own listings.
    const at = j.location?.city || j.location?.state ? j.location : j.atsLocation;
    const place = [at?.city, at?.state ?? at?.province, at?.country].filter(Boolean).join(", ");
    return [{
      id: jobId(url),
      source: `bamboohr:${slug}`,
      company,
      title: j.jobOpeningName.trim(),
      url,
      ats: "bamboohr",
      locations: [place, j.isRemote ? "Remote" : ""].filter(Boolean),
      postedAt: null,
      terms: [],
      sponsorship: "unknown",
      degrees: [],
      // BambooHR writes its label as "Department:  Advanced Technology".
      category: j.departmentLabel?.replace(/^department:\s*/i, "").trim() || null,
      description: "",
      descriptionSource: "none",
    }];
  });
}

/** One opening's description, as plain text. */
export function bambooDescription(raw: unknown): string | null {
  const d = BambooDetail.safeParse(raw);
  const html = d.success ? d.data.result.jobOpening.description : null;
  return html ? htmlToText(html) : null;
}

export async function fetchBambooJob(slug: string, id: string): Promise<string | null> {
  return bambooDescription(await getJson(`https://${slug}.bamboohr.com/careers/${encodeURIComponent(id)}/detail`, { cacheMs: 6 * 60 * 60_000 }));
}

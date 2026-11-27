/**
 * Fills job.description. Uses the ATS public API when the URL points at a
 * board the tool reads (src/sources/companies.ts: clean text, no rate limits) and falls back to
 * fetching the page and stripping it to text. Descriptions are capped so a
 * rating request stays well inside JEV's context window.
 */
import { JEV } from "../config.js";
import { fetchWorkdayJob } from "../sources/ats/workday.js";
import { getText } from "../util/http.js";
import { htmlToText, truncate } from "../util/text.js";
import { readerFor } from "../sources/ats/readers.js";
import type { Job } from "./normalize.js";

export async function describe(job: Job): Promise<Job> {
  if (job.description && job.description.length > 200) {
    return { ...job, description: truncate(job.description, JEV.maxDescriptionChars) };
  }
  let text: string | null = null;
  let source: Job["descriptionSource"] = "none";
  try {
    const reader = readerFor(job.ats);
    const slug = reader?.slug(job.url);
    const id = reader?.jobId(job.url);
    if (reader && slug && id) {
      text = await reader.describe(slug, id, job.company);
      source = "api";
    }
    if (!text && job.ats === "workday") {
      text = await fetchWorkdayJob(job.url);
      if (text) source = "api";
    }
    if (!text) {
      const html = await getText(job.url, { cacheMs: 6 * 60 * 60_000 });
      text = extractMainText(html);
      source = "html";
    }
  } catch {
    text = null;
  }
  if (!text || text.length < 80) return { ...job, description: "", descriptionSource: "none" };
  return { ...job, description: truncate(text, JEV.maxDescriptionChars), descriptionSource: source };
}

/** Prefers <main> or <article>, then the densest chunk of the body, so nav and footer do not drown the posting. */
export function extractMainText(html: string): string {
  const main = /<main[\s\S]*?<\/main>/i.exec(html)?.[0] ?? /<article[\s\S]*?<\/article>/i.exec(html)?.[0];
  if (main) {
    const t = htmlToText(main);
    if (t.length > 400) return t;
  }
  const body = /<body[\s\S]*?<\/body>/i.exec(html)?.[0] ?? html;
  return htmlToText(body);
}

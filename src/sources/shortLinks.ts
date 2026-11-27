/**
 * Some job lists link every posting through their own link shortener, which hides the posting's
 * address and job board. Others link an Eightfold careers site, which only shows a posting from the
 * employer's real board. Each such link is looked up once, paced like any other site, and the job
 * takes its real address, id and board. What is learned is kept in src/jobs/shortLinkStore.ts.
 */
import { DISCOVER } from "../config.js";
import { atsFromUrl, canonicalUrl, jobId, type Job } from "../jobs/normalize.js";
import { isEightfoldLink, isShortLink, knownTarget, rememberTargets } from "../jobs/shortLinkStore.js";
import { getRedirect, mapLimit } from "../util/http.js";
import { spacer } from "../util/pace.js";
import { eightfoldApplyUrl } from "./ats/eightfold.js";

export type Redirect = (url: string) => Promise<string | null>;

/** One step from a short link: a shortener answers with a redirect, an Eightfold site with the posting it shows. */
const nextHop: Redirect = (url) => (isEightfoldLink(url) ? eightfoldApplyUrl(url) : getRedirect(url));

/** Where a short link ends up, following only further short links. Null when it does not lead to a web address. */
export async function resolveShortLink(url: string, redirect: Redirect = nextHop): Promise<string | null> {
  let at = url;
  for (let hop = 0; hop < DISCOVER.shortLinkMaxHops && isShortLink(at); hop++) {
    const next = await redirect(at);
    if (!next) return null;
    at = next;
  }
  // Only a plain web address is taken: the target is data from another site, never something to run.
  return /^https?:\/\//i.test(at) && !isShortLink(at) ? at : null;
}

/** The job as it is at its real address: the same posting, with the address, id and board that address gives. */
export function atTarget(job: Job, target: string): Job {
  const url = canonicalUrl(target);
  return { ...job, id: jobId(url), url, ats: atsFromUrl(url) };
}

const perShortener = spacer(DISCOVER.shortLinkGapMs);
const hostOf = (url: string) => new URL(url).hostname;

/**
 * Every job behind a short link is moved to its real address. A job whose link cannot be resolved
 * now is left out of this search: queued under its short link, it would come back as a second job
 * the day the link resolves. It is looked up again by the next search.
 */
export async function resolveShortLinks(jobs: Job[], redirect: Redirect = nextHop): Promise<{ jobs: Job[]; resolved: number; dropped: number }> {
  const unknown = [...new Set(jobs.map((j) => j.url).filter((u) => isShortLink(u) && !knownTarget(u)))];
  const looked = await mapLimit(unknown, DISCOVER.fetchConcurrency, (u) => perShortener(hostOf(u), () => resolveShortLink(u, redirect)));
  rememberTargets(looked.flatMap((r, i) => (r.ok && r.value ? [[unknown[i] as string, r.value] as [string, string]] : [])));
  let resolved = 0;
  const out: Job[] = [];
  for (const j of jobs) {
    if (!isShortLink(j.url)) {
      out.push(j);
      continue;
    }
    const target = knownTarget(j.url);
    if (!target) continue;
    resolved++;
    out.push(atTarget(j, target));
  }
  return { jobs: out, resolved, dropped: jobs.length - out.length };
}

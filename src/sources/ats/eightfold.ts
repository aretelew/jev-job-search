/**
 * Eightfold careers sites (jobs.nvidia.com and the like) show a posting that lives on another board,
 * and take no application themselves. Their public posting endpoint names where the posting applies.
 */
import { z } from "zod";
import { getJson } from "../../util/http.js";

const EightfoldPosting = z.object({ apply_redirect_url: z.string() });

type Get = (url: string) => Promise<unknown>;

/**
 * The posting's own address on the board it applies through, read from the careers site. Null for a
 * link that is not a posting there, or a posting that names no address.
 * https://jobs.acme.com/careers/job/893398824101 leads to https://acme.wd5.myworkdayjobs.com/...
 */
export async function eightfoldApplyUrl(url: string, get: Get = getJson): Promise<string | null> {
  const u = new URL(url);
  const id = /^\/careers\/job\/(\d+)\/?$/.exec(u.pathname)?.[1];
  if (!id) return null;
  // The site is asked about its own employer: jobs.acme.com answers for acme.com.
  const domain = u.hostname.split(".").slice(1).join(".");
  const p = EightfoldPosting.safeParse(await get(`${u.origin}/api/apply/v2/jobs/${id}?domain=${encodeURIComponent(domain)}`));
  return p.success ? p.data.apply_redirect_url : null;
}

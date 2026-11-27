/**
 * Where each list-site short link leads, as far as it is known. A link to a careers site that only
 * shows a posting from another board (DISCOVER.eightfoldHosts) counts as a short link to that posting.
 * A short link and the posting it leads to are one job, so the posting key reads this: a job applied
 * to under its short link and found again at its real address keeps one identity, and is never
 * sent twice.
 *
 * This module only holds what was learned. Learning it, over the network, is src/sources/shortLinks.ts.
 */
import { CACHE, DISCOVER, PATHS } from "../config.js";
import { KeyedCache } from "../util/cache.js";

type Store = Pick<KeyedCache<string>, "get" | "set" | "save">;
let store: Store | null = null;
const targets = (): Store => (store ??= new KeyedCache<string>(PATHS.shortLinks, "all", CACHE.maxShortLinks));

/** For a test: hold targets in memory instead of the file. */
export function useShortLinkStore(s: Store | null): void {
  store = s;
}

function onHosts(url: string, hosts: readonly string[]): boolean {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return hosts.some((h) => host === h || host.endsWith(`.${h}`));
}

/** A posting link on an Eightfold careers site, which shows a posting from another board. */
export const isEightfoldLink = (url: string): boolean => onHosts(url, DISCOVER.eightfoldHosts);

export const isShortLink = (url: string): boolean => onHosts(url, DISCOVER.shortLinkHosts) || isEightfoldLink(url);

/** Where a short link leads, when that was learned. Undefined for any other link. */
export const knownTarget = (url: string): string | undefined => (isShortLink(url) ? targets().get(url) : undefined);

export function rememberTargets(found: Iterable<[string, string]>): void {
  for (const [url, target] of found) targets().set(url, target);
  targets().save();
}

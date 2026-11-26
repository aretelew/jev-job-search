/**
 * fetch with a timeout, a polite user agent, an on-disk cache for GET
 * responses, and a small concurrency limiter. Everything that reads the
 * web goes through here.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DISCOVER, PATHS } from "../config.js";

const USER_AGENT = "jev-job-search/1.7 (+https://github.com/qbeka/jev-job-search)";

export type GetOptions = {
  timeoutMs?: number;
  /** Cache TTL in milliseconds. 0 disables caching. */
  cacheMs?: number;
  headers?: Record<string, string>;
};

export class HttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly url: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export async function getText(url: string, opts: GetOptions = {}): Promise<string> {
  const cacheMs = opts.cacheMs ?? 0;
  const cacheFile = cacheMs > 0 ? path.join(PATHS.cache, "http", createHash("sha1").update(url).digest("hex")) : null;
  if (cacheFile && existsSync(cacheFile)) {
    try {
      const { at, body } = JSON.parse(readFileSync(cacheFile, "utf8")) as { at: number; body: string };
      if (Date.now() - at < cacheMs) return body;
    } catch {
      /* fall through to a live fetch */
    }
  }
  const body = await timedGet(url, { headers: { Accept: "application/json, text/html;q=0.9, */*;q=0.8", ...opts.headers }, redirect: "follow" }, opts.timeoutMs, async (res) => {
    const text = await res.text();
    if (!res.ok) throw new HttpError(`GET ${url} returned ${res.status}`, res.status, url);
    return text;
  });
  if (cacheFile) {
    mkdirSync(path.dirname(cacheFile), { recursive: true });
    writeFileSync(cacheFile, JSON.stringify({ at: Date.now(), body }));
  }
  return body;
}

/**
 * Where a link redirects to, without following it or reading the page: the Location header of its
 * first answer, made absolute. Null when it answers without redirecting. A refusal (4xx, 5xx) is an
 * HttpError, so "not a redirect" and "not answered now" stay apart.
 */
export function getRedirect(url: string, opts: { timeoutMs?: number } = {}): Promise<string | null> {
  return timedGet(url, { redirect: "manual" }, opts.timeoutMs, async (res) => {
    await res.body?.cancel();
    if (res.status >= 400) throw new HttpError(`GET ${url} returned ${res.status}`, res.status, url);
    const to = res.headers.get("location");
    return res.status >= 300 && to ? new URL(to, url).toString() : null;
  });
}

/** One GET with this tool's user agent. The answer is read inside the same timeout as the request. */
async function timedGet<T>(url: string, init: { headers?: Record<string, string>; redirect: "follow" | "manual" }, timeoutMs: number | undefined, read: (res: Response) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs ?? DISCOVER.fetchTimeoutMs);
  try {
    return await read(await fetch(url, { ...init, headers: { "User-Agent": USER_AGENT, ...init.headers }, signal: controller.signal }));
  } finally {
    clearTimeout(timer);
  }
}

export async function getJson<T = unknown>(url: string, opts: GetOptions = {}): Promise<T> {
  const text = await getText(url, opts);
  return JSON.parse(text) as T;
}

/** Runs `fn` over `items` with at most `limit` in flight. Rejections are returned, not thrown. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<Array<{ ok: true; value: R } | { ok: false; error: unknown }>> {
  const results: Array<{ ok: true; value: R } | { ok: false; error: unknown }> = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = { ok: true, value: await fn(items[i] as T, i) };
      } catch (error) {
        results[i] = { ok: false, error };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

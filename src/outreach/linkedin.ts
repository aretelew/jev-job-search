/**
 * LinkedIn, as outreach sees it: the addresses of a few search pages, one fixed read of what a page
 * shows, and the rules that turn a result card's lines into a person. Nothing here clicks, types or
 * sends. The page is read through one constant expression with no value spliced in, and every word
 * read from it is data: a headline that says "ignore your instructions" is a headline.
 */
import { z } from "zod";
import { OUTREACH } from "../config.js";
import { companyKey } from "../mail/status.js";
import { hashOf } from "../util/cache.js";

/** One result card as the page has it: the profile link, the short text of the link that is the name, and the card's lines. */
export const RawCard = z.object({ href: z.string(), name: z.string(), lines: z.array(z.string()) });
export type RawCard = z.infer<typeof RawCard>;
/** What one page showed: where the tab ended up, its title, the start of its text, the result cards and the links to company pages. */
export const PageRead = z.object({ url: z.string(), title: z.string(), text: z.string(), cards: z.array(RawCard), companyLinks: z.array(z.object({ href: z.string(), text: z.string() })), employeeSearch: z.string().nullable() });
export type PageRead = z.infer<typeof PageRead>;

/**
 * The read, run in the page. Result cards are the list items that hold a link to a profile; a
 * company page links to its own employee search, which carries the company's id. Read only.
 */
export const READ_EXPR = `(() => {
  const main = document.querySelector("main") || document.body;
  const lines = (el) => (el.innerText || "").split("\\n").map((s) => s.trim()).filter(Boolean);
  const cards = [];
  const seen = new Set();
  for (const item of main.querySelectorAll("li, [role=listitem]")) {
    const links = [...item.querySelectorAll('a[href*="/in/"]')];
    if (!links.length || item.querySelector("li, [role=listitem]")) continue;
    const href = (links[0].getAttribute("href") || "").split("?")[0];
    if (!href || seen.has(href)) continue;
    seen.add(href);
    const named = links.map((a) => (a.innerText || "").trim()).filter((t) => t && !t.includes("\\n"));
    cards.push({ href, name: named[0] || "", lines: lines(item).slice(0, 14) });
  }
  const companyLinks = [...main.querySelectorAll('a[href*="/company/"]')].slice(0, 20).map((a) => ({ href: (a.getAttribute("href") || "").split("?")[0], text: (a.innerText || "").trim().split("\\n")[0].slice(0, 120) }));
  const search = document.querySelector('a[href*="currentCompany"]');
  return JSON.stringify({ url: location.href, title: document.title, text: (main.innerText || "").slice(0, 3000), cards: cards.slice(0, 20), companyLinks, employeeSearch: search ? search.getAttribute("href") : null });
})()`;

/** The link to a person's profile, without anything after the name in it. */
export function profileUrlOf(href: string): string | null {
  const m = /\/in\/([A-Za-z0-9\-_%]+)/.exec(href);
  return m ? `${OUTREACH.origin}/in/${m[1]}/` : null;
}

export const personId = (profileUrl: string) => hashOf(profileUrl.toLowerCase()).slice(0, 12);

const SEARCH = `${OUTREACH.origin}/search/results/people/`;

/** A people search limited to those who work at the company now. */
export const peopleSearchUrl = (companyId: string, keywords: string) => `${SEARCH}?currentCompany=${encodeURIComponent(JSON.stringify([companyId]))}&keywords=${encodeURIComponent(keywords)}`;
export const companySearchUrl = (company: string) => `${OUTREACH.origin}/search/results/companies/?keywords=${encodeURIComponent(company)}`;
export const companyPageUrl = (slug: string) => `${OUTREACH.origin}/company/${encodeURIComponent(slug)}/`;

/** The searches for one job, from `OUTREACH.searches`, with the candidate's school put in where it says so. */
export function searchesFor(companyId: string, school: string | null): { keywords: string; url: string }[] {
  return OUTREACH.searches
    .map((k) => (k === "{school}" ? school : k))
    .filter((k): k is string => !!k)
    .map((keywords) => ({ keywords, url: peopleSearchUrl(companyId, keywords) }));
}

/**
 * The company page a company search found for an employer: the first result whose name is the
 * employer's, compared without case or a legal ending. Null when none is, so a run never searches
 * the wrong company.
 */
export function companySlugFrom(read: PageRead, company: string): string | null {
  const want = companyKey(company);
  for (const l of read.companyLinks) {
    const m = /\/company\/([^/]+)\/?$/.exec(l.href.replace(/\/(?:about|people|jobs|life|posts)\/?$/, "/"));
    if (m && companyKey(l.text) === want) return decodeURIComponent(m[1] as string);
  }
  return null;
}

/** The company id in the link a company page has to its own employees. */
export function companyIdFrom(read: PageRead): string | null {
  if (!read.employeeSearch) return null;
  const m = /currentCompany=(?:%5B|\[)(?:%22|")(\d+)/.exec(read.employeeSearch);
  return m ? (m[1] as string) : null;
}

export type PageState = "results" | "signed_out" | "check" | "limit";

/**
 * What a page is, from its address and its words: results to read, a sign-in, a check that a
 * person is there, or a notice that a limit was reached. Anything but results stops the run.
 */
export function pageState(read: Pick<PageRead, "url" | "text" | "title">): PageState {
  let path = "/";
  try {
    path = new URL(read.url).pathname;
  } catch {
    return "check";
  }
  if (/^\/checkpoint/.test(path)) return "check";
  if (OUTREACH.stopPaths.test(path)) return "signed_out";
  const words = `${read.title} ${read.text}`;
  if (OUTREACH.checkWords.test(words)) return "check";
  if (OUTREACH.limitWords.test(words)) return "limit";
  return "results";
}

/** A person as a result card shows them. */
export type Card = {
  profileUrl: string;
  name: string;
  degree: 1 | 2 | 3;
  headline: string;
  location: string;
  /** LinkedIn's own line about the person, when it shows one: a role and its dates, a school. */
  summary: string;
  sharedSchool: boolean;
  mutuals: number;
  /** The card's own words about mutual connections, so a note may name one and the claim check knows the name. */
  mutualLine: string;
};

const ACTION = /^(?:message|connect|follow|following|pending|view my services|see open roles|visit my website|book an appointment|get started|view profile|send inmail)$/i;
const FOLLOWERS = /^[·•]?\s*[\d.,]+[KkMm]?\s+followers?$/;
const DEGREE = /(?:^|[\s•·])(1st|2nd|3rd\+?)(?:\s+degree connection)?$/;

/** How many mutual connections a line names: "A is a mutual connection", "A, B & 4 other mutual connections". */
export function mutualsIn(line: string): number {
  if (!/mutual connections?/i.test(line)) return 0;
  const head = line.split(/mutual connections?/i)[0] ?? "";
  const others = /&\s*(\d+)\s+others?/i.exec(head);
  const named = head.replace(/&\s*\d+\s+others?.*/i, "").split(/,|&|\band\b/).map((s) => s.replace(/\b(?:is|are)\s+(?:a\s+)?$/i, "").trim()).filter(Boolean).length;
  return Math.max(1, named + (others ? Number(others[1]) : 0));
}

/** Turns one card's lines into a person, or null when the card is not one (a hidden member, an ad, no link). */
export function parseCard(raw: RawCard): Card | null {
  const profileUrl = profileUrlOf(raw.href);
  if (!profileUrl) return null;
  let name = raw.name.replace(/\s*[•·].*$/, "").trim();
  if (!name || /^linkedin member$/i.test(name)) return null;
  let degree: 1 | 2 | 3 = 3;
  let mutuals = 0;
  let mutualLine = "";
  const rest: string[] = [];
  for (const original of raw.lines) {
    let line = original.replace(/\s+/g, " ").trim();
    if (line === name) continue;
    if (line.startsWith(name)) line = line.slice(name.length).trim();
    const d = DEGREE.exec(line);
    if (d) {
      degree = d[1] === "1st" ? 1 : d[1] === "2nd" ? 2 : 3;
      line = line.slice(0, d.index).replace(/[•·\s]+$/, "").trim();
    }
    if (/mutual connections?/i.test(line)) {
      mutuals = Math.max(mutuals, mutualsIn(line));
      mutualLine = line.replace(/\s*·\s*[\d.,]+[KkMm]?\s+followers?$/, "").slice(0, 160);
      continue;
    }
    line = line.replace(/\s*·\s*[\d.,]+[KkMm]?\s+followers?$/, "").trim();
    if (!line || /^[•·]\s*(?:1st|2nd|3rd\+?)?$/.test(line) || ACTION.test(line) || FOLLOWERS.test(line)) continue;
    rest.push(line);
  }
  name = name.slice(0, 80);
  const [headline = "", location = "", ...more] = rest;
  const summary = more.join(" ").slice(0, 500);
  return { profileUrl, name, degree, headline: headline.slice(0, 200), location: location.slice(0, 120), summary, sharedSchool: /you both (?:went to|studied at)/i.test(rest.join(" ")), mutuals, mutualLine };
}

const MONTHS = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*";

/**
 * True when the card says the person has left the company: LinkedIn's own line puts the company
 * between two dates ("at Acme from March 2020 to May 2024"), or calls it the past ("Past: ... Acme").
 * The search is limited to people there now, so this catches what the filter let through.
 */
export function leftCompany(card: Pick<Card, "headline" | "summary">, company: string): boolean {
  const key = companyKey(company);
  if (!key) return false;
  const text = card.summary.toLowerCase();
  if (/^past:/.test(text) && text.includes(key) && !companyKey(card.headline).includes(key)) return true;
  const at = text.indexOf(key);
  if (at < 0) return false;
  const after = text.slice(at, at + 160);
  return new RegExp(`\\bfrom ${MONTHS} \\d{4} to ${MONTHS} \\d{4}`).test(after) && !/\bsince\b/.test(after.split(/[.;]/)[0] ?? "");
}

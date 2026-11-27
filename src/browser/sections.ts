/**
 * Sections a form keeps closed behind an "Add" button. Workday shows Education, Languages and Work
 * Experience that way until its resume reader fills them; when it has not, the boxes are not on the
 * page at all. Each one the profile can fill is opened with one real click, and the page is read again
 * by the caller. A section the profile has nothing for stays closed: opening it would only add boxes
 * the form may then require.
 */
import { BROWSER } from "../config.js";
import type { Profile } from "../profile/schema.js";
import { sleep, type Page } from "./cdp.js";
import { inTurn, settle, trace, type Point } from "./session.js";

const SECTIONS: { name: RegExp; fills: (p: Profile) => boolean }[] = [
  { name: /^education$/i, fills: (p) => p.education.length > 0 },
  { name: /^languages?$/i, fills: (p) => p.spokenLanguages.length > 0 },
  { name: /^(work )?experience$/i, fills: (p) => p.experience.some((e) => e.paid) },
];

/** Opens the closed sections the profile can fill. Returns their names, in the order they were opened. */
export async function openSections(page: Page, profile: Profile): Promise<string[]> {
  const opened: string[] = [];
  for (let round = 0; round < SECTIONS.length; round++) {
    const closed = await page.awj<(Point & { section: string })[]>("closedSections").catch(() => []);
    const next = closed.find((c) => c.ok && !opened.includes(c.section) && SECTIONS.some((s) => s.name.test(c.section.trim()) && s.fills(profile)));
    if (!next) break;
    await inTurn(() => page.click(next.x, next.y));
    await sleep(BROWSER.pollMs * 2);
    opened.push(next.section);
  }
  if (opened.length) {
    await settle(page);
    trace(`opened the closed section(s): ${opened.join(", ")}`);
  }
  return opened;
}

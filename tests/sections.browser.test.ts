/**
 * Sections Workday keeps closed behind an "Add" button, opened through a real Chrome on a page on this
 * machine. Only those the profile can fill are opened, and one that already holds boxes is left alone.
 * Skipped where Chrome is not installed.
 */
import { existsSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openSections } from "../src/browser/sections.js";
import { goto } from "../src/browser/session.js";
import { BROWSER } from "../src/config.js";
import { ProfileSchema, type Profile } from "../src/profile/schema.js";
import { startChrome, type TestChrome } from "./helpers/chrome.js";

const example = ProfileSchema.parse(JSON.parse(readFileSync(new URL("../data/profile.example.json", import.meta.url), "utf8")));

// Each section as Workday draws it: a group named by its heading, and an "Add" button that brings in its boxes.
const section = (id: string, name: string, open = false) =>
  `<div role="group" aria-labelledby="${id}-section"><h3 id="${id}-section">${name}</h3><div id="${id}">${open ? `<input id="${id}-1">` : ""}</div>` +
  `<button data-automation-id="add-button" onclick="document.getElementById('${id}').insertAdjacentHTML('beforeend','<input id=&quot;${id}-1&quot;>'); window.opened.push('${name}')">Add</button></div>`;
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>My Experience</title></head><body>
<script>window.opened = [];</script>
${section("workExperience", "Work Experience", true)}${section("education", "Education")}${section("languages", "Languages")}${section("websites", "Websites")}
</body></html>`;

describe.skipIf(!existsSync(BROWSER.chromePath))("sections behind an Add button, in a real browser", () => {
  let chrome: TestChrome;
  let server: Server;
  let url = "";

  beforeAll(async () => {
    server = createServer((_req, res) => res.writeHead(200, { "content-type": "text/html" }).end(PAGE));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${(server.address() as { port: number }).port}/apply`;
    chrome = await startChrome();
  }, 30_000);

  afterAll(async () => {
    await chrome?.close();
    await new Promise((resolve) => server?.close(resolve));
  });

  it("opens Education and Languages, and leaves an open section and one the profile cannot fill", async () => {
    const page = await chrome.tab();
    await goto(page, url);
    const profile: Profile = { ...example, spokenLanguages: [{ name: "English", level: "Native" }] };
    expect(await openSections(page, profile)).toEqual(["Education", "Languages"]);
    expect(await page.evaluate("window.opened")).toEqual(["Education", "Languages"]);
    // Nothing is opened twice, and a profile with nothing for a section leaves it closed.
    expect(await openSections(page, profile)).toEqual([]);
    page.close();
  }, 60_000);
});

/**
 * A form in a window of its own, opened in the background, takes real clicks and typing while another
 * window is the one in front, and it is never brought forward. This is what lets the tool fill forms
 * without taking the person's screen. Skipped where Chrome is not installed.
 */
import { existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newBackgroundWindow, Page } from "../src/browser/cdp.js";
import { fillDropdown } from "../src/browser/dropdowns.js";
import { goto, inTurn, shownValues } from "../src/browser/session.js";
import { BROWSER } from "../src/config.js";
import { startChrome, type TestChrome } from "./helpers/chrome.js";

// A box that takes real typing, and a list that opens on a real click: Workday's kind.
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Apply</title></head><body>
<input id="name" type="text">
<div data-automation-id="applyFlowPage"><div data-automation-id="multiSelectContainer"><ul data-automation-id="selectedItemList" id="picked"></ul><input id="skills" type="text"></div>
<div data-automation-id="activeListContainer" id="list"></div></div>
<script>
window.focusEvents = 0;
document.getElementById("name").addEventListener("focus", () => window.focusEvents++);
const input = document.getElementById("skills"), list = document.getElementById("list"), picked = document.getElementById("picked");
input.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  e.preventDefault();
  list.innerHTML = "";
  for (const s of ["Python (Programming Language)", "TypeScript"].filter((x) => x.toLowerCase().includes(input.value.toLowerCase()))) {
    const row = document.createElement("div"); row.setAttribute("role", "option"); row.tabIndex = -1; row.textContent = s;
    row.addEventListener("click", () => { const li = document.createElement("li"); li.setAttribute("data-automation-id", "selectedItem"); li.textContent = s; picked.appendChild(li); row.remove(); });
    list.appendChild(row);
  }
});
</script></body></html>`;

describe.skipIf(!existsSync(BROWSER.chromePath))("a form in a background window, in a real browser", () => {
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

  it("takes typing and clicks while another window is in front", async () => {
    // The person's window, in front.
    const theirs = await chrome.tab();
    await theirs.bringToFront();
    const page = await Page.attach(await newBackgroundWindow("about:blank", chrome.root));
    await goto(page, url);
    // The person's window is still the one in front.
    expect(await theirs.evaluate("document.visibilityState")).toBe("visible");
    // Real typing into a box, through the same turn-taking every fill uses, with nothing brought forward.
    await inTurn(async () => {
      const p = await page.awj<{ x: number; y: number }>("point", "#name");
      await page.click(p.x, p.y);
      await page.type("Ada Lovelace");
    });
    expect(await page.evaluate("document.getElementById('name').value")).toBe("Ada Lovelace");
    // A Workday list: searched, opened and picked with real clicks.
    const { why } = await fillDropdown(page, "#skills", "Python, TypeScript, Python", [], true);
    expect(why).toBeNull();
    expect((await shownValues(page, ["#skills"]))[0]).toContain("Python (Programming Language)");
    page.close();
    theirs.close();
  }, 60_000);
});

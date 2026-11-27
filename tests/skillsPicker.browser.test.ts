/**
 * Workday's skills box, driven through a real Chrome against a page on this machine. The box keeps
 * what was typed after a pick, as the live one does, so a search that is not emptied first runs into
 * the next one ("PythonJava"). Skipped where Chrome is not installed.
 */
import { existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fillDropdown } from "../src/browser/dropdowns.js";
import { goto, shownValues } from "../src/browser/session.js";
import { BROWSER } from "../src/config.js";
import { startChrome, type TestChrome } from "./helpers/chrome.js";

// The names the live page uses for the box, its picked items and the list it opens elsewhere on the page.
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Apply</title>
<style>body{font:14px sans-serif;margin:24px} [role=option]{padding:4px;cursor:pointer} li{display:inline-block;margin-right:8px}</style></head>
<body><div data-automation-id="applyFlowPage">
<div data-automation-id="formField-skills"><label for="skills--skills">Type to Add Skills</label>
<div data-automation-id="multiSelectContainer"><ul data-automation-id="selectedItemList" id="picked"></ul>
<input id="skills--skills" type="text" style="width:320px"></div></div>
<div data-automation-id="activeListContainer" id="list"></div></div>
<script>
const SKILLS = ["Python (Programming Language)", "Python Software Development", "Java.net", "Java (Programming Language)", "JavaScript", "JScript", "TypeScript", "SQL", "SQL Script", "PowerShell"];
const input = document.getElementById("skills--skills");
const list = document.getElementById("list");
const picked = document.getElementById("picked");
window.searched = [];
const has = (s) => [...picked.children].some((li) => li.textContent === s);
function pick(s) {
  const li = document.createElement("li");
  li.setAttribute("data-automation-id", "selectedItem");
  li.textContent = s;
  picked.appendChild(li);
}
function search() {
  window.searched.push(input.value);
  list.innerHTML = "";
  const q = input.value.toLowerCase();
  for (const s of SKILLS.filter((x) => !has(x) && x.toLowerCase().includes(q))) {
    const row = document.createElement("div");
    row.setAttribute("role", "option");
    // A row takes the keyboard when clicked, as Workday's check box does, so the box loses it.
    row.tabIndex = -1;
    row.textContent = s;
    row.addEventListener("click", () => { pick(s); row.remove(); });
    list.appendChild(row);
  }
}
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); search(); }
  // An empty box takes off the last item picked, as Workday's does.
  if (e.key === "Backspace" && !input.value && picked.lastChild) picked.lastChild.remove();
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") list.innerHTML = ""; });
</script></body></html>`;

describe.skipIf(!existsSync(BROWSER.chromePath))("a Workday skills box in a real browser", () => {
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

  it("searches each skill on its own and picks every one", async () => {
    const page = await chrome.tab();
    await goto(page, url);
    const { why } = await fillDropdown(page, "#skills--skills", "Python, Java, JavaScript, TypeScript, SQL", [], true);
    expect(why).toBeNull();
    expect(await page.evaluate("window.searched")).toEqual(["Python", "Java", "JavaScript", "TypeScript", "SQL"]);
    const shown = (await shownValues(page, ["#skills--skills"]))[0];
    // "Java" is "Java (Programming Language)", never "Java.net".
    expect(shown).toBe("Python (Programming Language), Java (Programming Language), JavaScript, TypeScript, SQL");
    // Nothing typed is left behind in the box.
    expect(await page.evaluate("document.getElementById('skills--skills').value")).toBe("");
  }, 60_000);
});

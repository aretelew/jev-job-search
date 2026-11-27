/**
 * A Workday questionnaire read through a real Chrome: each question is a group holding a dropdown drawn
 * as a button ("Select One"). The button is the question, read once. Its group is not also a row of
 * buttons to choose from: that phantom question, all "Select One", held ASML, FormFactor, NVIDIA and
 * Micron. A real row of answer buttons is still read. Skipped where Chrome is not installed.
 */
import { existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dump, goto } from "../src/browser/session.js";
import { BROWSER } from "../src/config.js";
import { startChrome, type TestChrome } from "./helpers/chrome.js";

const question = (id: string, words: string) =>
  `<div data-automation-id="formField-${id}"><label for="primaryQuestionnaire--${id}">${words}*</label>` +
  `<button id="primaryQuestionnaire--${id}" aria-haspopup="listbox" aria-required="true" type="button">Select One</button></div>`;
// Workday puts a page's questions in one wrapper whose class names a questionnaire: that wrapper holds every dropdown button.
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Application Questions</title></head><body>
<div data-automation-id="applyFlowPage"><h2>Application Questions</h2>
<div class="css-primaryQuestionnaire">
${question("q1", "Are you legally authorized to work in the country where this position is located?")}
${question("q2", "Are you at least 18 years old?")}
</div>
<div role="group" class="question"><label>Are you willing to relocate?</label><button type="button">Yes</button><button type="button">No</button></div>
</div></body></html>`;

describe.skipIf(!existsSync(BROWSER.chromePath))("a Workday questionnaire, in a real browser", () => {
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

  it("reads each dropdown once, as its question, and no phantom row of buttons", async () => {
    const page = await chrome.tab();
    await goto(page, url);
    const d = await dump(page);
    const authorized = d.fields.filter((f) => /authorized to work/.test(f.label));
    expect(authorized.map((f) => [f.kind, f.selector])).toEqual([["combobox", "#primaryQuestionnaire--q1"]]);
    expect(d.fields.filter((f) => /18 years/.test(f.label)).map((f) => f.kind)).toEqual(["combobox"]);
    expect(d.fields.some((f) => f.options.length > 0 && f.options.every((o) => o.label === "Select One"))).toBe(false);
    // A real row of answer buttons is still a question.
    expect(d.fields.find((f) => /relocate/.test(f.label))).toMatchObject({ kind: "radio", buttonGroup: true, options: [{ label: "Yes" }, { label: "No" }] });
    page.close();
  }, 60_000);
});

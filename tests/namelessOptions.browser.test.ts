/**
 * Choice questions drawn the way Gem draws them, read and set through a real Chrome: every option is a
 * radio with no name and an id drawn at random, the question is plain text above the options, and two
 * such questions sit side by side, with a list of boxes after them. Each question is one group with its own
 * options, a choice is made by its words, the page reads back the option that was picked, and every box in
 * the list answers the question above it. Skipped where Chrome is not installed.
 */
import { existsSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyFills } from "../src/browser/fill.js";
import { dump, goto, shownValues } from "../src/browser/session.js";
import { BROWSER } from "../src/config.js";
import { ProfileSchema } from "../src/profile/schema.js";
import { startChrome, type TestChrome } from "./helpers/chrome.js";

const example = ProfileSchema.parse(JSON.parse(readFileSync(new URL("../data/profile.example.json", import.meta.url), "utf8")));

let n = 0;
// An id like Gem's: letters and digits in both cases, drawn for each option.
const option = (type: string) => (words: string) => {
  const id = `cXVlc29wdDp${(n++).toString().padStart(4, "0")}QLmvDRRa3ySZ`;
  return `<div><input id="${id}" type="${type}"><label for="${id}"><span><div></div></span><div>${words}</div></label><div></div></div>`;
};
const question = (words: string, options: string[], type = "radio") =>
  `<div style="display:flex;flex-direction:column"><div><span>${words}<span> *</span></span></div>` +
  `<div><div><div><div>${options.map(option(type)).join("")}</div></div></div></div></div>`;
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Software Engineer - Internship</title></head><body>
<form><div><div><span>First name<span> *</span></span></div><input type="text"></div>
${question("Are you any of the following protected individuals?", ["A person lawfully admitted for permanent residence (Green Card holder)", "A person admitted as a refugee", "A United States citizen or national", "None of the above"])}
${question("Do you hold an active U.S. security clearance?", ["Yes", "No"])}
${question("Which clearance have you held?", ["Secret", "Top Secret", "N/A - have never held a U.S. security clearance"], "checkbox")}
</form></body></html>`;

describe.skipIf(!existsSync(BROWSER.chromePath))("choice questions whose options have no name, in a real browser", () => {
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

  it("reads each question once, under its own words, with its own options", async () => {
    const page = await chrome.tab();
    await goto(page, url);
    const radios = (await dump(page)).fields.filter((f) => f.kind === "radio");
    expect(radios.map((f) => [f.label, f.required, f.options.map((o) => o.label)])).toEqual([
      ["Are you any of the following protected individuals?", true, ["A person lawfully admitted for permanent residence (Green Card holder)", "A person admitted as a refugee", "A United States citizen or national", "None of the above"]],
      ["Do you hold an active U.S. security clearance?", true, ["Yes", "No"]],
    ]);
    // Boxes that may be ticked together all answer the question above them, so one tick answers it.
    const boxes = (await dump(page)).fields.filter((f) => f.kind === "checkbox");
    expect(boxes.map((f) => [f.label, f.section])).toEqual(["Secret", "Top Secret", "N/A - have never held a U.S. security clearance"].map((l) => [l, "Which clearance have you held?"]));
    page.close();
  }, 60_000);

  it("picks an option by its words and reads back the one picked", async () => {
    const page = await chrome.tab();
    await goto(page, url);
    const [citizen, clearance] = (await dump(page)).fields.filter((f) => f.kind === "radio");
    const fills = [
      { selector: citizen!.selector, kind: "radio" as const, value: "A United States citizen or national" },
      { selector: clearance!.selector, kind: "radio" as const, value: "No" },
    ];
    expect(await applyFills(page, fills, example)).toEqual([]);
    expect(await shownValues(page, fills.map((f) => f.selector))).toEqual(["A United States citizen or national", "No"]);
    page.close();
  }, 60_000);
});

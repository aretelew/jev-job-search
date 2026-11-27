/**
 * A form drawn inside web components, the way SmartRecruiters draws its own, read and set through a real
 * Chrome. Every box sits in the open shadow root of a component, with its label beside it in the same root.
 * The city box is a search box nested two components deep, whose suggestions are rows drawn in shadow roots
 * of their own, the words slotted in from the page. The Next button takes its word from a slot too. The form
 * listens outside the components, so it hears only events that cross a shadow boundary. A second page has a
 * plain form and a cookie banner drawn in a shadow root, which is not part of the application. Skipped where
 * Chrome is not installed.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyFills, uploadFile } from "../src/browser/fill.js";
import { pickNext } from "../src/browser/report.js";
import { dump, goto, shownValues } from "../src/browser/session.js";
import { BROWSER } from "../src/config.js";
import { fileBoxWants } from "../src/forms/mapForm.js";
import { ProfileSchema } from "../src/profile/schema.js";
import { startChrome, type TestChrome } from "./helpers/chrome.js";

const example = ProfileSchema.parse(JSON.parse(readFileSync(new URL("../data/profile.example.json", import.meta.url), "utf8")));

// The components. Each draws its parts in an open shadow root, as SmartRecruiters' do.
const COMPONENTS = `<script>
const shadow = (host, html) => { const r = host.attachShadow({ mode: "open" }); r.innerHTML = html; return r; };
let n = 0;
customElements.define("x-input", class extends HTMLElement {
  connectedCallback() {
    if (this.shadowRoot) return;
    // An id numbered on each render, the way SmartRecruiters numbers some of its own.
    const id = this.id || "spl-form-element_" + n++;
    const star = this.hasAttribute("required") ? "*" : "";
    shadow(this, '<div><label for="' + id + '">' + this.getAttribute("label") + star + '</label><div><input id="' + id + '" type="' + (this.getAttribute("type") || "text") + '"' + (this.hasAttribute("required") ? ' aria-required="true"' : "") + (this.getAttribute("role-in") ? ' role="combobox" aria-autocomplete="list" aria-controls="' + this.getAttribute("role-in") + '"' : "") + '></div></div>');
  }
});
customElements.define("x-item", class extends HTMLElement {
  connectedCallback() { if (!this.shadowRoot) shadow(this, '<div role="option" style="padding:4px"><slot></slot></div>'); }
});
customElements.define("x-autocomplete", class extends HTMLElement {
  connectedCallback() {
    if (this.shadowRoot) return;
    const r = shadow(this, '<x-input label="City" required role-in="menu-city"></x-input><div id="menu-city" role="listbox"></div>');
    const list = r.getElementById("menu-city");
    const box = () => r.querySelector("x-input").shadowRoot.querySelector("input");
    const places = ["Chicago, IL, US", "Chicago Heights, IL, US", "Springfield, IL, US"];
    customElements.whenDefined("x-input").then(() => {
      box().addEventListener("input", () => {
        list.innerHTML = "";
        const typed = box().value.toLowerCase();
        if (typed.length < 3) return;
        for (const p of places.filter((p) => p.toLowerCase().includes(typed))) {
          const item = document.createElement("x-item");
          item.textContent = p;
          item.addEventListener("click", () => { box().value = p; list.innerHTML = ""; });
          list.append(item);
        }
      });
    });
  }
});
customElements.define("x-dropzone", class extends HTMLElement {
  connectedCallback() { if (!this.shadowRoot) shadow(this, '<div><label for="spl-dropzone-file-input-' + n++ + '">Choose a file or drop it here</label><input type="file" id="spl-dropzone-file-input-' + (n - 1) + '" style="display:none"><span>10MB size limit</span></div>'); }
});
customElements.define("x-button", class extends HTMLElement {
  connectedCallback() { if (!this.shadowRoot) shadow(this, '<button type="button"><slot></slot></button>'); }
});
// The form keeps its own copy of each value, from the events it hears outside the components.
window.heard = {};
document.addEventListener("input", (e) => { const t = e.composedPath()[0]; if (t && t.id) window.heard[t.id] = t.value; });
</script>`;

const SHADOW_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Easy apply - Software Engineer Intern</title></head><body>
${COMPONENTS}
<h1>Software Engineer Intern</h1>
<div data-test="easy-apply"><p>Choose an option to autocomplete your application. You can still fill your profile manually.</p><x-dropzone data-test="apply-with-resume-container"></x-dropzone></div>
<h2>Personal information</h2>
<div data-test="personal-info-first-name"><x-input id="first-name-input" label="First name" required></x-input></div>
<div data-test="personal-info-last-name"><x-input id="last-name-input" label="Last name" required></x-input></div>
<div data-test="personal-info-email"><x-input id="email-input" type="email" label="Email" required></x-input></div>
<div data-test="personal-info-location"><x-autocomplete data-test="location-autocomplete"></x-autocomplete></div>
<h2>Your profiles</h2>
<div data-test="web"><x-input id="linkedin-input" label="LinkedIn"></x-input></div>
<div data-test="resume-upload-container"><p>Resume *</p><x-dropzone data-test="resume-upload"></x-dropzone></div>
<div data-test="footer-next"><x-button>Next</x-button></div>
</body></html>`;

// What SmartRecruiters' form page shows instead of the form when DataDome wants a person to prove themselves.
const BOT_CHECK_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>smartrecruiters.com</title></head><body>
<iframe src="https://geo.captcha-delivery.com/captcha/?initialCid=test" width="100%" height="500"></iframe></body></html>`;

// A plain form, with a cookie banner a consent tool draws in a shadow root of its own.
const PLAIN_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Apply</title></head><body>
${COMPONENTS}
<form><label for="name">Full name</label><input id="name" type="text"><label for="mail">Email</label><input id="mail" type="email"><button type="submit">Submit application</button></form>
<div id="consent"></div>
<script>document.getElementById("consent").attachShadow({ mode: "open" }).innerHTML = '<label><input type="checkbox" id="analytics"> Analytics cookies</label><input type="email" placeholder="Newsletter"><button>Accept all</button>';</script>
</body></html>`;

describe.skipIf(!existsSync(BROWSER.chromePath))("a form drawn in web components, in a real browser", () => {
  let chrome: TestChrome;
  let server: Server;
  let base = "";
  const folder = mkdtempSync(path.join(tmpdir(), "jev-shadow-"));
  const resume = path.join(folder, "Resume.pdf");
  writeFileSync(resume, "%PDF-1.4\n% made up for a test\n");

  beforeAll(async () => {
    // No frame is loaded: the bot check's frame is named in the page and never fetched, so the test stays offline.
    server = createServer((req, res) => res.writeHead(200, { "content-type": "text/html", "content-security-policy": "frame-src 'none'" }).end(req.url === "/plain" ? PLAIN_PAGE : req.url === "/check" ? BOT_CHECK_PAGE : SHADOW_PAGE));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    chrome = await startChrome();
  }, 30_000);

  afterAll(async () => {
    await chrome?.close();
    await new Promise((resolve) => server?.close(resolve));
    rmSync(folder, { recursive: true, force: true });
  });

  it("reads every box inside the components, under its own label, and the Next button by its slotted word", async () => {
    const page = await chrome.tab();
    await goto(page, `${base}/apply`);
    const d = await dump(page);
    expect(d.fields.map((f) => [f.kind, f.label, f.required])).toEqual([
      ["file", "Choose an option to autocomplete your application. You can still fill your profile manually. (Choose a file or drop it here)", false],
      ["text", "First name", true],
      ["text", "Last name", true],
      ["email", "Email", true],
      ["combobox", "City", true],
      ["text", "LinkedIn", false],
      ["file", "Resume (Choose a file or drop it here)", true],
    ]);
    // Each box is found again through the components around it, by names that stay put: never a numbered id.
    expect(d.fields.every((f) => f.selector.includes(" >>> "))).toBe(true);
    expect(d.fields.some((f) => /spl-form-element_\d|file-input-\d/.test(f.selector))).toBe(false);
    expect(d.fields[1]!.selector).toBe("#first-name-input >>> #first-name-input");
    // The box that reads a resume to fill the form is not the application's resume.
    expect(d.fields.filter((f) => f.kind === "file").map((f) => fileBoxWants(f))).toEqual(["autofill", "resume"]);
    expect(pickNext(d.submitSelectors)?.text).toBe("Next");
    page.close();
  }, 60_000);

  it("fills the boxes so the form outside the components hears them, and reads them back", async () => {
    const page = await chrome.tab();
    await goto(page, `${base}/apply`);
    const d = await dump(page);
    const at = (label: string) => d.fields.find((f) => f.label === label)!.selector;
    const fills = [
      { selector: at("First name"), kind: "text", value: "Alex" },
      { selector: at("Email"), kind: "email", value: "alex@example.com" },
      { selector: at("City"), kind: "combobox", value: "Chicago, IL, US" },
    ];
    expect(await applyFills(page, fills, example)).toEqual([]);
    expect(await shownValues(page, fills.map((f) => f.selector))).toEqual(["Alex", "alex@example.com", "Chicago, IL, US"]);
    const heard = await page.evaluate<Record<string, string>>("window.heard");
    expect(heard["first-name-input"]).toBe("Alex");
    expect(heard["email-input"]).toBe("alex@example.com");
    page.close();
  }, 60_000);

  it("puts the resume on the file box inside a component", async () => {
    const page = await chrome.tab();
    await goto(page, `${base}/apply`);
    const box = (await dump(page)).fields.find((f) => f.label.startsWith("Resume"))!;
    expect(await uploadFile(page, box.selector, resume)).toBeUndefined();
    expect(await page.awj<boolean>("showsFile", "Resume.pdf")).toBe(true);
    page.close();
  }, 60_000);

  it("knows a bot check that stands before the form, and nothing else for one", async () => {
    const page = await chrome.tab();
    await goto(page, `${base}/check`);
    const d = await dump(page);
    expect(d.botCheck).toBe(true);
    expect(d.fields).toEqual([]);
    await goto(page, `${base}/apply`);
    expect((await dump(page)).botCheck).toBe(false);
    page.close();
  }, 60_000);

  it("leaves a cookie banner drawn in a shadow root out of a plain form", async () => {
    const page = await chrome.tab();
    await goto(page, `${base}/plain`);
    const d = await dump(page);
    expect(d.fields.map((f) => f.label)).toEqual(["Full name", "Email"]);
    expect(d.submitSelectors.some((s) => /Accept all/.test(s))).toBe(false);
    page.close();
  }, 60_000);
});

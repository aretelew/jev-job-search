/**
 * The dashboard page in a real Chrome, against a stand-in server with made-up records. It proves
 * the page draws its four screens, sends an answer with the token it was given, and offers
 * "remember" only for a question that may be kept. Skipped where Chrome is not installed.
 */
import { existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sleep } from "../src/browser/cdp.js";
import { BROWSER, DAILY } from "../src/config.js";
import { buildReport } from "../src/report/data.js";
import type { Needs } from "../src/report/needs.js";
import { reportPage } from "../src/report/page.js";
import { Level, Policy, Where } from "../src/run/policy.js";
import type { automation as automationOf } from "../src/report/server.js";
import type { LiveView } from "../src/run/live.js";
import { startChrome, type TestChrome } from "./helpers/chrome.js";

const TOKEN = "made-up-token-for-the-test";
const needs: Needs = {
  waiting: [{ id: "w1", company: "Globex", title: "Software Intern", todo: "type the code the board emailed you, then click Submit", reason: "the board emailed you a code", mail: "https://mail.google.com/mail/u/0/#search/greenhouse", open: true }],
  questions: [
    {
      id: "q1",
      company: "Acme",
      title: "Backend Intern",
      link: "https://jobs.example.com/acme/1",
      reason: "empty: Which team interests you most?",
      items: [
        { question: "Which team interests you most?", kind: "ask", options: ["Payments", "Platform"], canRemember: true, note: "" },
        { question: "Are you legally authorized to work in the United States?", kind: "profile", options: [], canRemember: false, note: "Your profile does not say this for the job's country." },
      ],
    },
  ],
  unconfirmed: [{ id: "u1", company: "Initech", title: "New Grad Engineer", link: "https://jobs.example.com/initech/2" }],
  mail: [{ id: "m1", from: "Hooli Careers", subject: "An update on your application", on: "2026-10-03", kind: null, why: "the tool could not tell what it says", jobs: [{ id: "h1", company: "Hooli", title: "SWE Intern" }] }],
};
const automation: ReturnType<typeof automationOf> = { running: true, stopAsked: false, policy: null, policyError: "", defaults: Policy.parse({}), choices: { where: Where.options, levels: Level.options, boards: ["ashby", "greenhouse"] }, limits: { maxTarget: DAILY.maxTarget, perBoard: DAILY.perBoard, perEmployerPerDay: DAILY.perEmployerPerDay, gapMinutes: [3, 6], maxMinutes: DAILY.maxMinutes }, schedule: { on: false, at: "09:00", next: null }, timezone: "America/Vancouver", today: [] };

const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
const liveJob = { board: "greenhouse", page: 1, startedAt: null, endedAt: null, outcome: null };
const live: LiveView = {
  state: "running",
  live: {
    pid: 4242,
    command: "apply --submit",
    startedAt: at(6),
    updatedAt: at(0),
    endedAt: null,
    activity: "Globex: Page 2: filling 6 fields",
    until: null,
    goal: null,
    jobs: [
      { ...liveJob, id: "j1", company: "Acme", title: "Backend Intern", step: "done", outcome: "applied", detail: "Sent. The page confirmed it", startedAt: at(6), endedAt: at(3) },
      { ...liveJob, id: "j2", company: "Globex", title: "Software Intern", step: "filling", page: 2, detail: "Page 2: filling 6 fields", startedAt: at(2) },
      { ...liveJob, id: "j3", company: "Initech", title: "New Grad Engineer", step: "waiting", detail: "Up next" },
    ],
    events: [
      { at: at(3), text: "Sent. The page confirmed it", tone: "good", job: "j1" },
      { at: at(1), text: "Page 2: filling 6 fields", tone: "info", job: "j2" },
    ],
  },
};

describe.skipIf(!existsSync(BROWSER.chromePath))("the dashboard page in a real browser", () => {
  let chrome: TestChrome;
  let server: Server;
  let origin = "";
  const posts: { path: string; token: string; body: unknown }[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      const send = (body: string, type = "application/json") => res.writeHead(200, { "content-type": type }).end(body);
      if (req.method === "POST") {
        let raw = "";
        req.on("data", (c: Buffer) => (raw += c.toString()));
        req.on("end", () => {
          posts.push({ path: req.url ?? "", token: String(req.headers["x-jev-token"] ?? ""), body: JSON.parse(raw) });
          send(JSON.stringify({ ok: true }));
        });
        return;
      }
      if (req.url === "/") return send(reportPage(null, TOKEN), "text/html; charset=utf-8");
      if (req.url === "/api/data") return send(JSON.stringify(buildReport([], [])));
      if (req.url === "/api/needs") return send(JSON.stringify(needs));
      if (req.url === "/api/automation") return send(JSON.stringify(automation));
      if (req.url === "/api/live") return send(JSON.stringify(live));
      res.writeHead(404).end();
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    chrome = await startChrome(["--window-size=1280,900"]);
  }, 30_000);

  afterAll(async () => {
    await chrome?.close();
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("draws its screens, and sends an answer with the token and only what was typed", async () => {
    const page = await chrome.tab();
    const errors: string[] = [];
    page.on("Runtime.exceptionThrown", (p) => void errors.push(JSON.stringify(p).slice(0, 300)));
    await page.navigate(origin);
    for (let i = 0; i < 40 && !(await page.evaluate<boolean>("!!document.querySelector('#nav [data-screen]')").catch(() => false)); i++) await sleep(150);
    expect(errors).toEqual([]);
    const nav = await page.evaluate<string[]>("[...document.querySelectorAll('#nav [data-screen]')].map((b) => b.textContent)");
    expect(nav).toEqual(["Overview", "Needs you", "Applications", "Daily run"]);
    expect(await page.evaluate<string>("document.querySelector('#nav').innerText")).toMatch(/Needs you\s*4/);
    // A run that is working shows on the overview: what it is on, how far it has come, and its latest steps.
    for (let i = 0; i < 30 && !(await page.evaluate<boolean>("!!document.querySelector('#live-run')")); i++) await sleep(100);
    const panel = await page.evaluate<string>("document.querySelector('#live-run').innerText");
    expect(panel).toMatch(/Applying now/);
    expect(panel).toMatch(/1\s*of 3 done/);
    expect(panel).toMatch(/Globex/);
    expect(panel).toMatch(/page 2/);
    expect(panel).toMatch(/Page 2: filling 6 fields/);
    expect(panel).toMatch(/1 sent/);
    expect(panel).toMatch(/1 up next/);
    expect(panel).not.toMatch(/Stop after this one/);
    // React reads a value only from the element's own setter followed by the event it listens for.
    const setValue = (selector: string, value: string, event = "input") =>
      page.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); const proto = Object.getPrototypeOf(el); Object.getOwnPropertyDescriptor(proto, "value").set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event(${JSON.stringify(event)}, { bubbles: true })); })()`);
    const click = async (selector: string) => {
      await page.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
      await sleep(150);
    };

    await click("[data-screen=needs]");
    const text = await page.evaluate<string>("document.querySelector('#s-needs').innerText");
    expect(text).toMatch(/Acme needs 2 answers/);
    expect(text).toMatch(/Globex: type the code the board emailed you/);
    expect(text).toMatch(/Initech/);
    expect(text).toMatch(/An update on your application/);
    // The work-authorization question has no answer box and no "remember": it is the profile's.
    expect(await page.evaluate<number>("document.querySelectorAll('[data-job=q1] [data-q]').length")).toBe(1);
    expect(await page.evaluate<number>("document.querySelectorAll('[data-job=q1] [data-keep]').length")).toBe(1);

    await setValue("[data-job=q1] select[data-q]", "Platform", "change");
    await click("[data-job=q1] [data-keep]");
    await click("[data-answer=q1]");
    for (let i = 0; i < 30 && !posts.length; i++) await sleep(100);
    expect(posts[0]).toEqual({ path: "/api/answer", token: TOKEN, body: { id: "q1", answers: [{ question: "Which team interests you most?", answer: "Platform", remember: true }] } });

    await click("[data-screen=daily]");
    const auto = await page.evaluate<string>("document.querySelector('#s-daily').innerText");
    expect(auto).toMatch(/Apply automatically/);
    expect(auto).toMatch(/Save your daily rules first/);
    expect(auto).toMatch(/Your computer has to be on/);
    // The switch cannot be turned on before there are rules.
    expect(await page.evaluate<boolean>("document.querySelector('#autoOn').disabled")).toBe(true);
    await setValue("#pTarget", "7");
    await setValue("#pExclude", "Acme, Globex");
    await sleep(100);
    await click("#pSave");
    for (let i = 0; i < 30 && posts.length < 2; i++) await sleep(100);
    expect(posts[1]).toMatchObject({ path: "/api/policy", token: TOKEN, body: { target: 7, excludeEmployers: ["Acme", "Globex"], where: [], documents: { tailor: false, cover: false } } });
    expect(Policy.safeParse(posts[1]?.body).success).toBe(true);
    // The answer button says what it does: nothing is sent now.
    expect(text).toMatch(/Save for next run/);
    expect(text).not.toMatch(/and continue/);
    // A run that is working can be asked to stop, apart from pausing the schedule.
    expect(auto).toMatch(/A run is working now/);
    expect(auto).toMatch(/JEV only/);
    await click("#autoStop");
    for (let i = 0; i < 30 && posts.length < 3; i++) await sleep(100);
    expect(posts[2]).toMatchObject({ path: "/api/stop", token: TOKEN });
    // A status set from the page carries the status the page was showing.
    await click("[data-screen=needs]");
    await click("[data-set=u1][data-to=applied]");
    for (let i = 0; i < 30 && posts.length < 4; i++) await sleep(100);
    expect(posts[3]).toEqual({ path: "/api/status", token: TOKEN, body: { id: "u1", status: "applied", was: "submission_unknown" } });
    expect(errors).toEqual([]);
    page.close();
  }, 60_000);
});

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { preFilter } from "../src/jobs/hardFilters.js";
import { canonicalUrl, dedupe, jobId, postingKey, type Job } from "../src/jobs/normalize.js";
import { entryFor, foldSameJob, loadQueue, type QueueEntry } from "../src/jobs/queue.js";
import { isShortLink, useShortLinkStore } from "../src/jobs/shortLinkStore.js";
import { compactRows, emptyRow } from "../src/log/csv.js";
import { resolveShortLink, resolveShortLinks } from "../src/sources/shortLinks.js";

// Made-up paths on the shortener the config names; nothing here reaches the network.
const SHORT = "https://go.vansh.nyc";
const job = (url: string, over: Partial<Job> = {}): Job => {
  const u = canonicalUrl(url);
  return { id: jobId(u), source: "list", company: "Acme", title: "Software Engineer Intern", url: u, ats: "other", locations: ["Austin, TX"], postedAt: null, terms: ["Summer 2027"], sponsorship: "unknown", degrees: [], category: null, ...over };
};
let memory: Map<string, string>;
beforeEach(() => {
  memory = new Map();
  useShortLinkStore({ get: (k) => memory.get(k), set: (k, v) => void memory.set(k, v), save: () => {} });
});
afterEach(() => useShortLinkStore(null));

describe("short links from job lists", () => {
  it("knows a short link by its host", () => {
    expect(isShortLink(`${SHORT}/1C6?s=y`)).toBe(true);
    expect(isShortLink("https://job-boards.greenhouse.io/acme/jobs/8360478")).toBe(false);
  });

  it("makes a posting listed through a short link and listed directly one job", async () => {
    const viaList = job(`${SHORT}/1C6?s=y`);
    const direct = job("https://job-boards.greenhouse.io/acme/jobs/8360478", { source: "greenhouse:acme", ats: "greenhouse" });
    const { jobs, resolved } = await resolveShortLinks([viaList, direct], async () => "https://careers.acme.example/positions/8360478?gh_jid=8360478");
    expect(resolved).toBe(1);
    expect(jobs[0]?.id).toBe(direct.id);
    expect(jobs[0]?.ats).toBe("greenhouse");
    expect(dedupe(jobs)).toHaveLength(1);
  });

  it("shows the real job board, so a board the tool cannot fill is set aside before it is queued", async () => {
    const { jobs } = await resolveShortLinks([job(`${SHORT}/1DM?s=y`)], async () => "https://jobs.smartrecruiters.com/acme/3743990016985486");
    expect(jobs[0]?.ats).toBe("smartrecruiters");
    expect(preFilter(jobs[0] as Job, new Date("2026-11-25T12:00:00Z"), () => false)).toMatch(/cannot be read/);
  });

  it("looks each link up once", async () => {
    let calls = 0;
    const redirect = async () => {
      calls++;
      return "https://jobs.lever.co/acme/0b6f1c1e-1111-4222-8333-944455556666";
    };
    const viaList = job(`${SHORT}/9Q?s=y`);
    await resolveShortLinks([viaList, { ...viaList, source: "other-list" }], redirect);
    await resolveShortLinks([viaList], redirect);
    expect(calls).toBe(1);
  });

  it("follows a short link to another short link, but takes only a web address", async () => {
    const hops: Record<string, string> = { [`${SHORT}/a`]: `${SHORT}/b`, [`${SHORT}/b`]: "https://jobs.ashbyhq.com/acme/0b6f1c1e-1111-4222-8333-944455556666" };
    expect(await resolveShortLink(`${SHORT}/a`, async (u) => hops[u] ?? null)).toMatch(/ashbyhq/);
    expect(await resolveShortLink(`${SHORT}/x`, async () => "javascript:alert(1)")).toBeNull();
    // A shortener that only ever points at itself never resolves.
    expect(await resolveShortLink(`${SHORT}/x`, async () => `${SHORT}/x`)).toBeNull();
  });

  it("leaves out a job whose link cannot be resolved now, so it never gets a second identity later", async () => {
    const failing = async () => {
      throw new Error("429");
    };
    const { jobs, dropped } = await resolveShortLinks([job(`${SHORT}/gone`), job("https://jobs.ashbyhq.com/acme/0b6f1c1e-1111-4222-8333-944455556666")], failing);
    expect(dropped).toBe(1);
    expect(jobs).toHaveLength(1);
    expect(memory.size).toBe(0);
  });

  it("makes the two link forms of one Workable job one job", () => {
    expect(job("https://apply.workable.com/j/F0E122E877").id).toBe(job("https://apply.workable.com/acme-health-1/j/F0E122E877").id);
    expect(job("https://apply.workable.com/j/F0E122E877").id).not.toBe(job("https://apply.workable.com/j/F0E122E878").id);
  });
});

describe("a job applied to under its short link", () => {
  const target = "https://careers.acme.example/positions/5290917007?gh_jid=5290917007";
  const entry = (url: string, status: QueueEntry["status"], updatedAt: string, answers: QueueEntry["answers"] = []): QueueEntry => ({ ...entryFor(job(url), null, null), status, answers, updatedAt });

  it("is the same posting as its target once the target is known", () => {
    memory.set(`${SHORT}/1DJ?s=y`, target);
    expect(postingKey(`${SHORT}/1DJ?s=y`)).toBe(postingKey(target));
  });

  it("stays applied when the same posting is queued again at its real address", () => {
    memory.set(`${SHORT}/1DJ?s=y`, target);
    const dir = mkdtempSync(path.join(tmpdir(), "jev-queue-"));
    const file = path.join(dir, "queue.json");
    const applied = entry(`${SHORT}/1DJ?s=y`, "applied", "2026-11-25T05:00:00.000Z", [{ question: "Q1", answer: "A1" }]);
    const twin = entry(target, "queued", "2026-11-26T05:00:00.000Z", [{ question: "Q2", answer: "A2" }]);
    writeFileSync(file, JSON.stringify({ version: 1, generatedAt: "2026-11-26T05:00:00.000Z", entries: [twin, applied] }));
    try {
      const q = loadQueue(file);
      expect(q.entries).toHaveLength(1);
      expect(q.entries[0]?.status).toBe("applied");
      expect(q.entries[0]?.answers.map((a) => a.question).sort()).toEqual(["Q1", "Q2"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps the newer of two entries that are equally settled", () => {
    const a = entry(target, "queued", "2026-11-25T05:00:00.000Z");
    const b = entry(target, "queued", "2026-11-26T05:00:00.000Z");
    expect(foldSameJob([a, b])[0]?.updatedAt).toBe(b.updatedAt);
  });

  it("has one row in the records", () => {
    memory.set(`${SHORT}/1DJ?s=y`, target);
    const rows = compactRows([{ ...emptyRow(), "Job Link": `${SHORT}/1DJ?s=y`, "App. Status": "Applied" }, { ...emptyRow(), "Job Link": target, "App. Status": "Queued" }]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["App. Status"]).toBe("Applied");
  });
});

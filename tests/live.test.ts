import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPORT } from "../src/config.js";
import { entryFor, type QueueEntry } from "../src/jobs/queue.js";
import type { Job } from "../src/jobs/normalize.js";
import { beginLive, endLive, liveActivity, liveDone, liveGoal, liveJobs, liveNote, liveRecorded, liveStep, liveView, outcomeOfStatus, readLive } from "../src/run/live.js";

const file = () => path.join(mkdtempSync(path.join(tmpdir(), "jev-live-")), "live.json");
const job = (n: number): Job => ({ id: `id${n}`, source: "t", company: `Co${n}`, title: "Intern", url: `https://boards.greenhouse.io/co${n}/jobs/${n}`, ats: "greenhouse", locations: [], postedAt: "2026-10-01", terms: [], sponsorship: "unknown", degrees: [], category: null });
const fit = { score: 0.5, decision: "apply" as const, skipReason: null, reasons: [], components: {}, locationTier: "canada" as const, answers: {} };
const entry = (n: number): QueueEntry => entryFor(job(n), fit as never, null);
const me = { pid: process.pid, command: "apply --submit", startedAt: new Date().toISOString() };

describe("the live record of a run", () => {
  it("writes nothing unless this process began a run", () => {
    const f = file();
    liveJobs([entry(1)]);
    liveStep("id1", "filling", "Page 1: filling 4 fields");
    liveActivity("Looking for jobs");
    expect(existsSync(f)).toBe(false);
  });

  it("follows each job from waiting to its ending, and keeps the file when the run ends", () => {
    const f = file();
    beginLive("apply --submit", f);
    liveJobs([entry(1), entry(2)]);
    let live = readLive(f)!;
    expect(live.jobs.map((j) => [j.id, j.step, j.startedAt])).toEqual([
      ["id1", "waiting", null],
      ["id2", "waiting", null],
    ]);
    liveStep("id1", "filling", "Page 2: filling 6 fields", 2);
    live = readLive(f)!;
    expect(live.jobs[0]).toMatchObject({ step: "filling", page: 2, detail: "Page 2: filling 6 fields" });
    expect(live.jobs[0]!.startedAt).not.toBeNull();
    expect(live.activity).toBe("Co1: Page 2: filling 6 fields");

    // Submit is clicked: the job is unconfirmed until the confirmation, then sent.
    liveRecorded("id1", "submission_unknown", "Submit was clicked and no confirmation was seen");
    expect(readLive(f)!.jobs[0]).toMatchObject({ step: "done", outcome: "unconfirmed" });
    liveRecorded("id1", "applied", null);
    liveRecorded("id2", "needs_review", "the form asks for a signature");
    // A job put back in the queue is not an ending.
    liveRecorded("id2", "queued", null);
    live = readLive(f)!;
    expect(live.jobs.map((j) => [j.outcome, j.detail])).toEqual([
      ["applied", "Sent. The page confirmed it"],
      ["left", "Left for you: the form asks for a signature"],
    ]);
    expect(live.endedAt).toBeNull();
    endLive();
    live = readLive(f)!;
    expect(live.endedAt).not.toBeNull();
    expect(live.events.at(-1)?.text).toBe("Finished");
    // Once ended, nothing more is written.
    liveStep("id1", "filling", "late");
    expect(readLive(f)!.jobs[0]!.detail).toBe("Sent. The page confirmed it");
  });

  it("takes a job up again after an ending only when it is worked on, not when it is set to wait", () => {
    const f = file();
    beginLive("resume", f);
    liveJobs([entry(1)]);
    liveDone("id1", "waiting", "Not done yet");
    liveStep("id1", "waiting", "Up next");
    expect(readLive(f)!.jobs[0]).toMatchObject({ step: "done", outcome: "waiting" });
    liveStep("id1", "opening", "Opening the form");
    expect(readLive(f)!.jobs[0]).toMatchObject({ step: "opening", outcome: null, endedAt: null });
    endLive();
  });

  it("keeps a secret out of the file and keeps only the latest steps", () => {
    const f = file();
    beginLive("daily", f);
    liveJobs([entry(1)]);
    liveRecorded("id1", "blocked", "the page went to https://example.com/next?token=abc123secret&x=1");
    for (let i = 0; i < REPORT.liveEvents + 20; i++) liveNote(`line ${i}`);
    liveGoal(5, 2);
    const text = readFileSync(f, "utf8");
    expect(text).not.toContain("abc123secret");
    const live = readLive(f)!;
    expect(live.events).toHaveLength(REPORT.liveEvents);
    expect(live.events.at(-1)?.text).toBe(`line ${REPORT.liveEvents + 19}`);
    expect(live.goal).toEqual({ target: 5, done: 2 });
    endLive();
  });

  it("names every ending a run records", () => {
    expect(outcomeOfStatus("awaiting_user_action", "the board emailed you a code")?.outcome).toBe("waiting");
    expect(outcomeOfStatus("login_required", null)?.outcome).toBe("left");
    expect(outcomeOfStatus("skipped", "the board refused")?.detail).toBe("Skipped: the board refused");
    expect(outcomeOfStatus("in_progress", null)).toBeNull();
  });
});

describe("what the page is told", () => {
  it("says running only while the run lock names the process that wrote the file", () => {
    const f = file();
    beginLive("apply --submit", f);
    expect(liveView({ file: f, run: me }).state).toBe("running");
    expect(liveView({ file: f, run: null }).state).toBe("stopped");
    expect(liveView({ file: f, run: { ...me, pid: process.pid + 1 } }).state).toBe("stopped");
    endLive();
    expect(liveView({ file: f, run: me }).state).toBe("ended");
  });

  it("forgets a run that ended long ago, and a file it cannot read", () => {
    const f = file();
    beginLive("apply", f);
    endLive();
    const later = new Date(Date.now() + (REPORT.lastRunHours + 1) * 60 * 60_000);
    expect(liveView({ file: f, run: null, at: later })).toEqual({ state: "none", live: null });
    writeFileSync(f, "{ not json");
    expect(liveView({ file: f, run: null })).toEqual({ state: "none", live: null });
    expect(liveView({ file: path.join(path.dirname(f), "missing.json"), run: null }).state).toBe("none");
  });
});

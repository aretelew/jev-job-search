import { describe, expect, it, vi } from "vitest";
import { limiter, paced, spacer } from "../src/util/pace.js";

const tick = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe("limiter", () => {
  it("never runs more than n pieces of work at once, and runs them all", async () => {
    const limit = limiter(2);
    let active = 0;
    let most = 0;
    const done: number[] = [];
    await Promise.all(
      [1, 2, 3, 4, 5].map((n) =>
        limit(async () => {
          active++;
          most = Math.max(most, active);
          await tick(5);
          active--;
          done.push(n);
        }),
      ),
    );
    expect(most).toBe(2);
    expect(done.sort()).toEqual([1, 2, 3, 4, 5]);
  });
  it("keeps going after a piece of work fails", async () => {
    const limit = limiter(1);
    await expect(limit(async () => Promise.reject(new Error("no")))).rejects.toThrow("no");
    expect(await limit(async () => "ok")).toBe("ok");
  });
});

describe("spacer", () => {
  it("leaves a pause between two pieces of work for the same site, and none between different sites", async () => {
    vi.useFakeTimers();
    const spaced = spacer(1000);
    const started: string[] = [];
    const work = (name: string) => async () => {
      started.push(name);
    };
    const all = Promise.all([spaced("a.com", work("a1")), spaced("a.com", work("a2")), spaced("b.com", work("b1"))]);
    await vi.advanceTimersByTimeAsync(10);
    expect(started.sort()).toEqual(["a1", "b1"]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(started).toContain("a2");
    await all;
    vi.useRealTimers();
  });
  it("leaves no timer behind after the last piece of work, so a command can exit the moment it is done", async () => {
    vi.useFakeTimers();
    const spaced = spacer(8 * 60_000);
    await spaced("lucid", async () => "sent");
    // The pause is owed only to a next submission. Nothing is waiting for one, so nothing may hold the process open.
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });
  it("waits only for what is left of the pause when the next piece of work comes later", async () => {
    vi.useFakeTimers();
    const spaced = spacer(1000);
    const started: number[] = [];
    await spaced("a.com", async () => started.push(Date.now()));
    await vi.advanceTimersByTimeAsync(600);
    const next = spaced("a.com", async () => started.push(Date.now()));
    await vi.advanceTimersByTimeAsync(399);
    expect(started).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await next;
    expect((started[1] as number) - (started[0] as number)).toBe(1000);
    vi.useRealTimers();
  });
  it("never waits longer than one pause, even when the clock is set back", async () => {
    vi.useFakeTimers();
    const spaced = spacer(1000);
    await spaced("a.com", async () => "one");
    vi.setSystemTime(Date.now() - 3_600_000);
    let ran = false;
    const next = spaced("a.com", async () => void (ran = true));
    await vi.advanceTimersByTimeAsync(1000);
    expect(ran).toBe(true);
    await next;
    vi.useRealTimers();
  });
  it("still lets the next one run when the one before it failed", async () => {
    const spaced = spacer(1);
    await expect(spaced("a.com", async () => Promise.reject(new Error("no")))).rejects.toThrow("no");
    expect(await spaced("a.com", async () => "ok")).toBe("ok");
  });
});

describe("paced", () => {
  it("returns results in the order of the items, whatever order they finish in", async () => {
    const out = await paced([30, 5, 15], (n) => `site-${n}.example`, async (n) => {
      await tick(n);
      return n * 2;
    });
    expect(out).toEqual([60, 10, 30]);
  });
});

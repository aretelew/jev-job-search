/**
 * A headless Chrome of its own for a browser test: a fresh profile in a temporary folder, its
 * debugging port on this machine only, started with childEnv() like every child process.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { Page, sleep, type Target } from "../../src/browser/cdp.js";
import { BROWSER, childEnv } from "../../src/config.js";

export type TestChrome = {
  /** A new tab, attached. */
  tab: () => Promise<Page>;
  close: () => Promise<void>;
};

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });

export async function startChrome(): Promise<TestChrome> {
  const port = await freePort();
  const profile = mkdtempSync(path.join(tmpdir(), "jev-chrome-"));
  const chrome = spawn(BROWSER.chromePath, ["--headless=new", `--remote-debugging-port=${port}`, "--remote-debugging-address=127.0.0.1", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore", env: childEnv() });
  const close = async () => {
    chrome.kill();
    await sleep(300);
    rmSync(profile, { recursive: true, force: true });
  };
  for (let i = 0; i < 80; i++) {
    if (await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.ok, () => false)) {
      const tab = async () => Page.attach((await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json()) as Target);
      return { tab, close };
    }
    await sleep(250);
  }
  await close();
  throw new Error("headless Chrome did not start");
}

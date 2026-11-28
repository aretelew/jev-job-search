/**
 * One temporary folder for a whole test run, removed when the run ends. Vitest runs this once,
 * before it starts any worker, and points the system's temporary folder (TMPDIR, and TEMP and TMP
 * on Windows) into it. The workers inherit that, so every folder a test makes under `tmpdir()`
 * lands inside, and so does whatever a child process writes there.
 *
 * A run that was killed cannot remove its own folder. The next run removes it, once the vitest
 * whose process id it carries is gone, so two runs at once leave each other alone.
 */
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const PREFIX = "jev-tests-";

function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

export default function setup(): () => void {
  const base = tmpdir();
  for (const name of readdirSync(base).filter((n) => n.startsWith(PREFIX))) {
    const pid = Number(name.slice(PREFIX.length));
    if (Number.isInteger(pid) && !running(pid)) rmSync(path.join(base, name), { recursive: true, force: true });
  }
  const root = path.join(base, `${PREFIX}${process.pid}`);
  mkdirSync(root, { recursive: true });
  for (const name of ["TMPDIR", "TEMP", "TMP"]) process.env[name] = root;
  return () => rmSync(root, { recursive: true, force: true });
}

/**
 * Ends a test worker whose vitest has gone. A worker is a forked process that talks to vitest over
 * an IPC channel. When vitest is killed, that channel closes but a worker in the middle of a test
 * keeps running, holding its memory and, through it, the Chrome the test started
 * (`tests/helpers/chrome.ts`). Nobody is left to read its results, so it stops itself.
 *
 * Vitest stops its workers with SIGTERM at the end of a normal run, so this does not fire then.
 * `process.exit` is vitest's own inside a test, so the worker sends itself SIGTERM instead.
 */
const marker = Symbol.for("jev.endOrphanedWorker");
const state = globalThis as { [marker]?: true };

if (process.send && !state[marker]) {
  state[marker] = true;
  process.once("disconnect", () => process.kill(process.pid, "SIGTERM"));
}

/**
 * The dashboard page. It is built from web/ (React and shadcn) into one HTML file with its
 * script, style and font inline, committed at src/report/web/index.html, so running the tool
 * needs no build and the page fetches nothing beyond the server it came from. This file only
 * writes into it what the page is given: the token that lets it send a change back, the
 * statuses it offers, and, for a snapshot a person keeps, the data itself.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Report } from "./data.js";
import { REPORT } from "../config.js";
import { LEFT_FOR_YOU } from "./data.js";

const BUILT = fileURLToPath(new URL("./web/index.html", import.meta.url));
const SLOT = "<!--jev-boot-->";

/** Read on every request: it is one local file, and a rebuilt page then shows on reload. */
function shell(): string {
  const built = readFileSync(BUILT, "utf8");
  if (!built.includes(SLOT)) throw new Error(`${BUILT} has no ${SLOT}: rebuild it with npm run build in web/`);
  return built;
}

/** The page. With a snapshot it is a file to keep, read-only. Without one it is live, and `token` is what lets it send a change back. */
export function reportPage(snapshot: Report | null, token = ""): string {
  const boot = { token, statuses: REPORT.statuses, left: LEFT_FOR_YOU, snapshot };
  // Inside a script element only "<" can end it early, so every one is escaped.
  const tag = `<script id="data" type="application/json">${JSON.stringify(boot).replace(/</g, "\\u003c")}</script>`;
  // A function, so a "$" in the data is never read as a replacement pattern.
  return shell().replace(SLOT, () => tag);
}

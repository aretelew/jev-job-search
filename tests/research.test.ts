import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildPrompt, codexArgs, researchClaudeArgs, researchCodexArgs } from "../src/answers/resolve.js";
import { companyNotes, notesFile, parseFacts, researchInput, wantsResearch } from "../src/answers/research.js";
import type { OpenField } from "../src/answers/memory.js";
import type { QueueEntry } from "../src/jobs/queue.js";

const field = (over: Partial<OpenField>): OpenField => ({ selector: "#q", kind: "text", label: "", question: "", hint: "", required: true, maxLength: null, options: [], why: "", ...over });

const entry = (company = "Example Co") =>
  ({ job: { id: "j1", company, title: "Software Engineer Intern", url: "https://jobs.example.com/1?utm_source=x", description: "We build example things.", locations: [] } }) as unknown as QueueEntry;

describe("when the writer gets facts about the company", () => {
  it("for an open question, and not for a short box that asks for something else", () => {
    expect(wantsResearch([field({ kind: "textarea", label: "Anything else?" })])).toBe(true);
    expect(wantsResearch([field({ label: "Why do you want to work here?", maxLength: 255 })])).toBe(true);
    expect(wantsResearch([field({ label: "Which part of our product would you work on?" })])).toBe(true);
    expect(wantsResearch([field({ label: "LinkedIn profile" })])).toBe(false);
    expect(wantsResearch([field({ kind: "select", label: "Why are you leaving?", options: ["a", "b"] })])).toBe(false);
  });
});

describe("the research call", () => {
  it("is told the company and the posting, and nothing else", () => {
    const sent = JSON.parse(researchInput(entry())) as Record<string, unknown>;
    expect(Object.keys(sent).sort()).toEqual(["company", "job_title", "posting_excerpt", "posting_url"]);
    expect(sent.posting_url).toBe("https://jobs.example.com/1");
  });

  it("runs Codex exactly as the writer does, with only web search turned on", () => {
    const writer = codexArgs("low", "m1");
    const research = researchCodexArgs("low", "m1");
    expect(research).toContain("web_search=live");
    expect(research).not.toContain("web_search=disabled");
    expect(research.filter((a) => a !== "web_search=live")).toEqual(writer.filter((a) => a !== "web_search=disabled"));
    expect(research).toContain("features.shell_tool=false");
  });

  it("gives Claude Code web search and page reading and no other tool", () => {
    const args = researchClaudeArgs("m", "low", ["--system-prompt", "rules"]);
    const at = args.indexOf("--tools");
    expect(args[at + 1]).toBe("WebSearch,WebFetch");
    expect(args[args.indexOf("--allowedTools") + 1]).toBe("WebSearch,WebFetch");
    expect(args).toContain("--strict-mcp-config");
  });
});

describe("the facts that come back", () => {
  it("keep only short facts that cite a web page, once each", () => {
    const long = "x".repeat(400);
    const reply = `Here you go: {"facts": [
      {"fact": "Their ingest  service is written in Rust.", "source": "https://blog.example.com/rust?ref=1"},
      {"fact": "Their ingest service is written in Rust.", "source": "https://other.example.com"},
      {"fact": "No source here.", "source": "my memory"},
      {"fact": "Local file.", "source": "file:///etc/passwd"},
      {"fact": "${long}", "source": "https://blog.example.com/long"}
    ]}`;
    expect(parseFacts(reply)).toEqual([{ fact: "Their ingest service is written in Rust.", source: "https://blog.example.com/rust" }]);
  });

  it("are none when the reply cannot be read", () => {
    expect(parseFacts("no json at all")).toEqual([]);
    expect(parseFacts("{not json}")).toEqual([]);
    expect(parseFacts(`{"facts": "nope"}`)).toEqual([]);
  });

  it("go to the writer in the form's prompt, and are left out when there are none", () => {
    const facts = [{ fact: "They run on Postgres.", source: "https://example.com" }];
    expect(JSON.parse(buildPrompt(entry(), [], [], { notes: facts })).company_notes).toEqual(facts);
    expect("company_notes" in JSON.parse(buildPrompt(entry(), [], []))).toBe(false);
  });
});

describe("the company cache", () => {
  const reply = JSON.stringify({ facts: [{ fact: "They shard by tenant.", source: "https://example.com/a" }] });

  it("searches once per company and reads the file after", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "jev-research-"));
    let calls = 0;
    const research = async () => {
      calls += 1;
      return reply;
    };
    const [a, b] = await Promise.all([companyNotes(entry(), research, { dir }), companyNotes(entry(" example co "), research, { dir })]);
    expect(calls).toBe(1);
    expect(a).toEqual(b);
    expect(await companyNotes(entry(), research, { dir })).toEqual(a);
    expect(calls).toBe(1);
    expect(JSON.parse(readFileSync(notesFile("Example Co", dir), "utf8")).facts).toHaveLength(1);
  });

  it("searches again once the facts are old, sooner when the last search found nothing", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "jev-research-"));
    const day = 86_400_000;
    const file = notesFile("Example Co", dir);
    let calls = 0;
    const research = async () => {
      calls += 1;
      return reply;
    };
    writeFileSync(file, JSON.stringify({ company: "Example Co", researchedAt: new Date(0).toISOString(), facts: [] }));
    await companyNotes(entry(), research, { dir, now: 2 * day });
    expect(calls).toBe(0);
    await companyNotes(entry(), research, { dir, now: 4 * day });
    expect(calls).toBe(1);
    await companyNotes(entry(), research, { dir, now: 33 * day });
    expect(calls).toBe(1);
    await companyNotes(entry(), research, { dir, now: 35 * day });
    expect(calls).toBe(2);
  });

  it("leaves the writer with the posting alone when the search fails, and does not remember the failure", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "jev-research-"));
    expect(await companyNotes(entry(), async () => Promise.reject(new Error("offline")), { dir })).toEqual([]);
    expect(await companyNotes(entry(), async () => reply, { dir })).toHaveLength(1);
  });
});

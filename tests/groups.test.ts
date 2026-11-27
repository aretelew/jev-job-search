import { describe, expect, it } from "vitest";
import { capOf, capTicks } from "../src/forms/groups.js";
import type { DumpedField, PlannedField } from "../src/forms/fields.js";

const QUESTION = "Which part of the tech stack are you most interested in working in? (Please ONLY select up to 3 choices)";
const box = (id: string, label: string, over: Partial<DumpedField> = {}): DumpedField => ({ id, widget: "", selector: `#${id}`, kind: "checkbox", name: "cards[x][field8]", label, hint: "", placeholder: "", required: true, value: "", options: [], accept: "", maxLength: null, autocomplete: "", buttonGroup: false, section: QUESTION, ...over });
const plan = (f: DumpedField, action: PlannedField["action"], confidence: number): PlannedField => ({ id: f.id, selector: f.selector, kind: f.kind, label: f.label, required: f.required, optionLabel: null, action, key: action === "fill" ? "checked" : action === "skip" ? "unchecked" : "unknown", value: action === "fill" ? "true" : null, confidence, note: null });
const ticked = (ps: PlannedField[]) => ps.filter((p) => p.action === "fill").map((p) => p.label);

describe("how many a question takes", () => {
  it("reads the limit inside a longer question", () => {
    expect(capOf(QUESTION)).toBe(3);
    expect(capOf("Which offices could you work from?")).toBeNull();
  });
});

describe("a group of tick boxes with a limit", () => {
  const fields = [box("f1", "Front-end"), box("f2", "Back-end"), box("f3", "Full-stack"), box("f4", "Mobile"), box("f5", "DevOps"), box("f6", "Performance")];
  const [front, back, full, mobile, devops, perf] = fields as [DumpedField, DumpedField, DumpedField, DumpedField, DumpedField, DumpedField];

  it("keeps the ticks JEV is surest of and leaves the rest unticked with the reason", () => {
    const out = capTicks([plan(front, "fill", 0.78), plan(back, "fill", 0.92), plan(full, "fill", 0.93), plan(mobile, "skip", 0.88), plan(devops, "fill", 0.74), plan(perf, "skip", 0.74)], fields);
    expect(ticked(out)).toEqual(["Front-end", "Back-end", "Full-stack"]);
    expect(out[4]).toMatchObject({ action: "skip", key: "unchecked", value: null, note: "left unticked: the question takes at most 3" });
  });

  it("keeps the first on the form when two are as sure", () => {
    const out = capTicks([plan(front, "fill", 0.9), plan(back, "fill", 0.9), plan(full, "fill", 0.9), plan(mobile, "fill", 0.9), plan(devops, "skip", 0.9), plan(perf, "skip", 0.9)], fields);
    expect(ticked(out)).toEqual(["Front-end", "Back-end", "Full-stack"]);
  });

  it("leaves an unsure box unticked once the group is full, and asks about it while there is room", () => {
    const full3 = capTicks([plan(front, "fill", 0.8), plan(back, "fill", 0.8), plan(full, "fill", 0.8), plan(mobile, "skip", 0.8), plan(devops, "review", 0.6), plan(perf, "skip", 0.8)], fields);
    expect(full3[4]).toMatchObject({ action: "skip", note: "left unticked: the question takes at most 3" });
    const room = capTicks([plan(front, "fill", 0.8), plan(back, "fill", 0.8), plan(full, "skip", 0.8), plan(mobile, "skip", 0.8), plan(devops, "review", 0.6), plan(perf, "skip", 0.8)], fields);
    expect(room[4]?.action).toBe("review");
  });

  it("changes nothing for a group whose question gives no limit, or a box on its own", () => {
    const open = fields.map((f) => ({ ...f, section: "Which part of the tech stack interests you?" }));
    const planned = open.map((f) => plan(f, "fill", 0.9));
    expect(capTicks(planned, open)).toEqual(planned);
    const alone = box("f9", "I agree to the terms", { name: "agree", section: "Up to 2 business days for a reply" });
    const p = plan(alone, "fill", 0.9);
    expect(capTicks([p], [alone])).toEqual([p]);
  });
});

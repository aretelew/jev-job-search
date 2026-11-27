/**
 * Questions that say how many answers they take: "select up to 3", "your top 2". A list question
 * gets that many items, and a group of tick boxes gets no more ticks than it allows.
 */
import { checkboxGroups, type DumpedField, type PlannedField } from "./fields.js";

/** A question that says how many it takes: "up to 3", "no more than two", "your top 3". */
const CAP = /\b(?:up to|at most|no more than|maximum(?: of)?|max\.?|a limit of|your top|top)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/i;
const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

/** How many choices the question allows, when it says. */
export function capOf(text: string): number | null {
  const m = CAP.exec(text);
  if (!m?.[1]) return null;
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : (WORDS[m[1].toLowerCase()] ?? 0);
  return n > 0 ? n : null;
}

/**
 * The plan with each group of tick boxes held to the number its question allows: the ticks JEV is
 * surest of are kept, in a tie the first on the form. Once a group is full, a box JEV was unsure of
 * is left unticked too, since ticking it could only break the limit.
 */
export function capTicks(planned: PlannedField[], fields: DumpedField[]): PlannedField[] {
  const groups = checkboxGroups(fields);
  const questions = new Map<string, string>();
  for (const f of fields) {
    const group = groups.get(f.selector);
    if (group && !questions.has(group)) questions.set(group, `${f.section} ${f.hint}`);
  }
  const dropped = new Map<string, number>();
  for (const [group, question] of questions) {
    const cap = capOf(question);
    if (cap === null) continue;
    const boxes = planned.filter((p) => p.kind === "checkbox" && groups.get(p.selector) === group);
    const ticked = boxes.filter((p) => p.action === "fill").sort((a, b) => b.confidence - a.confidence);
    const unsure = ticked.length >= cap ? boxes.filter((p) => p.action === "review") : [];
    for (const p of [...ticked.slice(cap), ...unsure]) dropped.set(p.id, cap);
  }
  return planned.map((p) => {
    const cap = dropped.get(p.id);
    return cap === undefined ? p : { ...p, action: "skip", key: "unchecked", value: null, note: `left unticked: the question takes at most ${cap}` };
  });
}

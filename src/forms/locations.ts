/**
 * Questions that ask which of the employer's places the candidate would work at: a group of offices
 * to tick, one office to pick, or a dropdown that takes several. JEV places each option with one
 * typed question (a city in a country the candidate may work in, a region inside them, remote,
 * somewhere else, not a place) and code chooses from those answers:
 *
 * - where several may be chosen, every city and region the candidate may work in, up to the
 *   number the question allows. A remote option only when no city or region qualifies. Never
 *   "none of the above".
 * - where only one may be chosen, the posting's own city, then the profile's `preferredOffices` in
 *   order, then the first that qualifies in the form's order.
 *
 * Only for a candidate whose profile says they will relocate: anyone else is asked as before.
 */
import { FORM } from "../config.js";
import { choice } from "../jev/questions.js";
import type { JevClient } from "../jev/client.js";
import type { Answer, Questions } from "../jev/types.js";
import type { Job } from "../jobs/normalize.js";
import type { Profile } from "../profile/schema.js";
import { checkboxGroups, type DumpedField, type PlannedField } from "./fields.js";

/** A word for one of the employer's places. "Located" is not one: "where are you located" asks where the person lives. */
const PLACE_WORD = /\b(?:locations?|offices?|cit(?:y|ies)|sites?|hubs?|campus(?:es)?|metro areas?)\b/i;
/** Words that make it a choice among the employer's places. */
const ASKS_CHOICE = /\b(?:which|select|choose|pick|prefer(?:red|ence|ences)?|interested|open to|willing|could you|can you|would you|able to|appl(?:y|ying) (?:to|for)|work (?:from|at|in|out of)|report to|relocate to|all that apply)\b/i;
/** A question about the person, or about how they heard of the job, that happens to name a place. */
const NOT_A_PLACE_CHOICE = /\byour (?:current |home )?location\b|\bcurrently (?:live|living|located|based|resid)|\bwhere (?:do )?you (?:live|are (?:currently )?(?:located|based))|\bresid|\bhear\b|\bheard\b|\bsource\b|\breferr|\bweb ?site\b|\bjob site\b|\bsocial\b/i;
/** A name for the employer's places that is a choice on its own: "Office location", "Work locations". */
const WORK_PLACE = /\b(?:office|work|working|job|desired|target) locations?\b/i;
/** A question that says how many it takes: "up to 3", "no more than two", "your top 3". */
const CAP = /\b(?:up to|at most|no more than|maximum(?: of)?|max\.?|a limit of|your top|top)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/i;
const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

/** Other names forms give the cities people name most: "NYC" for New York, "SF" for San Francisco. Case matters: "LA" is not "La Jolla". */
const OTHER_NAMES: Record<string, RegExp> = {
  "new york": /\bNYC\b|\bNew York City\b|\bManhattan\b/,
  "san francisco": /\bSF\b|\bSan Francisco Bay Area\b/,
  "los angeles": /\bLA\b/,
  washington: /\bD\.?C\.?\b/,
};

export type LocationQuestion = {
  /** What the person is asked. */
  question: string;
  /** Tick boxes, one option each; or one list. */
  shape: "boxes" | "one" | "many";
  fields: DumpedField[];
};

/** True when a question asks which of the employer's places the candidate would work at. */
export function asksForPlaces(question: string): boolean {
  return PLACE_WORD.test(question) && (ASKS_CHOICE.test(question) || WORK_PLACE.test(question)) && !NOT_A_PLACE_CHOICE.test(question);
}

/** How many choices the question allows, when it says. */
export function capOf(text: string): number | null {
  const m = CAP.exec(text);
  if (!m?.[1]) return null;
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : (WORDS[m[1].toLowerCase()] ?? 0);
  return n > 0 ? n : null;
}

/** An option that only stands in for a choice: "Select...", "--". */
const placeholder = (o: { value: string; label: string }) => /^[-–—\s]*(select|select\.\.\.|select an option|select one|choose|please select)?[-–—\s]*$/i.test(o.label) || (!o.value && !o.label);

/** The options of a list a location question can be answered from: there, short enough to show whole, and more than one. */
const choosable = (f: DumpedField) => (f.kind === "select" || f.kind === "radio" || f.kind === "combobox") && f.options.length <= FORM.maxOptionsForJev && f.options.filter((o) => !placeholder(o)).length >= 2;
/** Options that are all yes or no answer something else: whether the person can come in, not where. */
const yesNo = (labels: string[]) => labels.every((l) => /^\s*(yes|no)\b/i.test(l));

/** The location questions of a form, for a candidate who will relocate. */
export function locationQuestions(fields: DumpedField[], profile: Profile): LocationQuestion[] {
  if (profile.preferences.willingToRelocate !== "yes") return [];
  const out: LocationQuestion[] = [];
  const groups = checkboxGroups(fields);
  const seen = new Set<string>();
  for (const f of fields) {
    if (f.kind === "checkbox") {
      const key = groups.get(f.selector) ?? "";
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const boxes = fields.filter((x) => x.kind === "checkbox" && groups.get(x.selector) === key);
      const question = boxes[0]?.section || "";
      if (boxes.length >= 2 && asksForPlaces(question) && !yesNo(boxes.map((b) => b.label))) out.push({ question: `${question} ${boxes[0]?.hint ?? ""}`.trim(), shape: "boxes", fields: boxes });
      continue;
    }
    const question = `${f.label} ${f.hint}`.trim();
    if (!choosable(f) || !asksForPlaces(f.label) || yesNo(f.options.filter((o) => !placeholder(o)).map((o) => o.label))) continue;
    out.push({ question, shape: f.multiple && f.kind !== "radio" ? "many" : "one", fields: [f] });
  }
  return out;
}

const PLACES = ["city", "region", "any", "remote", "elsewhere", "none"] as const;
type Place = (typeof PLACES)[number];
const isPlace = (c: string): c is Place => (PLACES as readonly string[]).includes(c);

/** One option of a location question, with the id its JEV question goes by. */
type Option = { qid: string; field: DumpedField; index: number; label: string; value: string };
/** An option with the place JEV said it is: null when JEV was not sure enough. */
type Placed = Option & { place: Place | null; confidence: number };
/** What a question is answered with: the options taken, best first, why, and why the first one leads. */
type Chosen = { options: Placed[]; picks: Placed[]; cap: number | null; why: string; how: string };
/** Why an answer must wait for the person, or null (mapForm's gateAnswer). */
type Gate = (f: DumpedField, value: string) => string | null;

function optionsOf(q: LocationQuestion): Option[] {
  if (q.shape === "boxes") return q.fields.map((f) => ({ qid: f.id, field: f, index: 0, label: f.label, value: "true" }));
  const f = q.fields[0] as DumpedField;
  return f.options.flatMap((o, i) => (placeholder(o) ? [] : [{ qid: `${f.id}~o${i}`, field: f, index: i, label: o.label || o.value, value: o.value }]));
}

/** One typed question per option: what kind of place it is, against the countries the candidate may work in. */
export function placeQuestions(qs: LocationQuestion[], profile: Profile): Questions {
  const countries = profile.workAuthorization.authorizedCountries.join(", ");
  const criteria: Record<Place, string> = {
    city: `A city, town, metro area or office located in one of these countries: ${countries}`,
    region: "A country, state, province or region that lies wholly inside those countries, or a union made only of them (the European Union when every member is listed above)",
    any: "Any of the locations, all of them, or no preference",
    remote: "Remote work that names no country, or names only countries among those",
    elsewhere: "A city, region or remote option outside those countries, or a region that reaches beyond them (EMEA, APAC, the Americas, worldwide)",
    none: "Not a place at all: none of the above, unable to relocate, other, prefer not to say",
  };
  const out: Questions = {};
  for (const q of qs) for (const o of optionsOf(q)) out[o.qid] = choice(`The question "${q.question.slice(0, 200)}" offers the option "${o.label.slice(0, 120)}". What kind of place is this option?`, criteria);
  return out;
}

/**
 * Plans every location question of a form: JEV places the options, in calls of at most
 * `FORM.fieldsPerCall` questions, and code chooses. A question none of whose options is a place
 * is left out, for the caller to ask the usual way. The state JEV sees is the posting's places and
 * the countries, nothing else about the person.
 */
export async function planLocations(jev: JevClient, fields: DumpedField[], profile: Profile, job: Job, gate: Gate): Promise<PlannedField[]> {
  const qs = locationQuestions(fields, profile);
  const questions = Object.entries(placeQuestions(qs, profile));
  const state = { job: { company: job.company, locations: job.locations }, countries_the_candidate_may_work_in: profile.workAuthorization.authorizedCountries };
  const answers: Record<string, Answer> = {};
  for (let i = 0; i < questions.length; i += FORM.fieldsPerCall) {
    Object.assign(answers, await jev.decide(state, Object.fromEntries(questions.slice(i, i + FORM.fieldsPerCall)), `map-form:${job.id}:${job.company}:places`));
  }
  return qs.flatMap((q) => planLocation(q, answers, profile, job, gate) ?? []);
}

/** The city a place starts with, under the name OTHER_NAMES knows it by when it is one of those. */
function cityOf(place: string): string {
  const head = (place.split(/,|\s[-–(]/)[0] ?? "").trim();
  const known = Object.entries(OTHER_NAMES).find(([name, other]) => head.toLowerCase() === name || other.test(head));
  return known ? known[0] : head.toLowerCase();
}

/** True when an option names the same city as a place: "New York, NY" and "NYC", "Austin TX" and "Austin, TX". */
export function namesCity(option: string, place: string): boolean {
  const city = cityOf(place);
  if (city.length < 2 || /^remote\b/.test(city)) return false;
  const escaped = city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z])${escaped}(?:$|[^a-z])`, "i").test(option) || !!OTHER_NAMES[city]?.test(option);
}

/** Where an option stands in the order they are taken: the posting's city, then the person's preferred offices, then the form's order. */
function rank(o: Option, job: Job, profile: Profile): { order: number; how: string } {
  if (job.locations.some((l) => namesCity(o.label, l))) return { order: -1, how: "the posting's own city" };
  const i = profile.preferences.preferredOffices.findIndex((p) => namesCity(o.label, p));
  return i >= 0 ? { order: i, how: "the candidate's preferred office" } : { order: 1000 + o.index, how: "the first listed location the candidate may work in" };
}

/**
 * Which options a question is answered with. Every city and region the person may work in; "any of
 * them" only when every place listed is one; a remote option only when no city or region
 * qualifies. Best first, as many as the question takes. Null when no option is a place.
 */
function choose(q: LocationQuestion, answers: Record<string, Answer>, profile: Profile, job: Job): Chosen | null {
  const options: Placed[] = optionsOf(q).map((o) => {
    const a = answers[o.qid];
    const confidence = a?.type === "choice" ? a.confidence : 0;
    return { ...o, place: a?.type === "choice" && confidence >= FORM.gates.place && isPlace(a.choice) ? a.choice : null, confidence };
  });
  if (!options.some((o) => o.place !== null && o.place !== "none")) return null;
  const placed = (...places: Place[]) => options.filter((o) => o.place !== null && places.includes(o.place));
  const qualifies = placed("city", "region");
  const anyIsTrue = !options.some((o) => o.place === null || o.place === "elsewhere");
  const taken = qualifies.length ? [...qualifies, ...(anyIsTrue ? placed("any") : [])] : placed("remote");
  const cap = q.shape === "one" ? 1 : capOf(q.question);
  const picks = taken.sort((a, b) => rank(a, job, profile).order - rank(b, job, profile).order).slice(0, cap ?? undefined);
  const why = qualifies.length ? "every listed location in a country the candidate may work in" : "no listed city is in a country the candidate may work in, so the remote option";
  return { options, picks, cap, why, how: picks[0] ? rank(picks[0], job, profile).how : "" };
}

/**
 * The plan for one location question. Null when no option is a place: the question was about
 * something else, and is asked the usual way. `gate` holds an answer that must wait for the person.
 */
export function planLocation(q: LocationQuestion, answers: Record<string, Answer>, profile: Profile, job: Job, gate: Gate): PlannedField[] | null {
  const chosen = choose(q, answers, profile, job);
  if (!chosen) return null;
  return q.shape === "boxes" ? planBoxes(chosen, gate) : [planList(q.fields[0] as DumpedField, q.shape, chosen, gate)];
}

const NOWHERE = "none of the listed locations is in a country the candidate may work in";

/** A group of tick boxes: the chosen ones ticked, the others left with the reason. */
function planBoxes({ options, picks, cap, why }: Chosen, gate: Gate): PlannedField[] {
  return options.map((o): PlannedField => {
    const f = o.field;
    const base = { id: f.id, selector: f.selector, kind: f.kind, label: f.label, required: f.required, optionLabel: null, confidence: o.confidence };
    const review = (note: string): PlannedField => ({ ...base, action: "review", key: "unknown", value: null, note });
    if (picks.includes(o)) {
      const held = gate(f, "true");
      return held ? review(held) : { ...base, action: "fill", key: "location", value: "true", note: `ticked: ${why}` };
    }
    if (o.place === null) return review("unsure whether this location is one the candidate may work in");
    if (!picks.length && f.required) return review(NOWHERE);
    const note = cap !== null && (o.place === "city" || o.place === "region") ? `left unticked: the question takes at most ${cap}` : o.place === "remote" ? "left unticked: a city is ticked instead of remote" : o.place === "elsewhere" ? "left unticked: outside the countries the candidate may work in" : "left unticked";
    return { ...base, action: "skip", key: "unchecked", value: null, note };
  });
}

/** One list: its best option, or every chosen option in the form's order when it takes several. */
function planList(f: DumpedField, shape: "one" | "many", { picks, why, how }: Chosen, gate: Gate): PlannedField {
  const confidence = Math.min(1, ...picks.map((o) => o.confidence));
  const base = { id: f.id, selector: f.selector, kind: f.kind, label: f.label, required: f.required, confidence };
  if (!picks.length) return { ...base, optionLabel: null, action: f.required ? "review" : "skip", key: f.required ? "unknown" : "leave_blank", value: null, note: NOWHERE };
  const taken = shape === "many" ? [...picks].sort((a, b) => a.index - b.index) : picks.slice(0, 1);
  const held = taken.map((o) => gate(f, o.label)).find((h) => h !== null);
  if (held) return { ...base, optionLabel: null, action: "review", key: "unknown", value: null, note: held };
  if (shape === "many") {
    const labels = taken.map((o) => o.label);
    return { ...base, optionLabel: null, action: "fill", key: "locations", value: labels.join(" | "), values: labels, note: `${labels.length} chosen: ${why}` };
  }
  const pick = taken[0] as Placed;
  // A select is set by its option value; radios and comboboxes are matched by label in fillFields.js.
  return { ...base, optionLabel: pick.label, action: "fill", key: `option:o${pick.index}`, value: f.kind === "select" ? pick.value : pick.label, note: how };
}

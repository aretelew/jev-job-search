import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ProfileSchema, type Profile } from "../src/profile/schema.js";
import { asksForPlaces, capOf, locationQuestions, namesCity, placeQuestions, planLocation } from "../src/forms/locations.js";
import { tookChoice } from "../src/browser/fill.js";
import { showsEvery, showsPlanned } from "../src/browser/report.js";
import type { DumpedField } from "../src/forms/fields.js";
import type { Answer } from "../src/jev/types.js";
import type { Job } from "../src/jobs/normalize.js";

const example = ProfileSchema.parse(JSON.parse(readFileSync(new URL("../data/profile.example.json", import.meta.url), "utf8")));
/** A made-up candidate who may work in the United States and Austria, will relocate, and would take Chicago, then New York. */
const profile: Profile = {
  ...example,
  workAuthorization: { ...example.workAuthorization, authorizedCountries: ["United States", "Austria"] },
  preferences: { ...example.preferences, willingToRelocate: "yes", preferredOffices: ["Chicago", "New York"] },
};
const job = (locations: string[]): Job => ({ id: "j", source: "t", company: "Acme", title: "SWE Intern", url: "https://x", ats: "greenhouse", locations, postedAt: null, terms: [], sponsorship: "unknown", degrees: [], category: null });
const field = (over: Partial<DumpedField>): DumpedField => ({ id: "f0", widget: "", selector: "#x", kind: "text", name: "", label: "", hint: "", placeholder: "", required: false, value: "", options: [], accept: "", maxLength: null, autocomplete: "", buttonGroup: false, section: "", ...over });
const placed = (choice: string, confidence = 0.95): Answer => ({ type: "choice", choice, confidence, probabilities: {} });
const pass = () => null;

const OFFICES = "Which of our office locations could you report to in-person for this internship? (select all that apply)";
const boxes = (labels: string[], question = OFFICES, required = true) =>
  labels.map((label, i) => field({ id: `b${i}`, selector: `#b${i}`, kind: "checkbox", name: "question_1[]", label, section: question, required }));
const list = (kind: DumpedField["kind"], labels: string[], over: Partial<DumpedField> = {}) =>
  field({ id: "l", selector: "#l", kind, label: "Which office are you applying to?", required: true, options: labels.map((l, i) => ({ value: kind === "select" ? `v${i}` : l, label: l })), ...over });

describe("which questions ask for the employer's places", () => {
  it("knows a choice of offices from a question about the person", () => {
    for (const q of [OFFICES, "Which office are you applying to?", "Which location are you applying for?", "Office location", "Preferred work location", "Select the cities you would be open to"]) expect(asksForPlaces(q)).toBe(true);
    for (const q of ["Where are you currently located?", "Location (City)", "How did you hear about this position?", "Which job site did you find us on?", "Are you willing to relocate?", "Select your location"]) expect(asksForPlaces(q)).toBe(false);
  });
  it("reads how many a question takes", () => {
    expect(capOf("Select up to 3 locations")).toBe(3);
    expect(capOf("Choose no more than two offices")).toBe(2);
    expect(capOf("Rank your top 2")).toBe(2);
    expect(capOf(OFFICES)).toBeNull();
  });
  it("matches a city under the names forms give it", () => {
    expect(namesCity("NYC", "New York, NY")).toBe(true);
    expect(namesCity("New York, NY", "NYC")).toBe(true);
    expect(namesCity("Austin TX", "Austin, TX")).toBe(true);
    expect(namesCity("LA", "Los Angeles")).toBe(true);
    expect(namesCity("La Jolla, CA", "Los Angeles")).toBe(false);
    expect(namesCity("Remote", "Remote - US")).toBe(false);
  });
  it("finds a group of office boxes and a list of offices, and leaves yes or no alone", () => {
    const fields = [...boxes(["Denver, CO", "Austin, TX"]), list("radio", ["San Francisco", "Vienna"]), field({ id: "y", selector: "#y", kind: "radio", label: "Which office location can you commute to?", options: [{ value: "y", label: "Yes" }, { value: "n", label: "No" }] })];
    const qs = locationQuestions(fields, profile);
    expect(qs.map((q) => q.shape)).toEqual(["boxes", "one"]);
    expect(Object.keys(placeQuestions(qs, profile))).toEqual(["b0", "b1", "l~o0", "l~o1"]);
    expect(locationQuestions(fields, { ...profile, preferences: { ...profile.preferences, willingToRelocate: "no" } })).toEqual([]);
  });
  it("asks about each option against the countries the profile names, and nothing more about the person", () => {
    const q = placeQuestions(locationQuestions(boxes(["Denver, CO", "Vienna"]), profile), profile).b0 as { criteria: Record<string, string> };
    expect(q.criteria.city).toContain("United States, Austria");
  });
});

describe("a group of office boxes", () => {
  it("ticks every city the candidate may work in and never none of the above", () => {
    const fields = boxes(["Denver, CO", "Long Beach, CA", "Colorado Springs, CO", "Washington, DC", "None of the above / I am not able to relocate"]);
    const [q] = locationQuestions(fields, profile);
    const answers = { b0: placed("city"), b1: placed("city"), b2: placed("city"), b3: placed("city"), b4: placed("none") };
    const plan = planLocation(q!, answers, profile, job(["Denver, CO"]), pass)!;
    expect(plan.map((p) => p.action)).toEqual(["fill", "fill", "fill", "fill", "skip"]);
    expect(plan.slice(0, 4).every((p) => p.value === "true")).toBe(true);
  });
  it("leaves out a city in a country the candidate may not work in, and remote while a city is ticked", () => {
    const [q] = locationQuestions(boxes(["Toronto", "Vienna", "Remote", "Europe"]), profile);
    const plan = planLocation(q!, { b0: placed("elsewhere"), b1: placed("city"), b2: placed("remote"), b3: placed("elsewhere") }, profile, job([]), pass)!;
    expect(plan.map((p) => p.action)).toEqual(["skip", "fill", "skip", "skip"]);
  });
  it("ticks a region inside the countries, and remote only when no city or region qualifies", () => {
    const [q] = locationQuestions(boxes(["United States", "Toronto"]), profile);
    expect(planLocation(q!, { b0: placed("region"), b1: placed("elsewhere") }, profile, job([]), pass)!.map((p) => p.action)).toEqual(["fill", "skip"]);
    const [r] = locationQuestions(boxes(["Toronto", "Remote (US)"]), profile);
    expect(planLocation(r!, { b0: placed("elsewhere"), b1: placed("remote") }, profile, job([]), pass)!.map((p) => p.action)).toEqual(["skip", "fill"]);
  });
  it("ticks any of the above only when every listed place is one the candidate may work in", () => {
    const [q] = locationQuestions(boxes(["Chicago", "Austin", "Open to any location"]), profile);
    expect(planLocation(q!, { b0: placed("city"), b1: placed("city"), b2: placed("any") }, profile, job([]), pass)!.map((p) => p.action)).toEqual(["fill", "fill", "fill"]);
    const [r] = locationQuestions(boxes(["Chicago", "Toronto", "Open to any location"]), profile);
    expect(planLocation(r!, { b0: placed("city"), b1: placed("elsewhere"), b2: placed("any") }, profile, job([]), pass)!.map((p) => p.action)).toEqual(["fill", "skip", "skip"]);
  });
  it("takes as many as the question allows, best first", () => {
    const [q] = locationQuestions(boxes(["Austin", "New York", "Chicago", "Denver"], "Which offices would you work from? Select up to 2"), profile);
    const plan = planLocation(q!, { b0: placed("city"), b1: placed("city"), b2: placed("city"), b3: placed("city") }, profile, job([]), pass)!;
    expect(plan.map((p) => p.action)).toEqual(["skip", "fill", "fill", "skip"]);
  });
  it("leaves an option it cannot place to a person, and holds a required group with nowhere to go", () => {
    const [q] = locationQuestions(boxes(["Chicago", "Springfield"]), profile);
    expect(planLocation(q!, { b0: placed("city"), b1: placed("city", 0.4) }, profile, job([]), pass)!.map((p) => p.action)).toEqual(["fill", "review"]);
    const [r] = locationQuestions(boxes(["Toronto", "London"]), profile);
    expect(planLocation(r!, { b0: placed("elsewhere"), b1: placed("elsewhere") }, profile, job([]), pass)!.map((p) => p.action)).toEqual(["review", "review"]);
  });
  it("gives the question back when no option is a place", () => {
    const [q] = locationQuestions(boxes(["Engineering", "Design"], "Which sites or teams are you interested in?"), profile);
    expect(planLocation(q!, { b0: placed("none"), b1: placed("none") }, profile, job([]), pass)).toBeNull();
  });
  it("holds a tick the agreement gate holds", () => {
    const [q] = locationQuestions(boxes(["Chicago", "Austin"]), profile);
    const plan = planLocation(q!, { b0: placed("city"), b1: placed("city") }, profile, job([]), () => "needs approval")!;
    expect(plan.map((p) => p.action)).toEqual(["review", "review"]);
  });
});

describe("a list that takes one office", () => {
  const answers = (n: number, places: string[]) => Object.fromEntries(places.slice(0, n).map((p, i) => [`l~o${i}`, placed(p)]));
  it("picks the posting's own city first", () => {
    const [q] = locationQuestions([list("radio", ["San Francisco", "Toronto", "Vienna"])], profile);
    const [p] = planLocation(q!, answers(3, ["city", "elsewhere", "city"]), profile, job(["Vienna, Austria"]), pass)!;
    expect(p).toMatchObject({ action: "fill", value: "Vienna", optionLabel: "Vienna" });
  });
  it("then the candidate's preferred offices in order, then the first that qualifies", () => {
    const [q] = locationQuestions([list("radio", ["San Francisco", "NYC", "Chicago, IL", "Toronto"])], profile);
    expect(planLocation(q!, answers(4, ["city", "city", "city", "elsewhere"]), profile, job(["Remote"]), pass)![0]).toMatchObject({ value: "Chicago, IL" });
    const [r] = locationQuestions([list("radio", ["San Francisco", "NYC", "Toronto"])], profile);
    expect(planLocation(r!, answers(3, ["city", "city", "elsewhere"]), profile, job(["Remote"]), pass)![0]).toMatchObject({ value: "NYC" });
    const [s] = locationQuestions([list("radio", ["Toronto", "Austin", "Denver"])], profile);
    expect(planLocation(s!, answers(3, ["elsewhere", "city", "city"]), profile, job(["Toronto, ON"]), pass)![0]).toMatchObject({ value: "Austin" });
  });
  it("sets a select by its option value and skips its placeholder", () => {
    const f = list("select", ["Select...", "Torrance CA", "Austin TX"]);
    f.options[0]!.value = "";
    const [q] = locationQuestions([f], profile);
    expect(Object.keys(placeQuestions([q!], profile))).toEqual(["l~o1", "l~o2"]);
    const [p] = planLocation(q!, { "l~o1": placed("city"), "l~o2": placed("city") }, profile, job(["Austin, TX"]), pass)!;
    expect(p).toMatchObject({ action: "fill", value: "v2", optionLabel: "Austin TX", key: "option:o2" });
  });
});

describe("a dropdown that takes several", () => {
  it("chooses every option that qualifies, in the form's order", () => {
    const [q] = locationQuestions([list("combobox", ["Toronto", "Austin, TX", "Denver, CO", "Remote"], { multiple: true, label: "Which locations are you open to?" })], profile);
    expect(q!.shape).toBe("many");
    const [p] = planLocation(q!, { "l~o0": placed("elsewhere"), "l~o1": placed("city"), "l~o2": placed("city"), "l~o3": placed("remote") }, profile, job([]), pass)!;
    expect(p).toMatchObject({ action: "fill", values: ["Austin, TX", "Denver, CO"] });
  });
  it("counts as filled only when every choice shows", () => {
    const f = { selector: "#l", kind: "combobox", value: "Austin, TX | Denver, CO", values: ["Austin, TX", "Denver, CO"] };
    expect(tookChoice(f, "Austin, TX, Denver, CO")).toBe(true);
    expect(tookChoice(f, "Austin, TX")).toBe(false);
    expect(showsPlanned(f, "Denver, CO, Austin, TX")).toBe(true);
    expect(showsEvery(["NYC", "SF"], "SF, NYC")).toBe(true);
    expect(showsEvery(["SF"], "SFO")).toBe(false);
  });
});

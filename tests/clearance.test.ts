import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ProfileSchema, type Profile } from "../src/profile/schema.js";
import { clearanceHold, gateAnswer } from "../src/forms/mapForm.js";
import type { DumpedField } from "../src/forms/fields.js";
import type { Job } from "../src/jobs/normalize.js";

const example = ProfileSchema.parse(JSON.parse(readFileSync(new URL("../data/profile.example.json", import.meta.url), "utf8")));
const others = example.answers.filter((a) => !/clearance/i.test(a.question));
/** A candidate who said they hold no clearance. */
const none: Profile = { ...example, answers: [...others, { question: "Do you hold a security clearance?", answer: "No." }] };
/** A candidate who said nothing about one. */
const unsaid: Profile = { ...example, answers: others };

const job: Job = { id: "j", source: "t", company: "Acme", title: "Software Engineer Intern", url: "https://x", ats: "workday", locations: ["Remote"], postedAt: null, terms: [], sponsorship: "unknown", degrees: [], category: null };
const field = (label: string): DumpedField => ({ id: "f0", widget: "", selector: "#x", kind: "combobox", name: "", label, hint: "", placeholder: "", required: true, value: "", options: [], accept: "", maxLength: null, autocomplete: "", buttonGroup: false, section: "" });
const agency = field("If you currently possess an active security clearance, which agency sponsored the clearance?*");
const holds = field("Do you currently possess an active security clearance?*");

describe("a clearance the candidate said they do not hold", () => {
  it("is never claimed", () => {
    for (const value of ["DOD", "Secret", "Top Secret / SCI", "Yes"]) expect(clearanceHold(agency, value, none)).not.toBeNull();
    expect(gateAnswer(agency, "DOD", none, job)).toMatch(/holds none/);
  });

  it("lets an answer that claims nothing through", () => {
    for (const value of ["No", "No, I do not possess an active security clearance.", "None", "N/A", "Not applicable", "I do not hold one"]) expect(clearanceHold(holds, value, none)).toBeNull();
  });

  it("leaves questions about obtaining one, and people who said nothing, alone", () => {
    expect(clearanceHold(field("Are you willing and able to obtain a security clearance?"), "Yes", none)).toBeNull();
    expect(clearanceHold(field("Are you eligible for a U.S. security clearance?"), "Yes", none)).toBeNull();
    expect(clearanceHold(agency, "DOD", unsaid)).toBeNull();
    expect(clearanceHold(field("Which programming languages do you know?"), "DOD", none)).toBeNull();
  });

  it("reads a ticked box in a list of levels by its own words", () => {
    const level = (label: string): DumpedField => ({ ...field(label), kind: "checkbox", section: "Clearance Level - Which U.S. security clearance do you hold, or have you held?" });
    expect(clearanceHold(level("N/A - have never held a U.S. security clearance"), "true", none)).toBeNull();
    expect(clearanceHold(level("Top Secret"), "true", none)).not.toBeNull();
    expect(clearanceHold(level("Secret"), "false", none)).toBeNull();
    expect(clearanceHold(level("Top Secret"), "true", unsaid)).toBeNull();
  });
});

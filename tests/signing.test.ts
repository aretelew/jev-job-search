import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ProfileSchema, type Profile } from "../src/profile/schema.js";
import { gateAnswer, planField, signedOnPlan } from "../src/forms/mapForm.js";
import { salaryRule } from "../src/profile/pay.js";
import type { DumpedField } from "../src/forms/fields.js";
import type { Job } from "../src/jobs/normalize.js";

const example = ProfileSchema.parse(JSON.parse(readFileSync(new URL("../data/profile.example.json", import.meta.url), "utf8")));
const strict: Profile = { ...example, preferences: { ...example.preferences, reviewAgreements: true, acceptedAgreements: [], signForMe: false } };
const signs: Profile = { ...strict, preferences: { ...strict.preferences, signForMe: true } };
const job: Job = { id: "j", source: "t", company: "Acme", title: "Software Engineer Intern", url: "https://x", ats: "workday", locations: ["Remote"], postedAt: null, terms: [], sponsorship: "unknown", degrees: [], category: null };
const field = (over: Partial<DumpedField>): DumpedField => ({ id: "f0", widget: "", selector: "#x", kind: "text", name: "", label: "", hint: "", placeholder: "", required: true, value: "", options: [], accept: "", maxLength: null, autocomplete: "", buttonGroup: false, section: "", ...over });
const answer = { type: "text", text: "x", confidence: 0.9 } as never;
const today = new Date(2026, 10, 26);

describe("a signature", () => {
  const typeName = field({ label: "Please type your full legal name as your electronic signature" });

  it("waits for the person unless they let the tool sign", () => {
    expect(planField(typeName, answer, strict, job)).toMatchObject({ action: "review", key: "signature" });
    expect(planField(typeName, answer, signs, job)).toMatchObject({ action: "fill", key: "signature", value: `${example.name.first} ${example.name.last}` });
  });

  it("is dated today, in the part a Workday date box asks for", () => {
    const part = (label: string) => field({ label, selector: `#selfIdentifiedDisabilityData--dateSignedOn-dateSection${label}-input` });
    expect(signedOnPlan(part("Month"), signs, today)).toMatchObject({ action: "fill", value: "11" });
    expect(signedOnPlan(part("Day"), signs, today)).toMatchObject({ value: "26" });
    expect(signedOnPlan(part("Year"), signs, today)).toMatchObject({ value: "2026" });
    expect(signedOnPlan(field({ kind: "date", label: "Date signed" }), signs, today)).toMatchObject({ value: "2026-11-26" });
    expect(signedOnPlan(part("Month"), strict, today)).toBeNull();
    // A month that is not the date signed (a start date) is not this.
    expect(signedOnPlan(field({ label: "Month", selector: "#workExperience-startDate-dateSectionMonth-input" }), signs, today)).toBeNull();
  });
});

describe("an agreement that gives up a right", () => {
  const arbitration = field({ kind: "checkbox", label: "I agree to resolve any dispute through binding arbitration and waive a class action" });

  it("waits unless the person accepted binding agreements", () => {
    const terms: Profile = { ...strict, preferences: { ...strict.preferences, acceptedAgreements: ["terms"] } };
    const binding: Profile = { ...strict, preferences: { ...strict.preferences, acceptedAgreements: ["terms", "binding"] } };
    expect(gateAnswer(arbitration, "true", terms, job)).toMatch(/approval/);
    expect(gateAnswer(arbitration, "true", binding, job)).toBeNull();
    expect(gateAnswer(field({ kind: "checkbox", label: "I accept the terms and conditions, including binding arbitration" }), "true", binding, job)).toBeNull();
  });
});

describe("an answer that only mentions acceptance", () => {
  it("is not an agreement: Micron's availability counts from the offer's acceptance", () => {
    const when = field({ kind: "combobox", label: "When would you be available if an offer was accepted?", options: ["More than 2 months after offer acceptance", "After Graduation"].map((l) => ({ value: l, label: l })) });
    expect(gateAnswer(when, "More than 2 months after offer acceptance", strict, job)).toBeNull();
    expect(gateAnswer(field({ kind: "combobox", label: "Terms" }), "I accept", strict, job)).toMatch(/approval/);
  });
});

describe("a pay question", () => {
  it("gets the person's yearly figure, the hourly rate it comes to, or nothing", () => {
    expect(salaryRule({ preferences: { ...example.preferences, salaryExpectation: "" } })).toMatch(/blank or set to negotiable/);
    const rule = salaryRule({ preferences: { ...example.preferences, salaryExpectation: "$140,000" } });
    expect(rule).toMatch(/140000 a year/);
    expect(rule).toMatch(/67 an hour/);
    expect(rule).toMatch(/band or range is the one that holds it/);
  });
});

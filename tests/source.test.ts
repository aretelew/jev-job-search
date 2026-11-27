import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ProfileSchema, type Profile } from "../src/profile/schema.js";
import { gateAnswer, planField, sourceHold } from "../src/forms/mapForm.js";
import type { DumpedField } from "../src/forms/fields.js";
import type { Job } from "../src/jobs/normalize.js";

const example = ProfileSchema.parse(JSON.parse(readFileSync(new URL("../data/profile.example.json", import.meta.url), "utf8")));
/** A candidate who found the job in an online list and names no site. */
const online: Profile = { ...example, preferences: { ...example.preferences, howDidYouHear: "Online job posting" } };
/** The example candidate says they heard of jobs on LinkedIn. */
const linkedin: Profile = { ...example, preferences: { ...example.preferences, howDidYouHear: "LinkedIn" } };

const job: Job = { id: "j", source: "t", company: "Acme", title: "Software Engineer Intern", url: "https://x", ats: "workday", locations: ["Remote"], postedAt: null, terms: [], sponsorship: "unknown", degrees: [], category: null };
const field = (over: Partial<DumpedField>): DumpedField => ({ id: "f0", widget: "", selector: "#x", kind: "text", name: "", label: "", hint: "", placeholder: "", required: false, value: "", options: [], accept: "", maxLength: null, autocomplete: "", buttonGroup: false, section: "", ...over });
const heard = field({ kind: "combobox", label: "How Did You Hear About Us?*", required: true, options: ["Job Board", "Glassdoor", "Employee Referral", "Acme Careers Site", "Other"].map((l) => ({ value: l, label: l })) });
const pick = (choice: string) => ({ type: "choice", choice, confidence: 0.95, probabilities: {} }) as never;

describe("how the candidate heard about the job", () => {
  it("refuses a site, a referral or an event the profile does not give", () => {
    for (const value of ["Glassdoor", "Job Board > Glassdoor", "Employee Referral", "Career Fair", "Social Media > LinkedIn"]) expect(sourceHold(heard, value, online, job)).not.toBeNull();
  });

  it("takes an online posting, the employer's own site, or other", () => {
    for (const value of ["Online job posting", "Job Board", "Job Board > Other", "Other", "Acme Careers Site", "Company Website", "Online Job Board", "Careers Page"]) expect(sourceHold(heard, value, online, job)).toBeNull();
  });

  it("takes the source the profile gives, and only that one", () => {
    expect(sourceHold(heard, "LinkedIn", linkedin, job)).toBeNull();
    expect(sourceHold(heard, "Social Media > LinkedIn", linkedin, job)).toBeNull();
    expect(sourceHold(heard, "Job Board > Glassdoor", linkedin, job)).not.toBeNull();
  });

  it("takes a source the person gave for this job, or as a standing answer", () => {
    // A run merges the answers saved for one job into the profile's (forJob in src/run/pipeline.ts).
    const forThisJob: Profile = { ...online, answers: [...online.answers, { question: "How Did You Hear About Us?*", answer: "Glassdoor" }] };
    expect(sourceHold(heard, "Job Board > Glassdoor", forThisJob, job)).toBeNull();
    expect(gateAnswer(heard, "Glassdoor", forThisJob, job)).toBeNull();
    // An answer to another question names no source.
    const elsewhere: Profile = { ...online, answers: [...online.answers, { question: "Favourite site?", answer: "Glassdoor" }] };
    expect(sourceHold(heard, "Glassdoor", elsewhere, job)).not.toBeNull();
    const standing: Profile = { ...online, answers: [...online.answers, { question: "How did you hear about the job?", answer: "Indeed" }] };
    expect(sourceHold(heard, "Indeed", standing, job)).toBeNull();
    expect(sourceHold(heard, "Glassdoor", standing, job)).not.toBeNull();
  });

  it("leaves other questions alone", () => {
    expect(sourceHold(field({ label: "Which programming languages do you know?" }), "Glassdoor", online, job)).toBeNull();
    expect(gateAnswer(field({ label: "Current employer" }), "Glassdoor", online, job)).toBeNull();
  });

  it("sends a named source JEV picked to the person instead of the form", () => {
    expect(planField(heard, pick("o1"), online, job)).toMatchObject({ action: "review", value: null });
    expect(planField(heard, pick("o4"), online, job)).toMatchObject({ action: "fill", optionLabel: "Other" });
  });
});

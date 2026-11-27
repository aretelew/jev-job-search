import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ProfileSchema, type Profile } from "../src/profile/schema.js";
import { workdayWorkPlan } from "../src/forms/mapForm.js";
import type { DumpedField } from "../src/forms/fields.js";

const example = ProfileSchema.parse(JSON.parse(readFileSync(new URL("../data/profile.example.json", import.meta.url), "utf8")));
/** A candidate whose most recent job ended, somewhere other than where they live. */
const ended: Profile = {
  ...example,
  address: { ...example.address, city: "Springfield" },
  experience: [{ company: "Acme Labs", title: "Intern", location: "Chicago, Illinois", start: "2026-06", end: "2026-08", current: false, paid: true, bullets: [] }, ...example.experience],
};
const field = (selector: string, label: string, kind: DumpedField["kind"] = "text"): DumpedField => ({ id: selector, widget: "", selector, kind, name: "", label, hint: "", placeholder: "", required: true, value: "", options: [], accept: "", maxLength: null, autocomplete: "", buttonGroup: false, section: "", });
// The boxes of one Workday work-history block, by the ids the live page gives them (Aerospace Corporation's).
const block = (n: number) => [
  field(`#workExperience-${n}--jobTitle`, "Job Title"),
  field(`#workExperience-${n}--companyName`, "Company"),
  field(`#workExperience-${n}--location`, "Location"),
  field(`#workExperience-${n}--currentlyWorkHere`, "I currently work here", "checkbox"),
  field(`#workExperience-${n}--startDate-dateSectionMonth-input`, "Month"),
  field(`#workExperience-${n}--startDate-dateSectionYear-input`, "Year"),
  field(`#workExperience-${n}--endDate-dateSectionMonth-input`, "Month"),
  field(`#workExperience-${n}--endDate-dateSectionYear-input`, "Year"),
];

describe("a Workday work-history block", () => {
  const fields = [field("#address--city", "City"), ...block(9), ...block(12)];
  const plan = (selector: string) => workdayWorkPlan(fields.find((f) => f.selector === selector) as DumpedField, fields, ended);

  it("is the most recent job: its own location, not where the person lives", () => {
    expect(plan("#workExperience-9--jobTitle")).toMatchObject({ action: "fill", value: "Intern" });
    expect(plan("#workExperience-9--companyName")).toMatchObject({ value: "Acme Labs" });
    expect(plan("#workExperience-9--location")).toMatchObject({ action: "fill", key: "employment_location", value: "Chicago, Illinois" });
  });

  it("has the job's dates, never a degree's, and is unticked as a current job once it ended", () => {
    expect(plan("#workExperience-9--startDate-dateSectionMonth-input")).toMatchObject({ key: "employment_start_date", value: "6" });
    expect(plan("#workExperience-9--startDate-dateSectionYear-input")).toMatchObject({ value: "2026" });
    expect(plan("#workExperience-9--endDate-dateSectionMonth-input")).toMatchObject({ key: "employment_end_date", value: "8" });
    expect(plan("#workExperience-9--currentlyWorkHere")).toMatchObject({ action: "fill", key: "unchecked", value: "false" });
  });

  it("leaves a second block, and any other box, to the rest of the plan", () => {
    expect(plan("#workExperience-12--location")).toBeNull();
    expect(plan("#address--city")).toBeNull();
  });
});

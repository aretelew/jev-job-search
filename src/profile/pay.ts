/**
 * How a pay question is answered, for JEV and the writer alike: the person's own yearly figure when the
 * profile gives one (the band or range that holds it, or the hourly rate it comes to), else nothing.
 */
import { FORM } from "../config.js";
import type { Profile } from "./schema.js";

/** One yearly figure, written plainly: "95000", "$95,000", "95k". A range, an hourly rate or words are not one. */
const YEARLY = /^\$?\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\s*(k)?$/i;

export function salaryRule(profile: Pick<Profile, "preferences">): string {
  const m = YEARLY.exec(profile.preferences.salaryExpectation.trim());
  const yearly = m ? Number((m[1] ?? "").replace(/,/g, "")) * (m[2] ? 1000 : 1) : 0;
  if (!yearly) return "Salary expectation is left blank or set to negotiable.";
  const hourly = Math.round(yearly / FORM.hoursPerYear);
  return `Expected pay is ${yearly} a year (${hourly} an hour at ${FORM.hoursPerYear} hours a year). A pay band or range is the one that holds it; an hourly box gets the hourly figure; a yearly box gets the yearly figure.`;
}

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { basedIn, ProfileSchema } from "../src/profile/schema.js";
import { valueFor } from "../src/profile/fieldKeys.js";
import { candidateContext } from "../src/answers/resolve.js";

const example = ProfileSchema.parse(JSON.parse(readFileSync(new URL("../data/profile.example.json", import.meta.url), "utf8")));
const nearby = ProfileSchema.parse({ ...example, location: { city: "St. Albert Metro", region: "Alberta", regionCode: "AB" } });

describe("where the candidate is based", () => {
  it("is the address city when the profile gives no location", () => {
    expect(basedIn(example).city).toBe(example.address.city);
    expect(valueFor(example, "current_location")).toBe(`${example.address.city}, ${example.address.region}, ${example.address.country}`);
  });

  it("is the profile's location for a Location field and the writer, while the address fields keep the mailing address", () => {
    expect(valueFor(nearby, "current_location")).toBe(`St. Albert Metro, Alberta, ${example.address.country}`);
    expect((candidateContext(nearby).candidate as { location: string }).location).toBe(`St. Albert Metro, Alberta, ${example.address.country}`);
    expect(valueFor(nearby, "city")).toBe(example.address.city);
    expect(valueFor(nearby, "full_address")).toContain(example.address.city);
  });
});

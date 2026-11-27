import { describe, expect, it } from "vitest";
import { salaryRule } from "../src/profile/pay.js";

const rule = (salaryExpectation: string) => salaryRule({ preferences: { salaryExpectation } } as Parameters<typeof salaryRule>[0]);

describe("the pay rule", () => {
  it("states one yearly figure however it is written, with the hourly rate it comes to", () => {
    for (const v of ["95000", "$95,000", "95k", " 95000 "]) expect(rule(v)).toMatch(/^Expected pay is 95000 a year \(46 an hour/);
  });

  it("says nothing about a figure it cannot read as one yearly number", () => {
    for (const v of ["", "negotiable", "80,000-100,000", "$25/hour", "95000 to 105000"]) expect(rule(v)).toBe("Salary expectation is left blank or set to negotiable.");
  });
});

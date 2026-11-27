import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { OUTREACH, PATHS } from "../src/config.js";
import type { QueueEntry } from "../src/jobs/queue.js";
import { loadProfile } from "../src/profile/schema.js";
import { setCompanyPage, signedInAt } from "../src/outreach/commands.js";
import { companyIdFrom, companySlugFrom, leftCompany, mutualsIn, pageState, parseCard, peopleSearchUrl, profileUrlOf, READ_EXPR, searchesFor, type PageRead, type RawCard } from "../src/outreach/linkedin.js";
import { pick, scoreOf, whyOf, type Judged } from "../src/outreach/rank.js";
import { followUpsDue, loadOutreach, markPerson, mutateOutreach, peopleRows, PEOPLE_COLUMNS } from "../src/outreach/records.js";
import { chooseJobs, findPeople, refusal, type Browse } from "../src/outreach/run.js";

const fixture = JSON.parse(readFileSync(path.join(__dirname, "fixtures", "linkedin-cards.json"), "utf8")) as PageRead;
const profile = loadProfile(PATHS.profileExample);
const tmp = () => path.join(mkdtempSync(path.join(tmpdir(), "outreach-")), "outreach.json");
const NOW = new Date("2026-11-26T15:00:00.000Z");

const entry = (over: Partial<QueueEntry["job"]> = {}, e: Partial<QueueEntry> = {}): QueueEntry =>
  ({
    job: { id: "job1", source: "test", company: "Acme Robotics", title: "Software Engineer Intern", url: "https://jobs.example.com/1", ats: "greenhouse", locations: ["San Francisco, CA"], postedAt: "2026-11-20", terms: [], sponsorship: "unknown", degrees: [], category: null, description: "Build payments tools. Over 2 million reviews a week.", ...over },
    fit: { score: 0.7 },
    preFilterReason: null,
    status: "applied",
    statusReason: null,
    waitingFor: null,
    answers: [],
    replies: [],
    response: null,
    attempts: 1,
    discoveredAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    appliedAt: NOW.toISOString(),
    notes: null,
    ...e,
  }) as QueueEntry;

const cardsOf = (read: PageRead) => read.cards.map(parseCard).filter((c) => c !== null);

describe("reading LinkedIn result cards", () => {
  it("the fixture holds made-up profile links only", () => {
    const slugs = fixture.cards.map((c: RawCard) => /\/in\/([^/]+)/.exec(c.href)?.[1]).filter(Boolean);
    expect(slugs.length).toBeGreaterThan(0);
    for (const s of slugs) expect(s).toMatch(/^example-/);
  });

  it("turns each card into a person, and skips hidden members and links that are not a profile", () => {
    const cards = cardsOf(fixture);
    expect(cards.map((c) => c.name)).toEqual(["Avery Stone", "Jordan Lee", "Riley Park", "Sam Quinn", "Taylor Reed", "Morgan Ash"]);
    const [avery, jordan, riley, sam, taylor, morgan] = cards;
    expect(avery).toMatchObject({ degree: 3, headline: "University Recruiting at Acme Robotics", location: "San Francisco Bay Area", summary: "", mutuals: 0, sharedSchool: false, profileUrl: "https://www.linkedin.com/in/example-avery-stone/" });
    expect(jordan).toMatchObject({ degree: 3, headline: "Senior Software Engineer at Acme Robotics", sharedSchool: true });
    expect(jordan?.summary).toContain("since August 2019");
    expect(riley).toMatchObject({ degree: 2, mutuals: 1, headline: "Developer Advocate @Acme Robotics" });
    expect(riley?.mutualLine).toBe("Casey Morgan is a mutual connection");
    expect(sam).toMatchObject({ degree: 2, mutuals: 6 });
    expect(taylor).toMatchObject({ degree: 3, headline: "Engineering Manager, Platform at Acme Robotics" });
    expect(morgan?.degree).toBe(1);
  });

  it("counts mutual connections the way LinkedIn words them", () => {
    expect(mutualsIn("Casey Morgan is a mutual connection")).toBe(1);
    expect(mutualsIn("Casey Morgan, Drew Hale & 10 other mutual connections")).toBe(12);
    expect(mutualsIn("Casey Morgan & 1 other mutual connection")).toBe(2);
    expect(mutualsIn("Software Engineer")).toBe(0);
  });

  it("keeps a profile link without its query", () => {
    expect(profileUrlOf("https://www.linkedin.com/in/example-a/?miniProfileUrn=x")).toBe("https://www.linkedin.com/in/example-a/");
    expect(profileUrlOf("/search/results/people/")).toBeNull();
  });

  it("knows who has left the company", () => {
    const [, jordan, , sam] = cardsOf(fixture);
    expect(leftCompany(sam as never, "Acme Robotics")).toBe(true);
    expect(leftCompany(jordan as never, "Acme Robotics")).toBe(false);
    expect(leftCompany({ headline: "Engineer at Other Co", summary: "Past: Intern at Acme Robotics" }, "Acme Robotics")).toBe(true);
  });

  it("the page read only reads: it clicks nothing, types nothing and fills nothing", () => {
    expect(READ_EXPR).not.toMatch(/\.click\(|dispatchEvent|\.value\s*=|\.focus\(|submit|insertText|fetch\(|XMLHttpRequest|setTimeout|setInterval/);
  });
});

describe("pages, addresses and companies", () => {
  it("tells results from a sign-in, a check and a limit", () => {
    const at = (url: string, text = "") => pageState({ url, text, title: "" });
    expect(at("https://www.linkedin.com/search/results/people/?keywords=x")).toBe("results");
    expect(at("https://www.linkedin.com/login/?session_redirect=x")).toBe("signed_out");
    expect(at("https://www.linkedin.com/authwall?trk=x")).toBe("signed_out");
    expect(at("https://www.linkedin.com/checkpoint/challenge/x")).toBe("check");
    expect(at("https://www.linkedin.com/search/results/people/", "Let's do a quick security check")).toBe("check");
    expect(at("https://www.linkedin.com/search/results/people/", "You've reached the monthly limit for profile searches")).toBe("limit");
    expect(at("not a url")).toBe("check");
  });

  it("limits every search to people who work at the company now, and puts the school in", () => {
    const urls = searchesFor("1234", "University of Alberta");
    expect(urls.map((u) => u.keywords)).toEqual(["software engineer", "engineering manager", "University of Alberta", "intern", OUTREACH.searches[4]]);
    expect(urls[4]?.keywords).toMatch(/ OR /);
    for (const u of urls) expect(decodeURIComponent(u.url)).toContain('currentCompany=["1234"]');
    expect(searchesFor("1234", null)).toHaveLength(4);
    expect(peopleSearchUrl("1", "a b")).toBe("https://www.linkedin.com/search/results/people/?currentCompany=%5B%221%22%5D&keywords=a%20b");
  });

  it("takes the company page whose name is the employer's, the first one, and no other", () => {
    const read = { ...fixture, companyLinks: [{ href: "https://www.linkedin.com/company/acme-robotics-shi/", text: "Acme Robotics-shi" }, { href: "https://www.linkedin.com/company/acmerobotics/", text: "Acme Robotics " }, { href: "https://www.linkedin.com/company/acme-two/", text: "Acme Robotics" }] };
    expect(companySlugFrom(read, "Acme Robotics, Inc.")).toBe("acmerobotics");
    expect(companySlugFrom(read, "Globex")).toBeNull();
  });

  it("reads the company id from the page's link to its own employees", () => {
    expect(companyIdFrom({ ...fixture, employeeSearch: "/search/results/people/?currentCompany=%5B%2297023698%22%5D&origin=COMPANY_PAGE_CANNED_SEARCH" })).toBe("97023698");
    expect(companyIdFrom({ ...fixture, employeeSearch: '/search/results/people/?currentCompany=["309694"]' })).toBe("309694");
    expect(companyIdFrom(fixture)).toBeNull();
  });

  it("sees a sign-in finished by the tab's address alone", () => {
    expect(signedInAt("https://www.linkedin.com/feed/")).toBe(true);
    expect(signedInAt("https://www.linkedin.com/login/")).toBe(false);
    expect(signedInAt("https://www.linkedin.com/checkpoint/lg/login-submit")).toBe(false);
    expect(signedInAt("https://evil.example.com/feed/")).toBe(false);
  });
});

describe("ranking", () => {
  const [avery, jordan, riley, , taylor, morgan] = cardsOf(fixture);
  const j = (card: unknown, kind: Judged["kind"], over: Partial<Judged> = {}): Judged => ({ card: card as Judged["card"], kind, confidence: 0.9, executive: false, ...over });

  it("scores the kind and adds the warm signals, a shared school among them", () => {
    expect(scoreOf(j(avery, "campus_recruiter"))).toBe(OUTREACH.weights.campus_recruiter);
    expect(scoreOf(j(jordan, "team_engineer"))).toBe((OUTREACH.weights.team_engineer ?? 0) + OUTREACH.sharedSchool);
    expect(scoreOf(j(riley, "same_company"))).toBe(0);
    expect(scoreOf(j(taylor, "team_manager", { confidence: 0.3 }))).toBe(0);
    expect(whyOf(j(riley, "team_engineer"))).toBe("an engineer in the area of the role, 1 mutual connection, 2nd degree");
    expect(whyOf(j(jordan, "team_engineer"))).toBe("an engineer in the area of the role, went to your school");
  });

  it("takes at most two recruiters and gives the other places to engineers and managers", () => {
    const judged = [j(avery, "campus_recruiter"), j(riley, "recruiter"), j(morgan, "campus_recruiter"), j(jordan, "team_engineer"), j(taylor, "team_manager")];
    const kept = pick(judged, 10).kept;
    expect(kept.filter((x) => OUTREACH.recruiterKinds.includes(x.kind))).toHaveLength(OUTREACH.maxRecruiters);
    expect(kept.map((x) => x.card.name)).toEqual(expect.arrayContaining(["Jordan Lee", "Taylor Reed"]));
    expect(kept).toHaveLength(4);
  });

  it("ranks best first, never more than the employer has room for, and sets executives apart", () => {
    const judged = [j(avery, "campus_recruiter"), j(jordan, "team_engineer"), j(riley, "team_engineer"), j(taylor, "team_manager"), j(morgan, "team_manager", { executive: true })];
    const all = pick(judged, 10);
    expect(all.kept.map((x) => x.card.name)).toEqual(["Jordan Lee", "Riley Park", "Avery Stone", "Taylor Reed"]);
    expect(all.executives.map((x) => x.card.name)).toEqual(["Morgan Ash"]);
    expect(pick(judged, 1).kept).toHaveLength(1);
    expect(pick(judged, 0).kept).toHaveLength(0);
  });
});

describe("the run", () => {
  const ack = (file: string) => mutateOutreach((f) => void (f.riskAcknowledgedAt = NOW.toISOString()), file);
  const companySearch: PageRead = { ...fixture, url: "https://www.linkedin.com/search/results/companies/?keywords=Acme", cards: [], companyLinks: [{ href: "https://www.linkedin.com/company/acmerobotics/", text: "Acme Robotics" }] };
  const companyPage: PageRead = { ...fixture, url: "https://www.linkedin.com/company/acmerobotics/", cards: [], employeeSearch: "/search/results/people/?currentCompany=%5B%221234%22%5D" };
  /** A scripted LinkedIn: company search, company page, then people pages, or whatever a test puts in. */
  const browser = (pages: PageRead[]) => {
    const urls: string[] = [];
    const browse: Browse = { read: async (url) => (urls.push(url), pages.shift() ?? fixture) };
    return { browse, urls };
  };
  const jev = { decide: async (state: unknown) => {
    const h = String((state as { person: { headline: string } }).person.headline);
    const kind = /recruit/i.test(h) ? "campus_recruiter" : /manager/i.test(h) ? "team_manager" : /ceo|founder/i.test(h) ? "team_manager" : /engineer/i.test(h) ? "team_engineer" : "same_company";
    return { kind: { type: "choice", choice: kind, confidence: 0.9, probabilities: {} }, seniority: { type: "choice", choice: /ceo|founder/i.test(h) ? "executive" : "mid", confidence: 0.9, probabilities: {} } } as never;
  } };
  const deps = (file: string, b: { browse: Browse }, sleeps: number[] = []) => ({ browse: b.browse, jev, sleep: async (ms: number) => void sleeps.push(ms), now: () => NOW, random: () => 0.5, file, cacheFile: `${file}.kinds.json` });

  it("does nothing until the person has read the risk note", async () => {
    const file = tmp();
    const b = browser([]);
    const r = await findPeople(profile, [entry()], deps(file, b));
    expect(b.urls).toHaveLength(0);
    expect(r.stopped).toMatch(/outreach signin/);
  });

  it("looks the company up once, reads the searches at a person's pace, and writes down a few people with notes", async () => {
    const file = tmp();
    ack(file);
    const sleeps: number[] = [];
    const b = browser([companySearch, companyPage]);
    const r = await findPeople(profile, [entry()], deps(file, b, sleeps));
    expect(r.stopped).toBeNull();
    expect(b.urls[0]).toContain("/search/results/companies/");
    expect(b.urls[1]).toBe("https://www.linkedin.com/company/acmerobotics/");
    expect(b.urls.slice(2).every((u) => decodeURIComponent(u).includes('currentCompany=["1234"]'))).toBe(true);
    expect(b.urls).toHaveLength(7);
    // A gap before every page but the first, inside the configured range.
    expect(sleeps).toHaveLength(6);
    for (const s of sleeps) expect(s).toBeGreaterThanOrEqual(OUTREACH.pageGapMs[0]);
    const f = loadOutreach(file);
    expect(f.companies["Acme Robotics"]).toEqual({ id: "1234", slug: "acmerobotics" });
    expect(f.pagesToday.count).toBe(7);
    const kept = f.people.filter((p) => !p.executive);
    expect(kept.length).toBeLessThanOrEqual(OUTREACH.perCompany);
    expect(kept.map((p) => p.name)).not.toContain("Sam Quinn");
    expect(f.people.find((p) => p.executive)?.name).toBe("Morgan Ash");
    expect(kept.every((p) => p.status === "found")).toBe(true);
    expect(kept.length).toBeGreaterThan(OUTREACH.maxRecruiters);
    expect(f.jobs.job1?.found).toBe(kept.length);
    // A second run finds the company in the record and nobody new.
    const again = browser([]);
    await findPeople(profile, [entry()], deps(file, again));
    expect(again.urls.some((u) => u.includes("/companies/"))).toBe(false);
    expect(loadOutreach(file).people).toHaveLength(f.people.length);
  });

  it("stops at a security check, pauses until tomorrow, and loads nothing more", async () => {
    const file = tmp();
    ack(file);
    const check: PageRead = { ...fixture, url: "https://www.linkedin.com/checkpoint/challenge/x", cards: [] };
    const b = browser([companySearch, companyPage, check]);
    const r = await findPeople(profile, [entry(), entry({ id: "job2", company: "Globex" })], deps(file, b));
    expect(r.stopped).toMatch(/security check/);
    expect(b.urls).toHaveLength(3);
    const f = loadOutreach(file);
    expect(Date.parse(f.pausedUntil ?? "")).toBeGreaterThan(NOW.getTime());
    expect(f.jobs.job1).toBeUndefined();
    expect(refusal(f, NOW)).toMatch(/paused/);
  });

  it("stops at the sign-in page without pausing, and at the day's page limit", async () => {
    const file = tmp();
    ack(file);
    const b = browser([{ ...fixture, url: "https://www.linkedin.com/login/" }]);
    const r = await findPeople(profile, [entry()], deps(file, b));
    expect(r.stopped).toMatch(/sign-in/);
    expect(loadOutreach(file).pausedUntil).toBeNull();

    const full = tmp();
    ack(full);
    mutateOutreach((f) => void (f.pagesToday = { date: "2026-11-26", count: OUTREACH.pagesPerDay - 1 }), full);
    const c = browser([companySearch, companyPage]);
    const r2 = await findPeople(profile, [entry()], deps(full, c));
    expect(c.urls).toHaveLength(1);
    expect(r2.stopped).toMatch(/pages are used/);
  });

  it("does not search a company LinkedIn has no clear page for, and takes the page the person names", async () => {
    const file = tmp();
    ack(file);
    const b = browser([{ ...companySearch, companyLinks: [{ href: "https://www.linkedin.com/company/other/", text: "Other" }] }]);
    const r = await findPeople(profile, [entry()], deps(file, b));
    expect(b.urls).toHaveLength(1);
    expect(r.jobs[0]?.note).toMatch(/no company page/);
    setCompanyPage("Acme Robotics", "https://www.linkedin.com/company/acmerobotics/", file);
    expect(loadOutreach(file).companies["Acme Robotics"]).toEqual({ id: null, slug: "acmerobotics" });
    expect(loadOutreach(file).jobs.job1).toBeUndefined();
    const c = browser([companyPage]);
    await findPeople(profile, [entry()], deps(file, c));
    expect(c.urls[0]).toBe("https://www.linkedin.com/company/acmerobotics/");
    expect(loadOutreach(file).companies["Acme Robotics"]).toEqual({ id: "1234", slug: "acmerobotics" });
  });
});

describe("choosing jobs and the person's own marks", () => {
  it("takes recent applications outreach has not looked at, best fit first", () => {
    const f = loadOutreach(tmp());
    const old = entry({ id: "old" }, { appliedAt: "2026-10-01T00:00:00.000Z" });
    const queued = entry({ id: "q" }, { status: "queued" });
    const best = entry({ id: "best" }, { fit: { score: 0.9 } as never });
    const done = entry({ id: "done" });
    f.jobs.done = { at: NOW.toISOString(), found: 1, note: null };
    expect(chooseJobs([old, queued, entry(), best, done], f, NOW, []).jobs.map((e) => e.job.id)).toEqual(["best", "job1"]);
    // A job named by id is taken whatever its state, unless outreach looked at it already and again is not given.
    expect(chooseJobs([old, done], f, NOW, ["old", "done", "gone"])).toMatchObject({ jobs: [old], missing: ["gone"], skipped: 1 });
    expect(chooseJobs([old, done], f, NOW, ["done"], true).jobs).toEqual([done]);
  });

  it("records a note as sent, and says when one follow-up is due", () => {
    const file = tmp();
    mutateOutreach((f) => {
      f.people.push({ id: "abc123def456", profileUrl: "https://www.linkedin.com/in/example-a/", name: "Avery Stone", headline: "Recruiter", location: "", mutualLine: "", company: "Acme Robotics", role: "Software Engineer Intern", kind: "recruiter", degree: 3, warm: { sharedSchool: false, mutuals: 0 }, executive: false, why: "a recruiter there", jobId: "job1", status: "found", foundAt: NOW.toISOString(), sentAt: null, updatedAt: NOW.toISOString() });
    }, file);
    expect(() => markPerson("zzz", "sent", NOW, file)).toThrow(/no person/);
    const p = markPerson("abc1", "sent", NOW, file);
    expect(p.sentAt).toBe(NOW.toISOString());
    expect(followUpsDue(loadOutreach(file), 7, new Date(NOW.getTime() + 8 * 86_400_000))).toHaveLength(1);
    expect(followUpsDue(loadOutreach(file), 7, NOW)).toHaveLength(0);
  });
});

describe("the sheet and older records", () => {
  it("writes one row per person under the sheet's columns, executives after the rest of their job", () => {
    const f = loadOutreach(tmp());
    const base = { profileUrl: "https://www.linkedin.com/in/example-a/", headline: "Engineer", location: "Seattle, Washington", mutualLine: "Casey Morgan, Drew Hale & 1 other mutual connections", company: "Acme Robotics", role: "Software Engineer Intern", kind: "team_engineer" as const, degree: 2 as const, warm: { sharedSchool: true, mutuals: 3 }, why: "an engineer in the area of the role", jobId: "job1", status: "found" as const, foundAt: NOW.toISOString(), sentAt: null, updatedAt: NOW.toISOString() };
    f.people.push({ ...base, id: "exec", name: "Morgan Ash", executive: true }, { ...base, id: "eng", name: "Jordan Lee", executive: false });
    const rows = peopleRows(f);
    expect(rows[0]).toEqual([...PEOPLE_COLUMNS]);
    expect(rows.slice(1).map((r) => r[2])).toEqual(["Jordan Lee", "Morgan Ash"]);
    expect(rows[1]).toEqual(["Acme Robotics", "Software Engineer Intern", "Jordan Lee", "Engineer", "an engineer in the area of the role", "yes", "Casey Morgan, Drew Hale & 1 other mutual connections", "2nd", "Seattle, Washington", "found", "", "https://www.linkedin.com/in/example-a/", "2026-11-26", "job1", "eng"]);
    expect(rows[2]?.[4]).toMatch(/^executive: /);
  });

  it("writes the sheet with every change to the record, and only for the person's own record", () => {
    const file = tmp();
    const sheet = file.replace(/\.json$/, ".csv");
    mutateOutreach((f) => void (f.riskAcknowledgedAt = NOW.toISOString()), file, sheet);
    expect(readFileSync(sheet, "utf8").split("\r\n")[0]).toBe(PEOPLE_COLUMNS.join(","));
  });

  it("reads a record from before: an alum is an engineer, and the old drafts are let go", () => {
    const file = tmp();
    mutateOutreach(() => {}, file);
    const raw = JSON.parse(readFileSync(file, "utf8"));
    raw.people = [{ id: "a1", profileUrl: "https://www.linkedin.com/in/example-a/", name: "Jordan Lee", headline: "Engineer", company: "Acme Robotics", kind: "alum", degree: 3, warm: { sharedSchool: true, mutuals: 0 }, why: "an alum of your school who works there", jobId: "job1", drafts: { connect: "Hi", message: "Hi", inmail: null }, draftNote: null, status: "found", foundAt: NOW.toISOString(), updatedAt: NOW.toISOString() }];
    writeFileSync(file, JSON.stringify(raw));
    const p = loadOutreach(file).people[0];
    expect(p?.kind).toBe("team_engineer");
    expect(p && "drafts" in p).toBe(false);
  });
});

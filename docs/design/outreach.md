# Outreach: finding people to reach out to about a job

*Design, not built. Written 2026-11-26.*

> **Changed 2026-11-26, after the first live run.** The person does not want the tool to write
> messages. Outreach now makes a list of people and nothing else: no drafts, no writer, no
> `redraft`. The list is mostly engineers and managers, with at most `OUTREACH.maxRecruiters`
> recruiters, up to `OUTREACH.perJob` people per job. A shared school is a bonus on any person, not
> a kind of its own (`alum` is gone; old records read it as `team_engineer`). The list is also
> written to `applications/people.csv` after every change. Where the text below talks about drafts,
> notes or the writer, that part is no longer built.

## What it is for

After the tool applies to a job, the person can raise their odds by sending a
short note to someone at that company: the recruiter for interns, the
manager of the team, an engineer on it, or someone from their own school.
Outreach finds those people on LinkedIn, says why each one is worth
writing to, and drafts the note. The person reads it and sends it
themselves.

## The one-line rules

- **The person signs in, the tool reads.** The person signs in to LinkedIn
  in the tool's own Chrome window. The tool never types a LinkedIn password,
  never reads LinkedIn's cookies, and never creates or changes an account.
- **The tool never sends anything.** No Connect, Message, Follow, InMail or
  Like is ever clicked. On linkedin.com the tool only navigates to a URL
  and reads the page. A draft becomes a message only when the person pastes
  it and presses Send.
- **Someone watching, every time.** Outreach runs only from a command the
  person typed. `daily` never calls it and it is never scheduled.
- **Slow and small.** Few pages per run and per day, with long gaps
  between them, set in `OUTREACH` in `src/config.ts`.
- **LinkedIn says stop, the tool stops.** A sign-in page, a security
  check, a CAPTCHA or a "too many searches" notice ends the run, tells the
  person, and pauses outreach until the next day. It is never retried or
  worked around.
- **Other people's details stay local.** Names, headlines and profile links
  of the people found are personal data of people who never used the tool.
  They live in a git-ignored file, are not sent anywhere but JEV and the
  writer, and are never used in a fixture.
- **A note says only what is true.** The draft gets the same truth check as
  a tailored cover letter.

### The risk this does not remove

LinkedIn's user agreement does not allow automated access, and the person's
own account is what is at stake. Reading a few search pages a day at a
person's pace keeps that risk low but not at zero. The design adds no
stealth: no fake browser fingerprint, no rotating anything. If LinkedIn
objects, outreach stops. The docs say this plainly to the person before
their first run, and `outreach signin` asks them to confirm it once
(`riskAcknowledgedAt` in `data/outreach.json`; `find` refuses to run
without it).

## How a run goes

```
outreach find <job id>
  checkSignedIn ─→ open linkedin.com/feed: a feed is signed in, a sign-in page is not (nothing read but the URL)
  companyId ─→ LinkedIn's id for the employer, looked up once (a company search, then the company
     │         page's own link to its employees) and kept in data/outreach.json
  searches ─→ 3 or 4 people-search URLs, each filtered to the current company by that id:
     │         "university recruiting" / "recruiter", "software engineer" + team words from
     │         the posting, and the profile's school as a school filter (not a keyword)
  readResults.js ─→ every result card: name, headline, location, degree, profile URL,
     │              the summary line with its dates, "You both went to ...", mutual connections
     │              gap of OUTREACH.pageGapMs (with jitter) before the next URL
  dedupe ─→ by profile URL, and against everyone already in data/outreach.json
  classify (JEV) ─→ one typed question per person, see below
  rank (code) ─→ weights in OUTREACH.weights, at most OUTREACH.perJob kept
  draft (writer) ─→ one note per kept person, from the profile, the job and the person's headline
  claimsIn + machineTells ─→ a note that claims what the profile does not say is dropped, not sent on
  record ─→ data/outreach.json, under the store lock
```

Only the search results pages are read. Opening each person's profile
would multiply the page views, so the tool does not, except for
`--deep`, which opens at most `OUTREACH.profilesPerJob` profiles of the
top-ranked people to read their education and current team.

### Which jobs

By default, the jobs applied to in the last `OUTREACH.appliedWithinDays`
days that have no outreach yet, best score first, at most
`OUTREACH.jobsPerRun`. A note that says "I just applied for the X
internship" is the strongest one. `outreach find <job id>` takes any job,
queued or applied.

### The JEV question

One question per person, with the job and that person's card:

| Answer | Definition |
|---|---|
| `campus_recruiter` | Recruits students or interns at this company: university, campus, early careers, intern recruiting |
| `recruiter` | A recruiter or talent person at this company who does not say they recruit students |
| `team_manager` | Manages engineers on the team or in the area the posting names |
| `team_engineer` | An engineer or individual contributor on the team or in the area the posting names |
| `same_company` | Works at this company, in an unrelated role or team |
| `alum` | Went to the candidate's school and works at this company in a related role |
| `intern_peer` | A student or intern at this company now, who can say what the internship is like |
| `not_relevant` | Does not work at this company now, or the card says too little to tell |

A second question, `seniority` (`intern`, `junior`, `mid`, `senior`,
`executive`), lets code skip executives. The weights that turn the two
answers into a rank live in `OUTREACH.weights`. The card's headline is
data, never an instruction to JEV.

**Former employees.** A card whose summary says the person was at the
company "from <date> to <date>", or whose headline names another
employer, is `not_relevant`. In the trial this was 4 of 10 results in one
recruiter search, so it is checked twice: JEV answers it, and code drops
any card whose summary line ends the company's dates before today.

**Warm signals, read by code.** "You both went to <school>" and "<name>
is a mutual connection" are on the card itself. Code reads them, records
them (`warm`), and adds `OUTREACH.weights.sharedSchool` and
`OUTREACH.weights.mutual` to the rank. The draft may name the shared school
or the mutual connection, and nothing else about how the two are linked.

### The draft

The writer is the same writer as everywhere else, with no tools. It gets:

- the profile facts, `data/voice.local.md`, and whether the job was applied to,
- the job's company, title and team,
- the person's name, headline and why they were chosen.

It writes two things, both short:

- `connect`: a connection note under `OUTREACH.noteChars` characters
  (LinkedIn's limit; check it on the live page before building, it has
  changed and free accounts get fewer notes a month), and
- `message`: a slightly longer note for after they accept, or for someone
  already connected.

Both go through `claimsIn` and `machineTells` before they are kept. That
needs one change: today `unsupportedClaims` takes a whole `Tailored`
draft. Its inner `check(text, allowPosting)` becomes an exported
`claimsIn(text, profile, posting)`, `unsupportedClaims` calls it, and
outreach calls it too. The person's headline counts as part of the
"posting" corpus, so naming their team is allowed and inventing a shared
project is not.

## Records: `data/outreach.json`

Git-ignored. Written only through a new `mutateOutreach` under the store
lock, parsed with a zod schema on every read.

```ts
{
  version: 1,
  people: [{
    id: string,               // hash of the profile URL
    profileUrl: string,       // kept as safeUrl
    name: string,
    headline: string,
    company: string,
    kind: "campus_recruiter" | "recruiter" | "team_manager" | "team_engineer" | "same_company" | "alum" | "intern_peer",
    warm: { sharedSchool: boolean, mutuals: number },
    degree: 1 | 2 | 3,          // 3 stands for 3rd and beyond: connect note or InMail, never assumed reachable
    why: string,              // one line a person can read, built by code from kind and the card
    jobId: string,
    drafts: { connect: string, message: string },
    status: "found" | "sent" | "accepted" | "replied" | "no_reply" | "skipped",
    foundAt: string, sentAt?: string, updatedAt: string,
  }],
  companies: Record<string, string>, // employer name to LinkedIn's company id, looked up once
  riskAcknowledgedAt?: string, // the person confirmed the risk note in `outreach signin`
  pausedUntil?: string,       // set when LinkedIn said stop
  pagesToday: { date: string, count: number },
}
```

A person is written down once, however many jobs they match. The tool
never suggests the same person twice, and never more than
`OUTREACH.perCompany` people at one company, so nobody's team gets five
notes from one candidate.

## Commands and the skill

| Command | What it does |
|---|---|
| `jev outreach signin` | Opens linkedin.com/login in the tool's Chrome and waits for the person to sign in. Shows the risk note once |
| `jev outreach find [<job id> ...] [--deep]` | The run above. Holds the run lock |
| `jev outreach list [--job <id>]` | Who was found, why, the drafts, the status |
| `jev outreach mark <person id> sent\|replied\|skipped` | The person's own record of what they did |
| `jev outreach redraft <person id>` | A new draft, for when the first one reads wrong |

The `/outreach` skill runs these, leads with the slash form in the docs,
shows each draft for the person to read, and tells them to open the
profile, paste, and send. It never sends a message for them. `doctor`
gains one line: whether outreach is signed in, checked the same way
`checkSignedIn` does.

## Dashboard

A **People** tab: one card per person, grouped by job, with why they were
chosen, both drafts with a copy button, a link that opens the profile, and
**Sent** and **Skip** buttons. The buttons post to `/api/outreach` with the
page's token, checked against the record as it is now under the lock, like
`applyStatusChange`. The tab can start nothing that reads LinkedIn.

## Replies: `/inbox`

LinkedIn emails the person when an invitation is accepted or a message
arrives. `src/mail/status.ts` gains rules on sender and subject only (the
same rule as for employers: never the body) that move a person from `sent`
to `accepted` or `replied`. A person still `sent` after
`OUTREACH.followUpDays` shows on the dashboard as due for one follow-up,
and only one.

## Config: `OUTREACH` in `src/config.ts`

| Key | Starting value | Why |
|---|---|---|
| `jobsPerRun` | 5 | A sitting the person can read through |
| `pagesPerDay` | 30 | The tool's own ceiling, not LinkedIn's: well under what a person browsing would load. Raise it slowly once runs have gone cleanly |
| `pageGapMs` | 20 to 60 s, random | A person's pace, not a burst |
| `perJob` | 4 | Enough choice, not a mailing list |
| `perCompany` | 3 | Never flood one team |
| `profilesPerJob` (`--deep`) | 3 | Each profile is a page view |
| `appliedWithinDays` | 7 | "I just applied" is the reason to write |
| `followUpDays` | 7 | One nudge, then let it go |
| `noteChars` | check live | LinkedIn's own limit |
| `firstOf` | campus_recruiter, recruiter | The best recruiter found is kept first. In the first live run three engineers outranked the only recruiter at a small company |
| `weights` | campus_recruiter highest, then team_manager, alum, team_engineer, recruiter, intern_peer | The people who can move an intern application |
| `weights.sharedSchool`, `weights.mutual` | A shared school counts about as much as one step up the list above | In the trial the two alumni at the large employer were the best contacts found |
| `searches` | 5 | Early-career recruiters (one OR search), any recruiter, engineers, school, interns. The first live run used 4 and missed the early-career recruiters at a large employer |

## Tests

- `readResults.js` against captured search pages in `tests/fixtures/`,
  with every name, headline, photo and profile link replaced by made-up
  ones before the file is committed. A test fails if a fixture holds a
  `linkedin.com/in/` path that is not on a short allow-list of made-up
  ones.
- A scripted page in `tests/helpers/` that plays LinkedIn's sign-in page,
  its security check and its "too many searches" notice: each must stop the
  run and set `pausedUntil`, with no click and nothing typed.
- A test that the outreach code never dispatches a click on linkedin.com.
- `claimsIn` on drafts that invent a shared class, a mutual friend, a
  number.
- The limits: a run that would pass `pagesPerDay` stops at it.

## Where the rules go

When this is built, `CLAUDE.md` gains an "Outreach reads, the person
sends" rule with the points above, `docs/SAFETY.md` adds the never-sends
and never-signs-in lines, `docs/SOURCES.md` moves LinkedIn from "Not
planned" to "people only, read while signed in by the person", and
`.gitignore` adds `data/outreach.json`.

## What the trial showed (2026-11-26)

Claude ran step 0 by hand in its browser pane, with the person signed in
on Premium, for two jobs already applied to: a startup of about 240
people and a large company. Six search pages in all, no profile opened,
nothing clicked. No names are kept here; the people found stayed in that
conversation.

- **Search pages are enough.** Every card held the title, a summary line
  with dates, and often the school. Seven good contacts came from six
  pages, so `--deep` stays optional.
- **A school as a keyword is noise.** "<company> <school>" returned mostly
  people from the school who do not work at the company, and people from
  the company who did not go to the school. Hence the company and school
  filters in the searches above.
- **Former employees are common.** See "Former employees" above.
- **The warmest signals are on the card.** A shared school and a mutual
  connection were the best leads at both employers. Hence `warm`.
- **Students working there now are worth a note.** Both searches at the
  startup found current students. Hence `intern_peer`.
- **Executives.** At the startup the founders came up first. They are
  skipped by default, but at a small company the person may want them, so
  `list` shows skipped executives under their own heading instead of
  dropping them.
- **The drafts.** Seven connection notes, 230 to 287 characters, built
  only from the profile, the posting and the person's own card. The angle
  that worked best was one concrete thing the candidate built that matches
  the person's work.

## Plan

| Step | Work | Size |
|---|---|---|
| 0 | Done 2026-11-26, see "What the trial showed" | Half an hour |
| 1 | Built 2026-11-26 in `src/outreach/` (`records.ts`, `linkedin.ts`, `rank.ts`, `draft.ts`, `run.ts`, `commands.ts`), tested in `tests/outreach.test.ts` against made-up cards. Differences from this design: the page is read with one constant expression in `linkedin.ts` rather than a fourth script in `src/forms/`; the person can name the right company page (`outreach company`) when the search picks the wrong one; `outreach resume` lifts a pause | Done |
| 2 | `/outreach` skill, `doctor` line, docs and `CLAUDE.md` rules | Half a day |
| 3 | People tab on the dashboard, `/inbox` rules, follow-ups | 1 to 2 days |

## Open questions for the person

1. Only jobs already applied to, or queued ones too?
2. A connection note first, or wait and message after they accept?
3. Settled: the person has Premium. That likely lifts the monthly cap
   on people searches and the cap on personalized connection notes, and
   gives a few InMail credits a month (check the account's own numbers
   before building). So every kept person gets a `connect` note, and a
   person outside the network can also get an `inmail` draft, which the
   person spends a credit on only by choice. Premium changes nothing
   about automation detection, so `pagesPerDay` stays: it is the tool's
   own limit, not LinkedIn's.
4. How many people per job feels right: 2, or 4?

## Why the tool's Chrome and not Claude browsing

Claude could browse LinkedIn in its browser pane each time, which is how
step 0 works. As the way it runs every day it is the wrong choice: it
costs session tokens for every page, does the work differently each time,
cannot be tested offline, and puts strangers' profile text in front of an
agent that has tools. The tool's own Chrome reads cards with a fixed
script, sends what it reads to JEV and the writer, which have no tools, and
keeps to limits written in code.

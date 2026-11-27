---
name: report
description: Open the user's dashboard, the main screen of the tool. Use when the user says /report, "show me my applications", "how is the search going", "what needs me", "open the dashboard", or wants to answer a form's question, change a status, or turn the daily run on or off without typing commands.
model: claude-sonnet-5-5
effort: low
---

# /report: the dashboard

Run from the repo root:

```
npx jev report --open
```

It starts a page on the user's own machine (`http://127.0.0.1:4545`) and
opens it. Nothing leaves the machine. The command keeps running until they
press Ctrl-C. The page has four screens:

- **Overview.** One line (sent today, waiting, ready to apply to), four
  numbers (sent, replies, needs you, ready to apply), applications over
  the last 14 days, and the most recent ones. While an `/apply`, daily,
  `/resume` or reconcile run works, a live panel on top shows it as it
  goes: a progress bar over the run's jobs (and the day's target for a
  daily run), the form being worked on and its stage (open, fill, answer,
  send), every job's ending, and the latest steps. A daily run can be asked
  to stop after its current application from there. After a run ends, the
  panel folds into what that run did, for 12 hours.
- **Needs you.** Everything only they can do, each with its button:
  - a question a form asked that their profile could not answer. They
    type or pick the answer and press "Save for next run". Nothing is
    sent then: the job goes back in the queue and the next `/apply` or
    daily run fills it with that answer. "Remember for future applications" keeps the
    answer as a standing answer. A question about the right to work has no
    box: that answer is one per country and lives in the profile
    (`/profile`).
  - a form open and waiting (an emailed code, a robot check, a sign-in):
    "Show the form" brings it to the front, "Find the email" opens their
    mail at a search for it. They do it, then `/resume`.
  - a form clicked and never confirmed: "I got a confirmation", or "It was
    not sent".
  - an email the tool could not place: they pick the application and what
    it says.
- **Applications.** Every job, with tabs (Applied, Needs you, Queued,
  Skipped, All), a search box and the reply that came back. Clicking a
  row opens its details at the side, with the status and the notes.
- **Daily run.** A "Run every day" switch with a time (turning it off
  removes the schedule), the next run, "Stop after this application"
  while a run is working, today's result in one line, and their daily
  rules as a form. Turning the switch on installs the schedule;
  that is their click, not yours.

`npx jev report --static applications/report.html` writes a snapshot page
with Overview and Applications only, for keeping or sending. Nothing can be
changed from a snapshot.

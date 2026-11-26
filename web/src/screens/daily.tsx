import { useState } from "react";
import { CircleStopIcon, LoaderIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { PageHeader } from "@/components/page";
import { boardName, useChange, type Automation, type Policy } from "@/lib/api";

/** How a choice the rules may hold is written on the page. */
const WORDS: Record<string, string> = { vancouver: "Vancouver", canada: "Canada", remote: "Remote", us: "US", international: "International", unclear: "Unclear", internship: "Internship", new_grad: "New grad" };
const named = <T extends string>(values: readonly T[], name: (v: string) => string = (v) => WORDS[v] ?? v): [T, string][] => values.map((v) => [v, name(v)]);

/** A cost as dollars with enough places to show it: a day of JEV is often a fraction of a cent. */
const dollars = (usd: number) => (usd > 0 && usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`);

/** A row of toggles over a list of values. None pressed means "any", as the policy reads it. */
function Choices<T extends string>({ id, options, value, onChange }: { id: string; options: [T, string][]; value: T[]; onChange: (v: T[]) => void }) {
  return (
    <ToggleGroup id={id} multiple variant="outline" size="sm" spacing={1.5} value={value} onValueChange={(v) => onChange(v as T[])} className="flex-wrap">
      {options.map(([k, l]) => (
        <ToggleGroupItem key={k} value={k} className="px-3 data-pressed:bg-primary data-pressed:text-primary-foreground">
          {l}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/** The rules form. It starts from the saved rules and is remounted when they change, so a reload never undoes what is being typed. */
function Rules({ auto }: { auto: Automation }) {
  const start = auto.policy ?? auto.defaults;
  const [p, setP] = useState<Policy>(start);
  const [exclude, setExclude] = useState(start.excludeEmployers.join(", "));
  const { busy, run } = useChange();

  const L = auto.limits;
  const save = () => void run("/api/policy", { ...p, excludeEmployers: exclude.split(",").map((x) => x.trim()).filter(Boolean) }, "Daily rules saved");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your daily rules</CardTitle>
        <CardDescription>Which jobs the daily run may apply to. A run reads these when it starts.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {auto.policyError ? <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{auto.policyError}</p> : null}
        <div className="grid gap-5 sm:grid-cols-3">
          <Field className="gap-2">
            <FieldLabel htmlFor="pTarget">Applications a day</FieldLabel>
            <Input id="pTarget" type="number" min={1} max={L.maxTarget} value={p.target} onChange={(e) => setP({ ...p, target: Number(e.target.value) })} />
            <FieldDescription>At most {L.maxTarget}.</FieldDescription>
          </Field>
          <Field className="gap-2">
            <FieldLabel htmlFor="pScore">Lowest fit score</FieldLabel>
            <Input id="pScore" type="number" min={0} max={1} step={0.05} value={p.minScore} onChange={(e) => setP({ ...p, minScore: Number(e.target.value) })} />
            <FieldDescription>From 0 to 1.</FieldDescription>
          </Field>
          <Field className="gap-2">
            <FieldLabel htmlFor="pBudget">JEV budget a day ($)</FieldLabel>
            <Input id="pBudget" type="number" min={0} step={0.05} value={p.jevBudgetUsd} onChange={(e) => setP({ ...p, jevBudgetUsd: Number(e.target.value) })} />
            <FieldDescription>JEV only. Claude is on your own plan or key.</FieldDescription>
          </Field>
        </div>

        <Field className="gap-2">
          <FieldLabel htmlFor="pWhere">Where</FieldLabel>
          <Choices id="pWhere" options={named(auto.choices.where)} value={p.where} onChange={(where) => setP({ ...p, where })} />
          <FieldDescription>None picked means anywhere the search kept.</FieldDescription>
        </Field>
        <Field className="gap-2">
          <FieldLabel htmlFor="pLevels">Kind of job</FieldLabel>
          <Choices id="pLevels" options={named(auto.choices.levels)} value={p.levels} onChange={(levels) => setP({ ...p, levels })} />
          <FieldDescription>None picked means both.</FieldDescription>
        </Field>
        <Field className="gap-2">
          <FieldLabel htmlFor="pBoards">Job boards</FieldLabel>
          <Choices id="pBoards" options={named(auto.choices.boards, boardName)} value={p.boards} onChange={(b) => setP({ ...p, boards: b })} />
          <FieldDescription>None picked means every board the tool fills.</FieldDescription>
        </Field>
        <Field className="gap-2">
          <FieldLabel htmlFor="pExclude">Never apply to</FieldLabel>
          <Input id="pExclude" value={exclude} onChange={(e) => setExclude(e.target.value)} placeholder="Company names, separated by commas" />
        </Field>
        <Field className="gap-3">
          <FieldLabel>Documents</FieldLabel>
          <Label className="w-fit gap-2 font-normal">
            <Checkbox id="pTailor" checked={p.documents.tailor} onCheckedChange={(c) => setP({ ...p, documents: { ...p.documents, tailor: c === true } })} />A resume written for each job
          </Label>
          <Label className="w-fit gap-2 font-normal">
            <Checkbox id="pCover" checked={p.documents.cover} onCheckedChange={(c) => setP({ ...p, documents: { ...p.documents, cover: c === true } })} />A cover letter where a form has a box for one
          </Label>
        </Field>
      </CardContent>
      <CardFooter className="flex-col items-start gap-3">
        <Button id="pSave" onClick={save} disabled={busy}>
          Save rules
        </Button>
        <p className="text-xs leading-5 text-muted-foreground">
          Fixed limits, the same for everyone: at most {L.perBoard} a day to one job board, {L.perEmployerPerDay} a day to one employer, {L.gapMinutes[0]} to {L.gapMinutes[1]} minutes between two applications to one
          board, and a run of at most {L.maxMinutes} minutes. A board that asks whether a person is there is left alone until tomorrow.
        </p>
      </CardFooter>
    </Card>
  );
}

/** The daily switch and its time. Remounted when the saved schedule changes, so a reload never undoes an edit. */
function Schedule({ auto }: { auto: Automation }) {
  const sch = auto.schedule;
  const [at, setAt] = useState(sch.at);
  const { busy, run } = useChange();
  const schedule = (on: boolean, time = at) => void run("/api/schedule", { on, at: time }, on ? `Runs every day at ${time}` : "Daily run turned off");
  return (
    <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-3">
      <Label className="gap-3 text-sm">
        <Switch id="autoOn" checked={sch.on} disabled={!auto.policy || busy} onCheckedChange={(c) => schedule(c)} />
        Run every day
      </Label>
      <div className="flex items-center gap-2">
        <Label htmlFor="autoAt" className="text-sm font-normal text-muted-foreground">
          at
        </Label>
        <Input id="autoAt" type="time" value={at} onChange={(e) => setAt(e.target.value)} onBlur={() => sch.on && at !== sch.at && schedule(true, at)} className="h-8 w-auto" />
        <span className="text-xs text-muted-foreground">{auto.timezone}</span>
      </div>
    </CardContent>
  );
}

export function DailyRun({ auto }: { auto: Automation }) {
  const sch = auto.schedule;
  const last = auto.today.length ? auto.today[auto.today.length - 1]! : null;
  const { busy, run } = useChange();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Daily run" description="Sends a few applications a day inside your rules, with nobody watching." />

      {auto.running ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg bg-info/10 px-4 py-3 text-sm text-info ring-1 ring-info/20">
          <LoaderIcon className="size-4 animate-spin" />
          <span className="font-medium">{auto.stopAsked ? "A run is working now and will stop after this application." : "A run is working now."}</span>
          {!auto.stopAsked ? (
            <Button id="autoStop" size="sm" variant="outline" className="ml-auto" disabled={busy} onClick={() => void run("/api/stop", {}, "It will stop after this application")}>
              <CircleStopIcon data-icon="inline-start" />
              Stop after this application
            </Button>
          ) : null}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Apply automatically</CardTitle>
          <CardDescription>
            {!auto.policy
              ? "Save your daily rules first."
              : sch.on && sch.next
                ? `Next run ${new Date(sch.next).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`
                : "Off. Nothing runs by itself."}
          </CardDescription>
        </CardHeader>
        <Schedule key={`${sch.on}:${sch.at}`} auto={auto} />
        <CardFooter className="flex-col items-start gap-1 text-xs text-muted-foreground">
          {last ? (
            <p className="text-sm text-foreground">
              Today: {last.sent.length} sent, {last.waiting.length + last.unconfirmed.length} need you, {last.leftForYou.length} could not be sent. Stopped because {last.stoppedBecause}. JEV cost {dollars(last.jevUsd)}.
            </p>
          ) : null}
          <p>Your computer has to be on, and you signed in, at that time. The tool's Chrome window opens while it works.</p>
        </CardFooter>
      </Card>

      <Rules key={JSON.stringify(auto.policy)} auto={auto} />
    </div>
  );
}

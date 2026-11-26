import { useState } from "react";
import { CheckCheckIcon, ExternalLinkIcon, MailIcon, MonitorUpIcon, TriangleAlertIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldLabel } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader, Section } from "@/components/page";
import { errorText, needCount, post, useChange, type Needs } from "@/lib/api";

function JobLink({ href, children }: { href: string; children: string }) {
  return (
    <a href={href} target="_blank" rel="noopener" className="inline-flex items-center gap-1 underline-offset-4 hover:text-foreground hover:underline">
      {children}
      <ExternalLinkIcon className="size-3" />
    </a>
  );
}

function QuestionCard({ job }: { job: Needs["questions"][number] }) {
  // Keyed by the question itself, as the server checks it: a reload that changes the open questions never moves an answer.
  const [values, setValues] = useState<Record<string, string>>({});
  const [keep, setKeep] = useState<Record<string, boolean>>({});
  const { busy, run } = useChange();
  const askable = job.items.filter((x) => x.kind === "ask");

  const save = () => {
    const answers = askable.map((x) => ({ question: x.question, answer: (values[x.question] ?? "").trim(), remember: !!keep[x.question] })).filter((a) => a.answer);
    if (!answers.length) return void toast.warning("Type an answer first");
    void run("/api/answer", { id: job.id, answers }, `${job.company} is back in the queue`);
  };

  return (
    <Card data-job={job.id}>
      <CardHeader>
        <CardTitle>
          {job.company} needs {job.items.length === 1 ? "one answer" : `${job.items.length} answers`}
        </CardTitle>
        <CardDescription>
          <JobLink href={job.link}>{job.title}</JobLink>
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {job.items.map((x, n) => (
          <Field key={x.question} className="gap-2">
            <FieldLabel htmlFor={`${job.id}-${n}`} className="leading-5">
              {x.question}
            </FieldLabel>
            {x.kind !== "ask" ? (
              <p className="flex gap-2 rounded-md bg-warning/10 px-3 py-2 text-sm text-warning">
                <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
                {x.note}
              </p>
            ) : (
              <>
                {x.options.length ? (
                  <NativeSelect id={`${job.id}-${n}`} data-q={n} value={values[x.question] ?? ""} onChange={(e) => setValues({ ...values, [x.question]: e.target.value })} className="max-w-md">
                    <NativeSelectOption value="">Choose</NativeSelectOption>
                    {x.options.map((o) => (
                      <NativeSelectOption key={o} value={o}>
                        {o}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                ) : (
                  <Textarea id={`${job.id}-${n}`} data-q={n} value={values[x.question] ?? ""} onChange={(e) => setValues({ ...values, [x.question]: e.target.value })} placeholder="Your answer, in your own words" className="max-w-2xl" />
                )}
                {x.canRemember ? (
                  <Label className="w-fit gap-2 text-sm font-normal text-muted-foreground">
                    <Checkbox data-keep={n} checked={!!keep[x.question]} onCheckedChange={(c) => setKeep({ ...keep, [x.question]: c === true })} />
                    Remember for future applications
                  </Label>
                ) : null}
              </>
            )}
          </Field>
        ))}
      </CardContent>
      {askable.length ? (
        <CardFooter className="flex-wrap gap-x-4 gap-y-2">
          <Button data-answer={job.id} onClick={save} disabled={busy}>
            Save for next run
          </Button>
          <p className="text-xs text-muted-foreground">Nothing is sent now. The next run fills the form with this answer.</p>
        </CardFooter>
      ) : null}
    </Card>
  );
}

function WaitingCard({ w }: { w: Needs["waiting"][number] }) {
  const [shown, setShown] = useState<string | null>(null);
  const show = async () => {
    try {
      const r = await post<{ ok: boolean }>("/api/show", { id: w.id });
      setShown(r.ok ? "It is in front now" : "Its window is closed");
    } catch (err) {
      toast.error(errorText(err));
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {w.company}: {w.todo}
        </CardTitle>
        <CardDescription>
          {w.title}
          {w.reason ? ` · ${w.reason}` : ""}
        </CardDescription>
      </CardHeader>
      <CardFooter className="flex-wrap gap-x-2 gap-y-2">
        {w.open ? (
          <Button data-show={w.id} onClick={show}>
            <MonitorUpIcon data-icon="inline-start" />
            {shown ?? "Show the form"}
          </Button>
        ) : (
          <span className="text-sm text-muted-foreground">Its window was closed. It is on your by-hand list.</span>
        )}
        {w.mail ? (
          <Button variant="outline" render={<a href={w.mail} target="_blank" rel="noopener" />} nativeButton={false}>
            <MailIcon data-icon="inline-start" />
            Find the email
          </Button>
        ) : null}
        <p className="w-full text-xs text-muted-foreground sm:ml-auto sm:w-auto">Finish it in the tool's Chrome window, then type /resume in Claude Code.</p>
      </CardFooter>
    </Card>
  );
}

function UnconfirmedCard({ u }: { u: Needs["unconfirmed"][number] }) {
  const { busy, run } = useChange();
  const settle = (status: "applied" | "queued", done: string) => void run("/api/status", { id: u.id, status, was: "submission_unknown" }, done);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{u.company}</CardTitle>
        <CardDescription>
          <JobLink href={u.link}>{u.title}</JobLink>
        </CardDescription>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">Look for a confirmation email from them. It is never sent again until you say which it was.</CardContent>
      <CardFooter className="gap-2">
        <Button data-set={u.id} data-to="applied" disabled={busy} onClick={() => settle("applied", `${u.company} marked as applied`)}>
          I got a confirmation
        </Button>
        <Button variant="outline" data-set={u.id} data-to="queued" disabled={busy} onClick={() => settle("queued", `${u.company} is back in the queue`)}>
          It was not sent
        </Button>
      </CardFooter>
    </Card>
  );
}

const KINDS: Record<string, string> = { confirmation: "Received the application", rejection: "Said no", assessment: "Sent an assessment", interview: "Asked for an interview", offer: "Made an offer" };

function MailCard({ m }: { m: Needs["mail"][number] }) {
  const [jobId, setJobId] = useState("");
  const [kind, setKind] = useState<string>(m.kind ?? "confirmation");
  const { busy, run } = useChange();
  return (
    <Card data-mail={m.id}>
      <CardHeader>
        <CardTitle>{m.subject}</CardTitle>
        <CardDescription>
          From {m.from}, {m.on}. {m.why}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <Field className="gap-2">
          <FieldLabel htmlFor={`mj-${m.id}`}>Which application</FieldLabel>
          <NativeSelect id={`mj-${m.id}`} data-mjob value={jobId} onChange={(e) => setJobId(e.target.value)}>
            <NativeSelectOption value="">Choose</NativeSelectOption>
            {m.jobs.map((j) => (
              <NativeSelectOption key={j.id} value={j.id}>
                {j.company} | {j.title}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <Field className="gap-2">
          <FieldLabel htmlFor={`mk-${m.id}`}>What it says</FieldLabel>
          <NativeSelect id={`mk-${m.id}`} data-mkind value={kind} onChange={(e) => setKind(e.target.value)}>
            {Object.entries(KINDS).map(([k, l]) => (
              <NativeSelectOption key={k} value={k}>
                {l}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
      </CardContent>
      <CardFooter className="gap-2">
        <Button data-mail-ok={m.id} disabled={!jobId || busy} onClick={() => void run("/api/mail", { id: m.id, jobId, kind }, "Reply recorded")}>
          Save
        </Button>
        <Button variant="ghost" data-mail-no={m.id} disabled={busy} onClick={() => void run("/api/mail", { id: m.id }, "Set aside")}>
          Not about an application
        </Button>
      </CardFooter>
    </Card>
  );
}

export function NeedsYou({ needs }: { needs: Needs }) {
  const total = needCount(needs);
  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Needs you" description={total ? `${total} ${total === 1 ? "thing" : "things"} only you can do` : "Things only you can do show up here."} />

      {!total ? (
        <Empty className="rounded-lg bg-card py-16 ring-1 ring-foreground/10">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CheckCheckIcon />
            </EmptyMedia>
            <EmptyTitle>All caught up</EmptyTitle>
            <EmptyDescription>Nothing needs you right now.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}

      {needs.waiting.length ? (
        <Section title="Forms open and waiting" count={needs.waiting.length}>
          {needs.waiting.map((w) => (
            <WaitingCard key={w.id} w={w} />
          ))}
        </Section>
      ) : null}

      {needs.questions.length ? (
        <Section title="Questions only you can answer" count={needs.questions.length}>
          {needs.questions.map((j) => (
            <QuestionCard key={j.id} job={j} />
          ))}
        </Section>
      ) : null}

      {needs.unconfirmed.length ? (
        <Section title="Sent, but not confirmed" count={needs.unconfirmed.length}>
          {needs.unconfirmed.map((u) => (
            <UnconfirmedCard key={u.id} u={u} />
          ))}
        </Section>
      ) : null}

      {needs.mail.length ? (
        <Section title="Emails to sort" count={needs.mail.length}>
          {needs.mail.map((m) => (
            <MailCard key={m.id} m={m} />
          ))}
        </Section>
      ) : null}
    </div>
  );
}

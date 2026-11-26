import { useMemo, useState } from "react";
import { ArrowDownIcon, ArrowUpIcon, ChevronLeftIcon, ChevronRightIcon, ExternalLinkIcon, SearchIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/status-badge";
import { PageHeader } from "@/components/page";
import { LEFT_FOR_YOU, STATUSES, boardName, humanStatus, reasonOf, statusWords, useChange, type Report, type Row } from "@/lib/api";
import { cn } from "@/lib/utils";

const PAGE = 50;

const TABS: { key: string; label: string; keep: (r: Row) => boolean }[] = [
  { key: "applied", label: "Applied", keep: (r) => r.status_key === "applied" },
  { key: "needs", label: "Left for you", keep: (r) => LEFT_FOR_YOU.includes(r.status_key) },
  { key: "queued", label: "Queued", keep: (r) => r.status_key === "queued" },
  { key: "skipped", label: "Skipped", keep: (r) => r.status_key === "skipped" },
  { key: "all", label: "All", keep: () => true },
];

type SortKey = "applied_on" | "posted_on" | "company" | "fit_score";

/** A YYYY-MM-DD day as "Nov 23", with the year only when it is not this one. */
function day(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return "";
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString([], { month: "short", day: "numeric", ...(d.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) });
}

function SortHead({ k, label, sort, dir, onSort, className }: { k: SortKey; label: string; sort: SortKey; dir: number; onSort: (k: SortKey) => void; className?: string }) {
  const Arrow = dir > 0 ? ArrowUpIcon : ArrowDownIcon;
  return (
    <TableHead className={className}>
      <button type="button" onClick={() => onSort(k)} className="inline-flex cursor-pointer items-center gap-1 hover:text-foreground">
        {label}
        {sort === k ? <Arrow className="size-3" /> : null}
      </button>
    </TableHead>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  if (!children) return null;
  return (
    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-3 text-sm leading-5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

/** The notes box. It starts from the saved notes and keeps what is typed until it is saved, whatever reloads meanwhile. */
function Notes({ row }: { row: Row }) {
  const [notes, setNotes] = useState(row.notes);
  const { busy, run } = useChange();
  return (
    <Field className="gap-2">
      <FieldLabel htmlFor="sheet-notes">Notes</FieldLabel>
      <Textarea id="sheet-notes" data-notes={row.job_id} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Your notes" className="min-h-24" />
      <div>
        <Button size="sm" variant="secondary" disabled={busy || notes === row.notes} onClick={() => void run("/api/status", { id: row.job_id, notes }, "Notes saved")}>
          Save notes
        </Button>
      </div>
    </Field>
  );
}

function JobSheet({ row, live, onClose }: { row: Row | null; live: boolean; onClose: () => void }) {
  const { busy, run } = useChange();

  // A status the page does not offer (a run's own, or one waiting on you) is shown as it is, never as another.
  const offered = row ? STATUSES.includes(row.status_key) : true;

  return (
    <Sheet open={!!row} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto p-0 data-[side=right]:sm:max-w-[30rem]">
        {row ? (
          <>
            <SheetHeader className="border-b px-5 py-4">
              <div className="flex items-center gap-2 pr-8">
                <SheetTitle className="truncate">{row.company}</SheetTitle>
                <StatusBadge statusKey={row.status_key} label={statusWords(row)} />
              </div>
              <SheetDescription>{row.role}</SheetDescription>
            </SheetHeader>
            <div className="flex flex-col gap-5 px-5 py-5">
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" render={<a href={row.job_link} target="_blank" rel="noopener" />} nativeButton={false}>
                  Open the posting <ExternalLinkIcon data-icon="inline-end" />
                </Button>
                {row.takehome_link ? (
                  <Button variant="outline" size="sm" render={<a href={row.takehome_link} target="_blank" rel="noopener" />} nativeButton={false}>
                    Take-home <ExternalLinkIcon data-icon="inline-end" />
                  </Button>
                ) : null}
              </div>
              <dl className="flex flex-col gap-2.5">
                <Detail label="Posted">{day(row.posted_on)}</Detail>
                <Detail label="Applied">{day(row.applied_on)}</Detail>
                <Detail label="Location">{row.location}</Detail>
                <Detail label="Board">{boardName(row.ats)}</Detail>
                <Detail label="Fit">{row.fit_score}</Detail>
                <Detail label="Level">{[row.level, row.term].filter(Boolean).join(", ")}</Detail>
                <Detail label="Reply">{row.response ? `${row.response}${row.response_on ? ` · ${row.response_on}` : ""}` : ""}</Detail>
                <Detail label="Why">{reasonOf(row)}</Detail>
                <Detail label="What they do">{row.what_they_do}</Detail>
                <Detail label="Why you fit">{row.why_fit}</Detail>
              </dl>
              {live ? (
                <div className="flex flex-col gap-4 border-t pt-5">
                  <Field className="gap-2">
                    <FieldLabel htmlFor="sheet-status">Status</FieldLabel>
                    <NativeSelect
                      id="sheet-status"
                      data-id={row.job_id}
                      data-was={row.status_key}
                      value={offered ? row.status_key : ""}
                      disabled={busy}
                      onChange={(e) => e.target.value && void run("/api/status", { id: row.job_id, status: e.target.value, was: row.status_key }, `${row.company}: ${humanStatus(e.target.value)}`)}
                    >
                      {!offered ? (
                        <NativeSelectOption value="" disabled>
                          {statusWords(row)}
                        </NativeSelectOption>
                      ) : null}
                      {STATUSES.map((s) => (
                        <NativeSelectOption key={s} value={s}>
                          {humanStatus(s)}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </Field>
                  {/* Remounted when the saved notes change, never when a reload brings the same ones back. */}
                  <Notes key={`${row.job_id}:${row.notes}`} row={row} />
                </div>
              ) : row.notes ? (
                <Detail label="Notes">{row.notes}</Detail>
              ) : null}
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

export function Applications({ report, live }: { report: Report; live: boolean }) {
  const [tab, setTab] = useState(() => ["applied", "needs", "queued"].find((k) => report.rows.some(TABS.find((t) => t.key === k)!.keep)) ?? "all");
  const [q, setQ] = useState("");
  // Sent jobs read newest first; the rest have no date, so they read best fit first.
  const sortFor = (k: string): SortKey => (k === "applied" ? "applied_on" : "fit_score");
  const [sort, setSort] = useState<SortKey>(() => sortFor(tab));
  const [dir, setDir] = useState(-1);
  const [page, setPage] = useState(0);
  const pickTab = (k: string) => {
    setTab(k);
    setSort(sortFor(k));
    setDir(-1);
    setPage(0);
  };
  const [openId, setOpenId] = useState<string | null>(null);

  const counts = useMemo(() => Object.fromEntries(TABS.map((t) => [t.key, report.rows.filter(t.keep).length])), [report]);
  const rows = useMemo(() => {
    const keep = TABS.find((t) => t.key === tab)!.keep;
    const needle = q.trim().toLowerCase();
    const out = report.rows.filter(keep).filter((r) => !needle || [r.company, r.role, r.ats, r.location, r.status, r.skip_reason].join(" ").toLowerCase().includes(needle));
    const val = (r: Row) => (sort === "fit_score" ? Number(r.fit_score) || 0 : String(r[sort] ?? ""));
    return out.sort((a, b) => {
      const x = val(a), y = val(b);
      const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
      return c * dir || a.company.localeCompare(b.company);
    });
  }, [report, tab, q, sort, dir]);

  // The day sent is shown only where some job in view was sent.
  const withApplied = rows.some((r) => r.applied_on);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  // A reload can leave fewer rows than the page asked for: show the last page there is, never an empty one.
  const at = Math.min(page, pages - 1);
  const shown = rows.slice(at * PAGE, at * PAGE + PAGE);
  const open = openId ? (report.rows.find((r) => r.job_id === openId) ?? null) : null;

  const onSort = (k: SortKey) => {
    setPage(0);
    if (k === sort) setDir(-dir);
    else {
      setSort(k);
      setDir(k === "company" ? 1 : -1);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Applications" description={`${report.totals.considered.toLocaleString()} jobs considered`} />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Tabs value={tab} onValueChange={(v) => pickTab(String(v))}>
          <TabsList id="tabs" className="max-w-full overflow-x-auto">
            {TABS.map((t) => (
              <TabsTrigger key={t.key} value={t.key} data-tab={t.key} className="px-2.5">
                {t.label}
                <span className="text-xs text-muted-foreground tabular-nums">{counts[t.key]?.toLocaleString()}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="relative w-full lg:max-w-xs">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input id="q" type="search" value={q} onChange={(e) => (setQ(e.target.value), setPage(0))} placeholder="Search" aria-label="Search applications" className="h-9 bg-card pr-9 pl-9" />
          {q ? (
            <button type="button" aria-label="Clear search" onClick={() => (setQ(""), setPage(0))} className="absolute top-1/2 right-2 grid size-6 -translate-y-1/2 cursor-pointer place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
              <XIcon className="size-3.5" />
            </button>
          ) : null}
        </div>
      </div>

      <div className="overflow-hidden rounded-lg bg-card ring-1 ring-foreground/10">
        <Table id="table" className="min-w-[640px] table-fixed">
          <TableHeader className="bg-raised/70">
            <TableRow className="hover:bg-transparent">
              <SortHead k="company" label="Company" sort={sort} dir={dir} onSort={onSort} className="pl-4" />
              <TableHead className="w-44">Status</TableHead>
              <TableHead className="hidden w-32 md:table-cell">Board</TableHead>
              <SortHead k="fit_score" label="Fit" sort={sort} dir={dir} onSort={onSort} className="w-16" />
              <SortHead k="posted_on" label="Posted" sort={sort} dir={dir} onSort={onSort} className={cn("w-28", !withApplied && "pr-4")} />
              {withApplied ? <SortHead k="applied_on" label="Applied" sort={sort} dir={dir} onSort={onSort} className="w-28 pr-4" /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((r) => (
              <TableRow key={r.job_id} data-row={r.job_id} onClick={() => setOpenId(r.job_id)} className={cn("cursor-pointer", openId === r.job_id && "bg-muted")}>
                <TableCell className="pl-4">
                  <p className="truncate font-medium">{r.company}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {r.role}
                    {r.location ? ` · ${r.location}` : ""}
                  </p>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    <StatusBadge statusKey={r.status_key} label={statusWords(r)} />
                    {r.response ? <StatusBadge statusKey="queued" label={r.response} /> : null}
                    {r.takehome_link ? <StatusBadge statusKey="" label="Take-home" /> : null}
                  </div>
                </TableCell>
                <TableCell className="hidden truncate text-muted-foreground md:table-cell">{boardName(r.ats)}</TableCell>
                <TableCell className="font-mono text-xs tabular-nums">{r.fit_score}</TableCell>
                <TableCell className={cn("text-xs text-muted-foreground tabular-nums", !withApplied && "pr-4")} title={r.posted_on}>
                  {day(r.posted_on)}
                </TableCell>
                {withApplied ? (
                  <TableCell className="pr-4 text-xs text-muted-foreground tabular-nums" title={r.applied_on}>
                    {day(r.applied_on)}
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
            {!shown.length ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={withApplied ? 6 : 5} className="py-12 text-center text-sm text-muted-foreground">
                  {q ? "Nothing matches that search." : "Nothing here yet."}
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>

      {rows.length > PAGE ? (
        <div className="flex items-center justify-end gap-3 text-xs text-muted-foreground">
          <span className="tabular-nums">
            {(at * PAGE + 1).toLocaleString()}-{Math.min(rows.length, (at + 1) * PAGE).toLocaleString()} of {rows.length.toLocaleString()}
          </span>
          <div className="flex gap-1">
            <Button variant="outline" size="icon-sm" aria-label="Previous page" disabled={at === 0} onClick={() => setPage(at - 1)}>
              <ChevronLeftIcon />
            </Button>
            <Button variant="outline" size="icon-sm" aria-label="Next page" disabled={at >= pages - 1} onClick={() => setPage(at + 1)}>
              <ChevronRightIcon />
            </Button>
          </div>
        </div>
      ) : null}

      <JobSheet row={open} live={live} onClose={() => setOpenId(null)} />
    </div>
  );
}

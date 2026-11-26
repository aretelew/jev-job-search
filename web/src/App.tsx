import { useCallback, useEffect, useState, type ReactNode } from "react";
import { BriefcaseIcon, CalendarClockIcon, InboxIcon, LayoutDashboardIcon, RefreshCwIcon, TriangleAlertIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { loadAll, needCount, ReloadContext, type Data, type Loaded } from "@/lib/api";
import { Overview } from "@/screens/overview";
import { NeedsYou } from "@/screens/needs";
import { Applications } from "@/screens/applications";
import { DailyRun } from "@/screens/daily";

const SCREENS = [
  { key: "overview", label: "Overview", icon: LayoutDashboardIcon, live: false },
  { key: "needs", label: "Needs you", icon: InboxIcon, live: true },
  { key: "applications", label: "Applications", icon: BriefcaseIcon, live: false },
  { key: "daily", label: "Daily run", icon: CalendarClockIcon, live: true },
] as const;
export type Screen = (typeof SCREENS)[number]["key"];

/** The screen the address names, when this page has it; Overview otherwise. */
function screenFrom(hash: string, live: boolean): Screen {
  const named = SCREENS.find((s) => s.key === hash.replace(/^#\/?/, "") && (live || !s.live));
  return named?.key ?? "overview";
}

/** A screen's data, or why it could not be loaded, shown in the screen's place. */
function Show<T>({ loaded, children }: { loaded: Loaded<T>; children: (value: T) => ReactNode }) {
  if (loaded.error !== undefined)
    return (
      <p className="flex items-center gap-2 rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
        <TriangleAlertIcon className="size-4" />
        This could not be loaded: {loaded.error}
      </p>
    );
  return <>{children(loaded.value)}</>;
}

export function App() {
  const [data, setData] = useState<Data | null>(null);
  const [hash, setHash] = useState(window.location.hash);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await loadAll());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    const onHash = () => setHash(window.location.hash);
    // Coming back to the tab shows what a run did meanwhile.
    const onFocus = () => void reload();
    window.addEventListener("hashchange", onHash);
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener("focus", onFocus);
    };
  }, [reload]);

  const live = data?.live ?? false;
  const screen = screenFrom(hash, live);
  const shown = SCREENS.filter((s) => live || !s.live);
  const current = shown.find((s) => s.key === screen) ?? shown[0]!;
  const count = data?.live && data.needs.value ? needCount(data.needs.value) : 0;
  // Switching screens is only a new address: the hashchange above follows it.
  const go = (s: Screen) => void (window.location.hash = s);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [screen]);

  return (
    <ReloadContext.Provider value={reload}>
      <SidebarProvider>
        <Sidebar collapsible="icon">
          <SidebarHeader>
            <div className="flex h-8 items-center gap-2 px-1.5 group-data-[collapsible=icon]:px-0">
              <div className="grid size-6 shrink-0 place-items-center rounded-md bg-primary text-[11px] font-bold text-primary-foreground">J</div>
              <span className="truncate text-sm font-semibold group-data-[collapsible=icon]:hidden">jev-job-search</span>
            </div>
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu id="nav">
                  {shown.map((s) => (
                    <SidebarMenuItem key={s.key}>
                      <SidebarMenuButton isActive={s.key === screen} tooltip={s.label} onClick={() => go(s.key)} data-screen={s.key}>
                        <s.icon />
                        <span>{s.label}</span>
                      </SidebarMenuButton>
                      {s.key === "needs" && count ? <SidebarMenuBadge className="bg-warning/15 text-warning">{count}</SidebarMenuBadge> : null}
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
          <SidebarFooter>
            <p className="px-2 pb-1 text-xs leading-4 text-muted-foreground group-data-[collapsible=icon]:hidden">
              {data && !data.live ? "A saved snapshot. Nothing can be changed here." : "Runs on this computer only."}
            </p>
          </SidebarFooter>
        </Sidebar>
        <SidebarInset className="min-w-0 bg-canvas">
          <header className="sticky top-0 z-10 flex h-12 shrink-0 items-center gap-2 border-b bg-canvas/85 px-4 backdrop-blur">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-1 data-vertical:h-4" />
            <span className="text-sm font-medium">{current.label}</span>
            <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
              {data?.report.value ? <span className="hidden sm:inline">Updated {new Date(data.report.value.generatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span> : null}
              {live ? (
                <Button variant="ghost" size="icon-sm" aria-label="Refresh" onClick={() => void reload()} disabled={loading}>
                  <RefreshCwIcon className={loading ? "animate-spin" : ""} />
                </Button>
              ) : null}
            </div>
          </header>
          <main className="mx-auto w-full max-w-6xl min-w-0 px-4 pt-6 pb-16 sm:px-6 lg:px-8">
            {!data ? (
              <div className="flex flex-col gap-4">
                <Skeleton className="h-7 w-48" />
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  {[0, 1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-24" />
                  ))}
                </div>
                <Skeleton className="h-64" />
              </div>
            ) : (
              <section id={`s-${screen}`}>
                {screen === "overview" ? <Show loaded={data.report}>{(report) => <Overview report={report} needs={data.live ? data.needs.value : undefined} live={data.live} go={go} />}</Show> : null}
                {screen === "applications" ? <Show loaded={data.report}>{(report) => <Applications report={report} live={data.live} />}</Show> : null}
                {screen === "needs" && data.live ? <Show loaded={data.needs}>{(needs) => <NeedsYou needs={needs} />}</Show> : null}
                {screen === "daily" && data.live ? <Show loaded={data.auto}>{(auto) => <DailyRun auto={auto} />}</Show> : null}
              </section>
            )}
          </main>
        </SidebarInset>
      </SidebarProvider>
    </ReloadContext.Provider>
  );
}

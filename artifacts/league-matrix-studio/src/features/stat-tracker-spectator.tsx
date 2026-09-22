import { useEffect, useState } from "react";
import { Link, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  Clock3,
  List,
  Radio,
  RefreshCw,
  Trophy,
  Wifi,
  WifiOff,
  Zap,
} from "lucide-react";
import {
  useGetStatTrackerShare,
  getGetStatTrackerShareQueryKey,
  type StatTrackerShare,
  type StatTrackerEvent,
} from "@workspace/api-client-react";

function formatDate(value: string) {
  if (!value) return "";
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

function formatEventTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function getPhaseLabel(sport: string) {
  switch (sport) {
    case "baseball":
    case "softball":
      return "Inning";
    case "basketball":
    case "football":
      return "Quarter";
    case "soccer":
      return "Half";
    case "volleyball":
      return "Set";
    default:
      return "Period";
  }
}

function formatStatKey(key: string) {
  const label = key.replace(/-/g, " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function getStatusCopy(status: string) {
  switch (status) {
    case "live":
      return { label: "LIVE", detail: "Game in progress", tone: "live" as const };
    case "paused":
      return { label: "PAUSED", detail: "Updates on hold", tone: "paused" as const };
    case "final":
      return { label: "FINAL", detail: "Game complete", tone: "final" as const };
    default:
      return { label: "SETUP", detail: "Game not started", tone: "setup" as const };
  }
}

export function PublicStatTrackerPage() {
  const params = useParams<{ shareToken?: string }>();
  const shareToken = params.shareToken || "";

  const [connectionStatus, setConnectionStatus] = useState<"connecting" | "connected" | "reconnecting">("connecting");
  const [unavailable, setUnavailable] = useState(false);
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

  const queryClient = useQueryClient();
  const queryKey = getGetStatTrackerShareQueryKey(shareToken);

  const hasEventSource = typeof window !== "undefined" && "EventSource" in window;
  const { data, isLoading, isError, refetch } = useGetStatTrackerShare(shareToken, {
    query: {
      enabled: Boolean(shareToken),
      retry: false,
      refetchInterval: 15000,
      queryKey,
    },
  });

  useEffect(() => {
    if (isError) setUnavailable(true);
  }, [isError]);

  useEffect(() => {
    if (!data) return;
    const expiresAt = Date.parse(data.expiresAt);
    if (!Number.isFinite(expiresAt)) return;
    const remaining = expiresAt - Date.now();
    if (remaining <= 0) {
      setUnavailable(true);
      return;
    }
    const timer = window.setTimeout(() => setUnavailable(true), remaining);
    return () => window.clearTimeout(timer);
  }, [data?.expiresAt]);

  useEffect(() => {
    if (!data) return;
    const expiresAt = Date.parse(data.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      setUnavailable(true);
    } else if (!isError) {
      setUnavailable(false);
    }
  }, [data, isError]);

  useEffect(() => {
    if (!shareToken || !hasEventSource) return;

    const url = `${basePath}/api/stat-tracker-shares/${encodeURIComponent(shareToken)}/events`;
    const sse = new window.EventSource(url);

    sse.onopen = () => {
      setConnectionStatus("connected");
      refetch();
    };

    sse.onerror = () => {
      setConnectionStatus("reconnecting");
    };

    sse.addEventListener("stat-tracker", (event: MessageEvent) => {
      try {
        const update = JSON.parse(event.data) as StatTrackerShare;
        if (Date.parse(update.expiresAt) <= Date.now()) {
          setUnavailable(true);
          return;
        }
        queryClient.setQueryData(queryKey, (old: StatTrackerShare | undefined) => {
          if (!old || update.revision > old.revision) return update;
          return old;
        });
        setUnavailable(false);
      } catch {
        // Ignore malformed events and keep the polling fallback alive.
      }
    });

    sse.addEventListener("revoked", () => {
      sse.close();
      setUnavailable(true);
      queryClient.removeQueries({ queryKey });
      void refetch();
    });

    return () => {
      sse.close();
    };
  }, [shareToken, refetch, queryClient, queryKey, basePath, hasEventSource]);

  if (isLoading && !data && !unavailable) {
    return (
      <div className="min-h-dvh bg-background text-foreground" data-testid="public-stat-tracker-page">
        <div className="mx-auto flex min-h-[calc(100dvh-72px)] w-full max-w-[1080px] items-center justify-center px-5 py-12 sm:px-8">
          <div className="w-full max-w-sm border border-primary/30 bg-card/80 p-6 text-center shadow-lg clip-angled">
            <div className="mx-auto flex h-12 w-12 items-center justify-center border border-primary/50 bg-primary/10 text-primary">
              <Radio className="h-5 w-5 animate-pulse" />
            </div>
            <p className="mt-5 text-[10px] font-bold uppercase tracking-[0.24em] text-primary" role="status">
              Loading live scoreboard
            </p>
            <div className="mt-4 space-y-2" aria-hidden="true">
              <div className="mx-auto h-2 w-3/4 animate-pulse bg-muted" />
              <div className="mx-auto h-12 w-1/2 animate-pulse bg-muted" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (unavailable || isError || !data) {
    return (
      <div className="min-h-dvh bg-background text-foreground" data-testid="public-stat-tracker-unavailable">
        <div className="mx-auto flex min-h-[calc(100dvh-72px)] w-full max-w-[1080px] flex-col items-center justify-center px-5 py-12 text-center sm:px-8">
          <div className="border border-accent/40 bg-card p-8 clip-angled sm:p-12">
            <WifiOff className="mx-auto h-10 w-10 text-accent" />
            <p className="mt-6 text-[10px] font-bold uppercase tracking-[0.28em] text-accent">Signal ended</p>
            <h1 className="mt-3 font-display text-4xl uppercase tracking-wide sm:text-5xl">Scoreboard unavailable</h1>
            <p className="mx-auto mt-4 max-w-md text-sm font-medium leading-relaxed text-muted-foreground">
              This live link has expired, was revoked, or the game has been removed.
            </p>
            <Link
              href="/"
              className="mt-8 inline-flex items-center gap-2 bg-foreground px-5 py-3 text-xs font-bold uppercase tracking-widest text-background clip-angled-sm hover:bg-primary hover:text-primary-foreground"
            >
              <ArrowLeft className="h-4 w-4" /> Return to Home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const game = data.game;
  const phaseLabel = getPhaseLabel(game.sport);
  const status = getStatusCopy(game.status);
  const allStats = [
    ...Object.entries(game.stats || {}).map(([key, value]) => ({ key, value: String(value) })),
    ...Object.entries(game.yardStats || {}).map(([key, value]) => ({ key, value: `${value} yds` })),
  ];
  const recentEvents = game.events.slice().reverse();
  const updatedTime = new Date(data.updatedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const statusTone = {
    live: "border-primary/55 bg-primary text-primary-foreground",
    paused: "border-accent/55 bg-accent text-accent-foreground",
    final: "border-foreground/20 bg-foreground/10 text-foreground",
    setup: "border-foreground/20 bg-foreground/10 text-foreground",
  }[status.tone];

  return (
    <div className="noise min-h-dvh overflow-hidden bg-background text-foreground" data-testid="public-stat-tracker-page">
      <div className="pointer-events-none fixed inset-0 bg-tech-grid opacity-30" aria-hidden="true" />
      <div className="relative mx-auto w-full max-w-[1180px] px-4 pb-16 pt-4 sm:px-8 sm:pt-7 lg:px-10">
        <header className="flex items-center justify-between border-b border-foreground/10 pb-4 sm:pb-5">
          <Link
            href="/"
            className="group inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-1" /> Home
          </Link>
          <div className="flex items-center gap-3 text-[10px] font-bold uppercase tracking-[0.17em]" data-testid="connection-status">
            <span className="hidden text-muted-foreground sm:inline">Pixl Sports / Live board</span>
            <span className="h-3 w-px bg-foreground/20" aria-hidden="true" />
            {hasEventSource ? (
              connectionStatus === "connected" ? (
                <span className="inline-flex items-center gap-1.5 text-primary">
                  <Wifi className="h-3.5 w-3.5" /> Live Sync
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Reconnecting
                </span>
              )
            ) : (
              <span className="inline-flex items-center gap-1.5 text-primary">
                <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Live Polling
              </span>
            )}
          </div>
        </header>

        <main className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(300px,.75fr)] lg:gap-7">
          <section className="min-w-0">
            <div className="relative overflow-hidden border border-primary/45 bg-card shadow-xl clip-angled" data-testid="stat-tracker-scores">
              <div className="pointer-events-none absolute inset-0 bg-tech-grid-dark opacity-25" aria-hidden="true" />
              <div className="relative border-b border-foreground/10 px-5 py-4 sm:px-8 sm:py-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span
                    className={`inline-flex items-center gap-2 border px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.2em] ${statusTone}`}
                    data-testid="stat-tracker-status"
                  >
                    {status.tone === "live" && <span className="h-2 w-2 animate-pulse rounded-full bg-current" />}
                    {status.label}
                  </span>
                  <span className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                    <Clock3 className="h-3.5 w-3.5" /> Updated {updatedTime}
                  </span>
                </div>
                <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-primary">Game day / live feed</p>
                    <h1 className="mt-2 truncate font-display text-3xl uppercase leading-none tracking-wide sm:text-5xl" data-testid="text-stat-tracker-matchup">
                      {data.teamName || "Team"} <span className="text-accent">vs</span> {game.opponent || "Opponent TBD"}
                    </h1>
                    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-medium text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5 text-accent" /> {formatDate(game.date)}</span>
                      <span className="inline-flex items-center gap-1.5"><Zap className="h-3.5 w-3.5 text-accent" /> {status.detail}</span>
                    </div>
                  </div>
                  <div className="shrink-0 border-l-2 border-accent pl-4 sm:text-right">
                    <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">{phaseLabel}</p>
                    <p className="mt-1 font-display text-4xl leading-none text-foreground" data-testid="stat-tracker-period">{game.period}</p>
                  </div>
                </div>
              </div>

              <div className="relative grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-stretch bg-background/35" data-testid="scoreboard-hero">
                <div className="min-w-0 px-4 py-7 sm:px-8 sm:py-10">
                  <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.19em] text-primary">
                    <span className="h-2 w-2 bg-primary" /> Your side
                  </div>
                  <p className="mt-3 truncate text-sm font-bold uppercase tracking-[0.1em] text-foreground sm:text-base" title={data.athleteName || "Athlete"}>
                    {data.athleteName || "Athlete"}
                  </p>
                  <p className="mt-1 truncate text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{data.teamName || "Team"}</p>
                  <p className="mt-5 font-display text-[clamp(4.75rem,14vw,9rem)] leading-[.78] text-primary" data-testid="score-home">{game.score}</p>
                </div>
                <div className="flex flex-col items-center justify-center border-x border-foreground/10 px-3 sm:px-6">
                  <span className="font-display text-xl text-muted-foreground">—</span>
                  <span className="mt-2 text-[9px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Score</span>
                </div>
                <div className="min-w-0 px-4 py-7 text-right sm:px-8 sm:py-10">
                  <div className="flex items-center justify-end gap-2 text-[10px] font-bold uppercase tracking-[0.19em] text-accent">
                    Opponent <span className="h-2 w-2 bg-accent" />
                  </div>
                  <p className="mt-3 truncate text-sm font-bold uppercase tracking-[0.1em] text-foreground sm:text-base" title={game.opponent || "Opponent"}>
                    {game.opponent || "Opponent"}
                  </p>
                  <p className="mt-1 truncate text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Visitors</p>
                  <p className="mt-5 font-display text-[clamp(4.75rem,14vw,9rem)] leading-[.78] text-foreground" data-testid="score-away">{game.opponentScore}</p>
                </div>
              </div>

              <div className="relative flex flex-wrap items-center justify-between gap-3 border-t border-foreground/10 px-5 py-3.5 sm:px-8">
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                  <Trophy className="h-3.5 w-3.5 text-accent" /> {status.detail}
                </div>
                <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Revision {data.revision}</span>
              </div>
            </div>

            {allStats.length > 0 && (
              <section className="mt-5 border border-foreground/10 bg-card p-5 clip-angled sm:p-7" data-testid="stat-tracker-stats-summary">
                <div className="flex items-end justify-between border-b border-foreground/10 pb-4">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-accent">Live line</p>
                    <h2 className="mt-1 font-display text-3xl uppercase tracking-wide">Stats snapshot</h2>
                  </div>
                  <Activity className="h-5 w-5 text-primary" />
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3">
                  {allStats.map(({ key, value }) => (
                    <div key={key} className="border border-foreground/10 bg-background/40 p-3.5 sm:p-4">
                      <p className="truncate text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">{formatStatKey(key)}</p>
                      <p className="mt-2 font-display text-3xl uppercase text-foreground">{value}</p>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </section>

          <aside className="min-w-0" data-testid="stat-tracker-recent-activity">
            <div className="border border-accent/30 bg-card p-5 clip-angled sm:p-6 lg:sticky lg:top-6">
              <div className="flex items-start justify-between border-b border-foreground/10 pb-4">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-accent">Live feed</p>
                  <h2 className="mt-1 font-display text-3xl uppercase tracking-wide">Play-by-play</h2>
                </div>
                <span className="grid h-9 w-9 place-items-center border border-primary/40 bg-primary/10 text-primary">
                  <List className="h-4 w-4" />
                </span>
              </div>
              <div className="mt-4">
                {recentEvents.length > 0 ? (
                  <div className="space-y-1">
                    {recentEvents.map((event: StatTrackerEvent, index) => (
                      <div
                        key={event.id}
                        className="relative border-b border-foreground/10 py-3 pl-7 last:border-0"
                        data-testid={`recent-activity-${event.id}`}
                      >
                        <span className={`absolute left-0 top-[1.05rem] h-2.5 w-2.5 ${index === 0 ? "bg-accent" : "bg-primary/60"}`} aria-hidden="true" />
                        {index < recentEvents.length - 1 && <span className="absolute bottom-0 left-[4px] top-7 w-px bg-foreground/10" aria-hidden="true" />}
                        <div className="flex items-start justify-between gap-3">
                          <span className="min-w-0 truncate text-sm font-bold text-foreground">
                            {formatStatKey(event.statId)}
                            {event.yards != null ? ` · ${event.yards} yds` : ""}
                          </span>
                          <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                            {formatEventTime(event.createdAt)}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-primary">
                          <span>{phaseLabel} {event.period}</span>
                          {index === 0 && <span className="text-accent">Current</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="border border-dashed border-foreground/15 px-4 py-8 text-center">
                    <CheckCircle2 className="mx-auto h-6 w-6 text-muted-foreground" />
                    <p className="mt-3 text-sm font-medium text-muted-foreground">No plays recorded yet.</p>
                    <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground/70">Waiting for first whistle</p>
                  </div>
                )}
              </div>
            </div>
          </aside>
        </main>
      </div>
    </div>
  );
}
import { useEffect, useState } from "react";
import { Link, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { 
  Activity, ArrowLeft, RefreshCw,
  Wifi, WifiOff, List
} from "lucide-react";
import { 
  useGetStatTrackerShare, 
  getGetStatTrackerShareQueryKey,
  type StatTrackerShare,
  type StatTrackerEvent
} from "@workspace/api-client-react";

function formatDate(value: string) {
  if (!value) return '';
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatEventTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function getPhaseLabel(sport: string) {
  switch (sport) {
    case 'baseball':
    case 'softball':
      return 'Inning';
    case 'basketball':
    case 'football':
      return 'Quarter';
    case 'soccer':
      return 'Half';
    case 'volleyball':
      return 'Set';
    default:
      return 'Period';
  }
}

function formatStatKey(key: string) {
  const label = key.replace(/-/g, ' ');
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function PublicStatTrackerPage() {
  const params = useParams<{ shareToken?: string }>();
  const shareToken = params.shareToken || "";
  
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'reconnecting'>('connecting');
  const [unavailable, setUnavailable] = useState(false);
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
  
  const queryClient = useQueryClient();
  const queryKey = getGetStatTrackerShareQueryKey(shareToken);

  const hasEventSource = typeof window !== 'undefined' && 'EventSource' in window;
  const { data, isLoading, isError, refetch } = useGetStatTrackerShare(shareToken, {
    query: {
      enabled: Boolean(shareToken),
      retry: false,
      refetchInterval: 15000,
      queryKey,
    }
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
      setConnectionStatus('connected');
      refetch();
    };

    sse.onerror = () => {
      setConnectionStatus('reconnecting');
    };

    sse.addEventListener('stat-tracker', (event: MessageEvent) => {
      try {
        const update = JSON.parse(event.data) as StatTrackerShare;
        if (Date.parse(update.expiresAt) <= Date.now()) {
          setUnavailable(true);
          return;
        }
        queryClient.setQueryData(queryKey, (old: StatTrackerShare | undefined) => {
          if (!old || update.revision > old.revision) {
            return update;
          }
          return old;
        });
        setUnavailable(false);
      } catch (err) {
        // ignore parse errors
      }
    });

    sse.addEventListener('revoked', () => {
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
      <div className="noise min-h-dvh bg-background text-foreground" data-testid="public-stat-tracker-page">
        <div className="mx-auto flex min-h-[calc(100dvh-72px)] w-full max-w-[860px] items-center justify-center px-4 pt-6 sm:px-8">
          <p className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-muted-foreground" role="status">
            <RefreshCw className="h-4 w-4 animate-spin" />
            Loading live scoreboard…
          </p>
        </div>
      </div>
    );
  }

  if (unavailable || isError || !data) {
    return (
      <div className="noise min-h-dvh bg-background text-foreground" data-testid="public-stat-tracker-unavailable">
        <div className="mx-auto flex min-h-[calc(100dvh-72px)] w-full max-w-[860px] flex-col items-center justify-center px-4 py-12 text-center sm:px-8">
          <WifiOff className="h-10 w-10 text-primary" />
          <h1 className="mt-5 font-display text-4xl uppercase tracking-wide">Scoreboard Unavailable</h1>
          <p className="mx-auto mt-3 max-w-md text-sm font-medium leading-relaxed text-muted-foreground">
            This live link has expired, was revoked, or the game has been removed.
          </p>
          <Link href="/" className="mt-7 inline-flex bg-foreground px-5 py-3 text-xs font-bold uppercase tracking-widest text-background clip-angled-sm hover:bg-primary-ink">
            Return to Home
          </Link>
        </div>
      </div>
    );
  }

  const game = data.game;
  const phaseLabel = getPhaseLabel(game.sport);

  const allStats = [
    ...Object.entries(game.stats || {}).map(([k, v]) => ({ key: k, value: String(v) })),
    ...Object.entries(game.yardStats || {}).map(([k, v]) => ({ key: k, value: `${v} yds` }))
  ];

  return (
    <div className="noise min-h-dvh bg-background text-foreground pb-16" data-testid="public-stat-tracker-page">
      <div className="mx-auto w-full max-w-[860px] px-4 pt-4 sm:px-8 sm:pt-8">
        <header className="mb-6 flex items-center justify-between">
          <Link href="/" className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Home
          </Link>
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground" data-testid="connection-status">
            {hasEventSource ? (
              connectionStatus === 'connected' ? (
                <span className="flex items-center gap-1.5 text-primary"><Wifi className="h-3.5 w-3.5" /> Live Sync</span>
              ) : (
                <span className="flex items-center gap-1.5"><RefreshCw className="h-3.5 w-3.5 animate-spin" /> Reconnecting…</span>
              )
            ) : (
              <span className="flex items-center gap-1.5 text-primary"><RefreshCw className="h-3.5 w-3.5 animate-spin" /> Live Polling</span>
            )}
          </div>
        </header>

        <main className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr] lg:gap-6">
          <div className="order-1 lg:col-start-1 lg:row-start-1">
            <div className="relative min-w-0 border border-primary/40 bg-foreground p-4 text-background clip-angled-sm sm:p-6" data-testid="stat-tracker-scores">
              <div className="flex min-w-0 items-center justify-between gap-3 border-b border-white/10 pb-4">
                <span className={`inline-flex shrink-0 items-center gap-2 px-3 py-1 text-[10px] font-bold uppercase tracking-widest ${game.status === 'live' ? 'bg-primary text-primary-foreground' : game.status === 'paused' ? 'bg-accent text-accent-foreground' : 'bg-white/20 text-white'}`} data-testid="stat-tracker-status">
                  {game.status === 'live' && <span className="h-2 w-2 animate-pulse bg-current" />} 
                  {game.status === 'live' ? 'LIVE' : game.status === 'paused' ? 'PAUSED' : game.status === 'final' ? 'FINAL' : 'SETUP'}
                </span>
                <span className="min-w-0 truncate text-right text-[10px] font-bold uppercase tracking-widest text-white/40" title={`Updated at ${new Date(data.updatedAt).toLocaleTimeString()}`}>
                  Updated {new Date(data.updatedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                </span>
              </div>
              
              <div className="mt-4 flex items-end justify-between">
                <p className="min-w-0 truncate text-xs font-bold uppercase tracking-widest text-white/60">
                  {data.teamName || 'Team'} {game.opponent ? `vs ${game.opponent}` : '— opponent TBD'}
                  <span className="mt-1 block text-[10px] text-white/40">{formatDate(game.date)}</span>
                </p>
                <span className="shrink-0 text-right font-display text-xl uppercase tracking-wide text-white/80 sm:text-2xl">
                  {phaseLabel} {game.period}
                </span>
              </div>

              <div className="mt-5 grid min-w-0 grid-cols-2 gap-2 sm:mt-6 sm:gap-3">
                <div className="min-w-0 border border-white/10 bg-white/5 p-3 text-center sm:p-4">
                  <p className="truncate text-[10px] font-bold uppercase tracking-widest text-white/60">{data.athleteName || 'Athlete'}</p>
                  <p className="mt-2 font-display text-6xl leading-none text-primary sm:text-8xl">{game.score}</p>
                </div>
                <div className="min-w-0 border border-white/10 bg-white/5 p-3 text-center sm:p-4">
                  <p className="truncate text-[10px] font-bold uppercase tracking-widest text-white/60">{game.opponent || 'Opponent'}</p>
                  <p className="mt-2 font-display text-6xl leading-none text-white sm:text-8xl">{game.opponentScore}</p>
                </div>
              </div>
            </div>

            {allStats.length > 0 && (
              <div className="mt-4 border border-border bg-card p-4 clip-angled-sm sm:mt-6 sm:p-6" data-testid="stat-tracker-stats-summary">
                <div className="mb-4 flex items-center justify-between">
                  <p className="text-xs font-bold uppercase tracking-widest text-primary-ink">Stats Summary</p>
                  <Activity className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {allStats.map(({ key, value }) => (
                    <div key={key} className="border border-border/60 bg-background/40 p-3">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{formatStatKey(key)}</p>
                      <p className="mt-1 font-display text-2xl uppercase">{value}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="order-2 lg:col-start-2 lg:row-start-1" data-testid="stat-tracker-recent-activity">
            <div className="sticky top-6 border border-border bg-card p-4 clip-angled-sm sm:p-6">
              <div className="mb-4 flex items-center justify-between">
                <p className="text-xs font-bold uppercase tracking-widest text-primary-ink">Play-by-play</p>
                <List className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="space-y-2">
                {game.events.slice().reverse().map((event: StatTrackerEvent) => (
                  <div key={event.id} className="border-b border-border/60 pb-3 pt-1 text-sm last:border-0 last:pb-0" data-testid={`recent-activity-${event.id}`}>
                    <div className="flex items-center justify-between gap-3">
                      <span className="min-w-0 truncate font-bold text-foreground">
                        {formatStatKey(event.statId)}
                        {event.yards != null ? ` · ${event.yards} yds` : ''}
                      </span>
                      <span className="shrink-0 text-xs font-medium text-muted-foreground">
                        {formatEventTime(event.createdAt)}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center text-[10px] font-bold uppercase tracking-widest text-primary">
                      {phaseLabel} {event.period}
                    </div>
                  </div>
                ))}
                {!game.events.length && (
                  <p className="pt-2 text-sm font-medium text-muted-foreground">No plays recorded yet.</p>
                )}
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

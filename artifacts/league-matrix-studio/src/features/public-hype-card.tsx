import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, Check, ChevronDown, Pause, Play, Send, Volume2, VolumeX, Zap } from 'lucide-react';
import { Link } from 'wouter';
import { useCreateHypeCardShareReply, useGetHypeCardShare, type HypeCardShare } from '@workspace/api-client-react';

import { PreviewArtwork } from './hype-card-preview';
import { getDimensions, normalizeHypeCardProject } from './hype-card-types';
import { getSportRule, isSport } from './stat-tracker';
import { trackEvent } from '../lib/analytics';

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const reactions = ['🔥', '👏', '💪', '⭐', '❤️'] as const;

export function PublicHypeCardPage({ params }: { params: { slug?: string; shareToken?: string } }) {
  const shareToken = params.shareToken ?? '';
  const [isMuted, setIsMuted] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const { data: share, isLoading, isError } = useGetHypeCardShare(shareToken, {
    query: { enabled: Boolean(shareToken), queryKey: ['/api/hype-card-shares', shareToken], retry: false },
  });
  const project = useMemo(() => {
    const manifestProject = share?.manifest && typeof share.manifest.project === 'object'
      ? share.manifest.project
      : share?.manifest;
    return normalizeHypeCardProject({
      ...manifestProject,
      mediaType: share?.mediaType === 'image' ? 'image' : 'video',
      mediaId: share?.mediaType === 'video' ? 'shared-video' : null,
       photo: share?.mediaType === 'image' ? share.mediaUrl ?? null : null,
    });
  }, [share]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || share?.mediaType !== 'video') return;
    const syncPlaying = () => setIsPlaying(!video.paused && !video.ended);
    video.addEventListener('play', syncPlaying);
    video.addEventListener('pause', syncPlaying);
    video.addEventListener('ended', syncPlaying);
    video.addEventListener('error', syncPlaying);
    return () => {
      video.removeEventListener('play', syncPlaying);
      video.removeEventListener('pause', syncPlaying);
      video.removeEventListener('ended', syncPlaying);
      video.removeEventListener('error', syncPlaying);
    };
  }, [share?.mediaType, share?.videoUrl]);

  useEffect(() => {
    if (!share) return;
    const previousTitle = document.title;
    document.title = `${share.title} | Pixl Sports`;
    const upsert = (property: string, content: string) => {
      let element = document.head.querySelector<HTMLMetaElement>(`meta[property="${property}"]`);
      if (!element) {
        element = document.createElement('meta');
        element.setAttribute('property', property);
        document.head.appendChild(element);
      }
      const previous = element.content;
      element.content = content;
      return () => { if (element) element.content = previous; };
    };
    const cleanups = [
      upsert('og:title', share.title),
       upsert('og:description', share.shareMode === 'stats' ? 'View finalized athlete stats from Pixl Sports.' : 'Watch this Hype Card from Pixl Sports.'),
       upsert('og:image', share.posterUrl ? new URL(share.posterUrl, window.location.origin).href : ''),
       upsert('og:type', share.shareMode === 'stats' ? 'website' : share.mediaType === 'video' ? 'video.other' : 'website'),
      upsert('og:video', share.videoUrl ? new URL(share.videoUrl, window.location.origin).href : ''),
      upsert('og:url', window.location.href),
    ];
    return () => {
      document.title = previousTitle;
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [share]);

  if (isLoading) return <PublicShell><p className="text-sm font-bold uppercase tracking-widest text-white/60" role="status">Loading Hype Card…</p></PublicShell>;
  if (isError || !share) {
    return (
      <PublicShell>
        <div className="max-w-md text-center">
          <Zap className="mx-auto h-12 w-12 text-primary" />
          <h1 className="mt-5 font-display text-5xl uppercase text-white">Hype Card not found</h1>
          <p className="mt-3 text-sm font-medium leading-relaxed text-white/60">This link may have expired, been revoked, or been copied incorrectly.</p>
          <Link href="/" className="mt-7 inline-flex items-center gap-2 bg-primary px-5 py-3 text-xs font-bold uppercase tracking-widest text-primary-foreground">Go to Pixl Sports <ArrowUpRight className="h-4 w-4" /></Link>
        </div>
      </PublicShell>
    );
  }
  if (share.shareMode === 'stats') {
    return <PublicHypeCardStatsPage share={share} />;
  }

  const dimensions = getDimensions(project.format);
  const togglePlayback = async () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      try {
        await video.play();
        setIsPlaying(true);
      } catch {
        setIsPlaying(false);
      }
    } else {
      video.pause();
      setIsPlaying(false);
    }
  };
  const toggleStats = () => {
    if (!showStats) {
      trackEvent('hype_card_stats_viewed', {
        media_type: share.mediaType,
      });
    }
    setShowStats((visible) => !visible);
  };
  return (
    <div className="noise min-h-dvh bg-[#0B1F3A] text-white">
      <header className="border-b border-white/10 bg-[#11141b]">
        <div className="mx-auto flex h-[72px] max-w-[1400px] items-center justify-between px-5 sm:px-8">
          <Link href="/"><img src={`${basePath}/pixlsports-logo.png`} alt="Pixl Sports" className="h-11 w-auto max-w-[176px] object-contain" /></Link>
          <Link href="/studio" className="text-xs font-bold uppercase tracking-widest text-white/60 hover:text-white">Create yours <ArrowUpRight className="ml-1 inline h-4 w-4" /></Link>
        </div>
      </header>
      <main className="mx-auto grid min-h-[calc(100dvh-72px)] max-w-[1280px] items-center gap-8 px-4 py-8 lg:grid-cols-[minmax(0,1fr)_340px] lg:px-8">
        <div className="relative mx-auto w-full max-w-[660px] overflow-hidden rounded-[22px] shadow-[0_30px_100px_rgba(0,0,0,.65)]" style={{ aspectRatio: `${dimensions.width}/${dimensions.height}` }}>
          {share.mediaType === 'image' ? (
            <img src={share.mediaUrl ?? ''} alt={share.mediaName} className="h-full w-full object-contain" />
          ) : (
            <>
              <PreviewArtwork project={project} videoUrl={share.videoUrl ?? undefined} videoRef={videoRef} poster={share.posterUrl ?? undefined} ns="public-share" testId="public-hype-card" muted={isMuted} />
              <div className="absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 bg-black/75 p-2 backdrop-blur">
                <button
                  type="button"
                  onClick={togglePlayback}
                  className="flex min-h-10 items-center gap-2 px-3 text-[10px] font-bold uppercase tracking-widest text-white hover:bg-primary hover:text-primary-foreground"
                  aria-label={isPlaying ? 'Pause highlight' : 'Play highlight'}
                >
                  {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                  {isPlaying ? 'Pause' : 'Play'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsMuted((muted) => !muted);
                    if (isMuted && videoRef.current?.paused) void togglePlayback();
                  }}
                  className="flex min-h-10 items-center gap-2 px-3 text-[10px] font-bold uppercase tracking-widest text-white hover:bg-primary hover:text-primary-foreground"
                  aria-label={isMuted ? 'Enable audio' : 'Mute audio'}
                >
                  {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                  {isMuted ? 'Audio' : 'Mute'}
                </button>
              </div>
            </>
          )}
        </div>
        <aside className="border-l-4 border-primary pl-5">
          <p className="text-xs font-bold uppercase tracking-[.2em] text-primary">Shared Hype Card</p>
          <h1 className="mt-3 font-display text-5xl uppercase leading-[.9] sm:text-6xl">{share.title}</h1>
          <p className="mt-5 text-sm font-medium leading-relaxed text-white/60">
            {share.mediaType === 'video' ? 'The selected highlight plays directly in the card.' : 'High quality Hype Card featured.'} No Pixl Sports account is required.
          </p>
          {share.stats ? (
            <section className="mt-6 border border-white/10 bg-white/5 p-4 clip-angled-sm" data-testid="hype-card-recipient-stats">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[.15em] text-primary">Season Stats</p>
                  <h2 className="mt-1 font-display text-2xl uppercase text-white">{share.stats.athleteName}</h2>
                  <p className="text-xs font-bold uppercase tracking-widest text-white/40">
                    {isSport(share.stats.sport) ? getSportRule(share.stats.sport).label : share.stats.sport}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={toggleStats}
                  aria-expanded={showStats}
                  aria-controls="hype-card-recipient-stats-details"
                  data-testid="button-view-hype-card-stats"
                  className="inline-flex min-h-10 shrink-0 items-center gap-1 border border-primary/50 px-3 text-[10px] font-bold uppercase tracking-widest text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
                >
                  {showStats ? 'Hide details' : 'View athlete stats'}
                  <ChevronDown className={`h-4 w-4 transition-transform ${showStats ? 'rotate-180' : ''}`} />
                </button>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="border border-white/10 bg-white/5 p-2">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-white/60">Games</p>
                  <p className="font-display text-xl text-white">{share.stats.gamesPlayed}</p>
                </div>
                <div className="border border-white/10 bg-white/5 p-2">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-white/60">Score</p>
                  <p className="font-display text-xl text-primary">{share.stats.score}</p>
                </div>
              </div>
              {showStats && (
                <div id="hype-card-recipient-stats-details" className="mt-3 border-t border-white/10 pt-3">
                  <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-white/50">Published finalized totals</p>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {Object.entries(share.stats.stats).map(([statId, count]) => {
                      const rule = isSport(share.stats?.sport) ? getSportRule(share.stats.sport) : null;
                      const definition = rule?.stats.find((s) => s.id === statId);
                      const label = definition?.shortLabel || statId.replace(/-/g, ' ');
                      return (
                        <div key={statId} className="border border-white/10 bg-white/5 p-2">
                          <p className="truncate text-[10px] font-bold uppercase tracking-widest text-white/60">{label}</p>
                          <p className="font-display text-xl text-white">{count}</p>
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-5 border-t border-white/10 pt-4" data-testid="hype-card-recipient-game-summaries">
                    <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-white/50">Finalized games</p>
                    {share.stats.games.length ? (
                      <ol className="space-y-3">
                        {share.stats.games.map((game, index) => (
                          <li key={`${game.date}-${game.opponent}-${index}`} className="border border-white/10 bg-black/20 p-3" data-testid="hype-card-recipient-game-summary">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="text-xs font-bold uppercase tracking-widest text-white">
                                  {game.opponent || `Game ${index + 1}`}
                                </p>
                                <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-white/45">
                                  {formatHypeCardGameDate(game.date)}
                                </p>
                              </div>
                              <p className="shrink-0 font-display text-lg text-primary" aria-label={`${game.score} to ${game.opponentScore}`}>
                                {game.score}–{game.opponentScore}
                              </p>
                            </div>
                            {Object.keys(game.stats).length ? (
                              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                                {Object.entries(game.stats).map(([statId, count]) => {
                                  const rule = isSport(share.stats?.sport) ? getSportRule(share.stats.sport) : null;
                                  const definition = rule?.stats.find((stat) => stat.id === statId);
                                  return (
                                    <div key={statId} className="border border-white/10 bg-white/5 p-2">
                                      <p className="truncate text-[9px] font-bold uppercase tracking-widest text-white/50">{definition?.shortLabel || statId.replace(/-/g, ' ')}</p>
                                      <p className="font-display text-lg text-white">{count}</p>
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              <p className="mt-3 text-[10px] font-bold uppercase tracking-widest text-white/35">No tracked stats</p>
                            )}
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className="text-xs font-medium leading-relaxed text-white/50">Game-by-game summaries are not available for this Hype Card.</p>
                    )}
                  </div>
                  <p className="mt-3 text-right text-[9px] font-bold uppercase tracking-widest text-white/30">Last updated {new Date(share.stats.updatedAt).toLocaleDateString()}</p>
                </div>
              )}
            </section>
          ) : (
            <div className="mt-6 border border-white/10 bg-white/5 p-4 clip-angled-sm" data-testid="hype-card-recipient-stats-unavailable">
              <p className="text-[10px] font-bold uppercase tracking-[.15em] text-white/50">Season Stats</p>
              <p className="mt-2 text-sm font-medium leading-relaxed text-white/50">Stats were not attached to this Hype Card.</p>
            </div>
          )}
          <HypeCardReplyComposer shareToken={shareToken} />
          <p className="mt-6 text-[10px] font-bold uppercase tracking-[.18em] text-white/40">Available until {new Date(share.expiresAt).toLocaleDateString()}</p>
        </aside>
      </main>
    </div>
  );
}

export function HypeCardReplyComposer({
  shareToken,
  onSent,
  className = 'mt-6 border border-white/10 bg-white/5 p-4',
}: {
  shareToken: string;
  onSent?: (reply: { reaction: (typeof reactions)[number]; message: string | null }) => void;
  className?: string;
}) {
  const [reaction, setReaction] = useState<(typeof reactions)[number]>('🔥');
  const [message, setMessage] = useState('');
  const [replySent, setReplySent] = useState(false);
  const [replyError, setReplyError] = useState('');
  const createReply = useCreateHypeCardShareReply();

  const submitReply = async (event: React.FormEvent) => {
    event.preventDefault();
    setReplyError('');
    const trimmedMessage = message.trim();
    const reply = { reaction, message: trimmedMessage || null };
    try {
      await createReply.mutateAsync({
        shareToken,
        data: reply,
      });
      trackEvent('hype_card_reply_submitted', {
        reaction,
        has_message: Boolean(trimmedMessage),
      });
      onSent?.(reply);
      setMessage('');
      setReplySent(true);
    } catch (error) {
      const detail = error && typeof error === 'object' && 'data' in error
        ? (error as { data?: { error?: string } }).data?.error
        : null;
      setReplyError(detail || 'Your reply could not be sent. Please try again.');
    }
  };

  return (
    <form onSubmit={submitReply} className={className} aria-label="Reply to this Hype Card" aria-busy={createReply.isPending} data-testid="hype-card-reply-composer">
      <p className="text-[10px] font-bold uppercase tracking-[.18em] text-primary">Send some hype</p>
      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Choose a reaction">
        {reactions.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => { setReaction(item); setReplySent(false); setReplyError(''); }}
            className={`grid h-10 w-10 shrink-0 place-items-center border text-xl transition ${reaction === item ? 'border-primary bg-primary/20' : 'border-white/10 bg-black/20 hover:border-white/40'}`}
            aria-pressed={reaction === item}
            aria-label={`React ${item}`}
          >
            {item}
          </button>
        ))}
      </div>
      <label className="mt-3 block text-[10px] font-bold uppercase tracking-widest text-white/50" htmlFor="hype-reply-message">Message (optional)</label>
      <textarea
        id="hype-reply-message"
        value={message}
        onChange={(event) => { setMessage(event.target.value); setReplySent(false); setReplyError(''); }}
        maxLength={240}
        rows={3}
        placeholder="Add a short message…"
        className="mt-2 w-full resize-none border border-white/15 bg-black/30 p-3 text-sm text-white outline-none placeholder:text-white/30 focus:border-primary"
      />
      <div className="mt-2 flex items-center justify-between gap-3">
        <span className="text-[10px] font-bold text-white/35">{message.length}/240</span>
        <button type="submit" disabled={createReply.isPending || replySent} className="inline-flex min-h-10 items-center gap-2 bg-primary px-4 text-[10px] font-bold uppercase tracking-widest text-primary-foreground disabled:opacity-60">
          {replySent ? <><Check className="h-4 w-4" /> Sent</> : <><Send className="h-4 w-4" /> {createReply.isPending ? 'Sending…' : 'Send reply'}</>}
        </button>
      </div>
      {replySent && <p className="mt-3 text-xs font-bold text-primary" role="status" aria-live="polite">Reply sent. Thanks for cheering!</p>}
      {replyError && <p className="mt-2 text-xs font-bold text-red-300" role="alert">{replyError}</p>}
    </form>
  );
}

function PublicHypeCardStatsPage({ share }: { share: HypeCardShare }) {
  const stats = share.stats;
  return (
    <div className="noise min-h-dvh bg-[#0B1F3A] text-white" data-testid="public-hype-card-stats-page">
      <header className="border-b border-white/10 bg-[#11141b]">
        <div className="mx-auto flex h-[72px] max-w-[1400px] items-center justify-between px-5 sm:px-8">
          <Link href="/">
            <img src={`${basePath}/pixlsports-logo.png`} alt="Pixl Sports" className="h-11 w-auto max-w-[176px] object-contain" />
          </Link>
          <span className="text-[10px] font-bold uppercase tracking-[.2em] text-white/40">Finalized stats</span>
        </div>
      </header>
      <main className="mx-auto min-h-[calc(100dvh-72px)] w-full max-w-[900px] px-4 py-10 sm:px-8">
        {!stats ? (
          <div className="mx-auto max-w-md py-16 text-center">
            <Zap className="mx-auto h-12 w-12 text-primary" />
            <h1 className="mt-5 font-display text-4xl uppercase text-white">Stats unavailable</h1>
            <p className="mt-3 text-sm font-medium leading-relaxed text-white/60">This stats link does not have finalized athlete data attached.</p>
          </div>
        ) : (
          <>
            <p className="text-xs font-bold uppercase tracking-[.2em] text-primary">Athlete stats</p>
            <div className="mt-3 flex flex-col justify-between gap-4 border-l-4 border-primary pl-5 sm:flex-row sm:items-end">
              <div>
                <h1 className="font-display text-5xl uppercase leading-[.9] sm:text-6xl">{stats.athleteName}</h1>
                <p className="mt-3 text-xs font-bold uppercase tracking-widest text-white/45">
                  {isSport(stats.sport) ? getSportRule(stats.sport).label : stats.sport}
                </p>
              </div>
              <p className="text-xs font-bold uppercase tracking-widest text-white/40">Finalized games only</p>
            </div>
            <section className="mt-8 border border-white/10 bg-white/5 p-4 clip-angled-sm sm:p-6" aria-labelledby="stats-page-season-total">
              <div className="flex items-center justify-between gap-3">
                <h2 id="stats-page-season-total" className="text-xs font-bold uppercase tracking-widest text-primary">Season totals</h2>
                <span className="text-[10px] font-bold uppercase tracking-widest text-white/35">{stats.gamesPlayed} games</span>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                <div className="border border-white/10 bg-white/5 p-3">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-white/55">Games</p>
                  <p className="mt-1 font-display text-3xl text-white">{stats.gamesPlayed}</p>
                </div>
                <div className="border border-white/10 bg-white/5 p-3">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-white/55">Score</p>
                  <p className="mt-1 font-display text-3xl text-primary">{stats.score}</p>
                </div>
                {Object.entries(stats.stats).map(([statId, count]) => {
                  const rule = isSport(stats.sport) ? getSportRule(stats.sport) : null;
                  const definition = rule?.stats.find((stat) => stat.id === statId);
                  return (
                    <div key={statId} className="border border-white/10 bg-white/5 p-3">
                      <p className="truncate text-[10px] font-bold uppercase tracking-widest text-white/55">{definition?.shortLabel || statId.replace(/-/g, ' ')}</p>
                      <p className="mt-1 font-display text-3xl text-white">{count}</p>
                    </div>
                  );
                })}
              </div>
              <p className="mt-4 text-right text-[9px] font-bold uppercase tracking-widest text-white/30">Last updated {new Date(stats.updatedAt).toLocaleDateString()}</p>
            </section>
            <section className="mt-5 border border-white/10 bg-white/5 p-4 clip-angled-sm sm:p-6" aria-labelledby="stats-page-game-history">
              <h2 id="stats-page-game-history" className="text-xs font-bold uppercase tracking-widest text-primary">Finalized games</h2>
              {stats.games.length ? (
                <ol className="mt-4 space-y-3">
                  {stats.games.map((game, index) => (
                    <li key={`${game.date}-${game.opponent}-${index}`} className="border border-white/10 bg-black/20 p-3 sm:p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-bold uppercase tracking-widest text-white">{game.opponent || `Game ${index + 1}`}</p>
                          <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-white/45">{formatHypeCardGameDate(game.date)}</p>
                        </div>
                        <p className="font-display text-xl text-primary">{game.score}–{game.opponentScore}</p>
                      </div>
                      {Object.keys(game.stats).length > 0 && (
                        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                          {Object.entries(game.stats).map(([statId, count]) => {
                            const rule = isSport(stats.sport) ? getSportRule(stats.sport) : null;
                            const definition = rule?.stats.find((stat) => stat.id === statId);
                            return (
                              <div key={statId} className="border border-white/10 bg-white/5 p-2">
                                <p className="truncate text-[9px] font-bold uppercase tracking-widest text-white/50">{definition?.shortLabel || statId.replace(/-/g, ' ')}</p>
                                <p className="font-display text-lg text-white">{count}</p>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="mt-4 text-sm font-medium text-white/50">No finalized game summaries are available.</p>
              )}
            </section>
            <p className="mt-6 text-center text-[10px] font-bold uppercase tracking-[.16em] text-white/35">This link shows published finalized stats and does not expose live game activity.</p>
          </>
        )}
      </main>
    </div>
  );
}

function formatHypeCardGameDate(value: string) {
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime())
    ? value || 'Date unavailable'
    : parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="noise min-h-dvh bg-[#0B1F3A] text-white">
      <header className="border-b border-white/10 bg-[#11141b]"><div className="mx-auto flex h-[72px] max-w-[1400px] items-center px-5 sm:px-8"><Link href="/"><img src={`${basePath}/pixlsports-logo.png`} alt="Pixl Sports" className="h-11 w-auto" /></Link></div></header>
      <main className="grid min-h-[calc(100dvh-72px)] place-items-center px-5 py-12">{children}</main>
    </div>
  );
}
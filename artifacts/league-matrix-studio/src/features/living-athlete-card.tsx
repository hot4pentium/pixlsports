import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowRight, ArrowUpRight, CalendarDays, ChartNoAxesCombined, Images, Play, Radio, RotateCcw } from 'lucide-react';
import { Link } from 'wouter';
import { getGetAthleteFanCardQueryKey, useGetAthleteFanCard, type PublicAthleteFanCard } from '@workspace/api-client-react';

import './living-athlete-card.css';

type CardSide = 'front' | 'stats' | 'videos';
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

function formatDate(value: string) {
  if (!value) return '';
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

function nextEvent(events: PublicAthleteFanCard['scheduleEvents']) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return [...events]
    .filter((event) => event.status === 'upcoming' && event.date && new Date(`${event.date.slice(0, 10)}T23:59:59`).getTime() >= today.getTime())
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time))[0] ?? null;
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="living-card-page">
      <header className="living-card-header">
        <div className="living-card-header-inner">
          <Link href="/" className="living-card-brand" data-testid="link-living-card-home">
            <img src={`${basePath}/pixlsports-logo.png`} alt="Pixl Sports home" />
          </Link>
          <span className="living-card-header-label">A season worth keeping / Pixl Sports</span>
        </div>
      </header>
      {children}
    </div>
  );
}

export function LivingAthleteCardPage({
  params,
  followControls,
}: {
  params: { inviteToken?: string };
  followControls?: ReactNode;
}) {
  const inviteToken = params.inviteToken ?? '';
  const [side, setSide] = useState<CardSide>('front');
  const [brokenPhoto, setBrokenPhoto] = useState(false);
  const [failedVideos, setFailedVideos] = useState<string[]>([]);
  const videosRef = useRef<HTMLDivElement>(null);
  const { data: invite, isLoading, isError, refetch } = useGetAthleteFanCard(inviteToken, {
    query: {
      enabled: !!inviteToken,
      queryKey: getGetAthleteFanCardQueryKey(inviteToken),
      retry: false,
      refetchOnWindowFocus: true,
      refetchInterval: 60_000,
    },
  });

  const photoUrl = invite?.photoUrl ?? null;

  useEffect(() => { setSide('front'); }, [inviteToken]);
  useEffect(() => { setBrokenPhoto(false); }, [photoUrl]);
  useEffect(() => {
    if (!invite) return;
    const previous = document.title;
    document.title = `${invite.athleteName} · The living card | Pixl Sports`;
    return () => { document.title = previous; };
  }, [invite?.athleteName]);

  if (isLoading) {
    return (
      <Shell>
        <main aria-busy="true" aria-label="Loading athlete card" role="status">
          <div className="living-card-skeleton"><div /><aside><span /><span /><span /></aside></div>
          <span className="sr-only">Loading athlete card</span>
        </main>
      </Shell>
    );
  }
  if (isError || !invite || !inviteToken) {
    return (
      <Shell>
        <main className="living-card-state" role="alert">
          <span className="living-card-eyebrow">The card is off the field</span>
          <h1>This card isn't available right now.</h1>
          <p>The link may have changed or the athlete's page may be paused. Check with the person who shared it, or try again.</p>
          {inviteToken && <button type="button" onClick={() => void refetch()} data-testid="button-retry-living-card">Try again</button>}
        </main>
      </Shell>
    );
  }

  const recentVideos = [...invite.videos]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 3);
  const upcoming = nextEvent(invite.scheduleEvents);
  const sport = invite.sport.charAt(0).toUpperCase() + invite.sport.slice(1);
  const selectSide = (next: CardSide) => {
    if (side === next) return;
    videosRef.current?.querySelectorAll('video').forEach((video) => video.pause());
    setSide(next);
  };

  return (
    <Shell>
      <main className="living-card-main">
        <div className="living-card-intro">
          <div>
            <span className="living-card-eyebrow">The living athlete card / {invite.seasonName}</span>
            <h1>One card. <span>Every chapter.</span></h1>
          </div>
          <p className="living-card-intro-note">The same athlete, a new story after every game. Keep this link close.</p>
        </div>

        <div className="living-card-layout">
          <section className="living-card-stage" aria-label={`${invite.athleteName}'s living athlete card`}>
            <div className="living-card-frame-outer">
              <div className="living-card-frame" id="living-card-display" role="region" aria-label={`${invite.athleteName} — ${side === 'front' ? 'card front' : side === 'stats' ? 'finalized stats' : 'videos'}`}>
                {side === 'front' && (
                  <div className="living-card-face" key="front">
                    {photoUrl && !brokenPhoto ? (
                      <img className="living-card-photo" src={photoUrl} alt={`Portrait of ${invite.athleteName}`} onError={() => setBrokenPhoto(true)} data-testid="img-living-card-athlete" />
                    ) : (
                      <div className="living-card-photo-fallback" aria-label="No athlete portrait selected yet">
                        <span aria-hidden="true">{invite.athleteName.trim().split(/\s+/).slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join('') || 'P'}</span>
                        <small>Portrait coming soon</small>
                      </div>
                    )}
                    <div className="living-card-photo-shade" />
                    <div className="living-card-corner">
                      <span className="living-card-edition">Pixl / Athlete edition</span>
                      <span className="living-card-number">{invite.seasonName}<br />{sport}</span>
                    </div>
                    <div className="living-card-front-bottom">
                      <span className="living-card-overline">The season belongs to</span>
                      <h2 className="living-card-athlete-name" data-testid="text-living-card-athlete-name">{invite.athleteName}</h2>
                      <div className="living-card-front-meta">
                        <span>{invite.teamName || sport}</span>
                        <span>Always in the game / Pixl Sports</span>
                      </div>
                    </div>
                  </div>
                )}

                {side === 'stats' && (
                  <div className="living-card-face living-card-face-alt" key="stats">
                    <div className="living-card-alt-top"><span className="living-card-overline">Pixl / The record</span><span>{invite.seasonName}</span></div>
                    <h2 className="living-card-alt-title">Season stats.</h2>
                    <p className="living-card-alt-subtitle">{invite.athleteName} / {invite.teamName || sport} / Finalized games only</p>
                    {invite.liveScoreboard && (
                      <section className="living-card-scoreboard" aria-label="Game Day Live scoreboard" data-testid="fan-card-live-scoreboard">
                        <div className="living-card-scoreboard-heading"><Radio size={17} aria-hidden="true" /> Game Day Live <span>View only</span></div>
                        <div className="living-card-scoreboard-row">
                          <span>{invite.liveScoreboard.teamName || invite.athleteName}</span>
                          <strong aria-label={`${invite.liveScoreboard.score} to ${invite.liveScoreboard.opponentScore}`}>{invite.liveScoreboard.score}–{invite.liveScoreboard.opponentScore}</strong>
                          <span>{invite.liveScoreboard.opponent || 'Opponent'}</span>
                        </div>
                        <p>The owner started this temporary scoreboard. Finalized stats appear below after the game ends.</p>
                      </section>
                    )}
                    {invite.stats ? (
                      <>
                        <div className="living-card-stats-lead">
                          <div className="living-card-stat-feature"><strong data-testid="text-living-card-games">{invite.stats.gamesPlayed}</strong><span>Games played</span></div>
                          <div className="living-card-stat-feature"><strong data-testid="text-living-card-score">{invite.stats.score}</strong><span>Team score total</span></div>
                        </div>
                        {Object.entries(invite.stats.stats).length > 0 && (
                          <div className="living-card-stat-grid">
                            {Object.entries(invite.stats.stats).map(([id, value]) => (
                              <div className="living-card-stat-cell" key={id}>
                                <span>{id.replace(/[-_]/g, ' ')}</span><strong data-testid={`text-living-card-stat-${id}`}>{value}</strong>
                              </div>
                            ))}
                          </div>
                        )}
                        {invite.stats.games.length > 0 && (
                          <div className="living-card-final-games">
                            <h3>Finalized games</h3>
                            <ol>
                              {[...invite.stats.games].sort((a, b) => b.date.localeCompare(a.date)).map((game, index) => (
                                <li key={`${game.date}-${game.opponent}-${index}`}>
                                  <span>{game.opponent ? `vs ${game.opponent}` : 'Game'}<small>{formatDate(game.date)}</small>
                                    {Object.keys(game.stats).length > 0 && <small>{Object.entries(game.stats).map(([stat, value]) => `${stat.replace(/[-_]/g, ' ')} ${value}`).join(' · ')}</small>}
                                  </span>
                                  <strong aria-label={`${game.score} to ${game.opponentScore}`}>{game.score}–{game.opponentScore}</strong>
                                </li>
                              ))}
                            </ol>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="living-card-empty">
                        <ChartNoAxesCombined size={30} strokeWidth={1.5} aria-hidden="true" />
                        <h3>The record starts here.</h3>
                        <p>Finalized stats will appear when a completed game is published.</p>
                      </div>
                    )}
                  </div>
                )}

                {side === 'videos' && (
                  <div className="living-card-face living-card-face-alt" key="videos" ref={videosRef}>
                    <div className="living-card-alt-top"><span className="living-card-overline">Pixl / The moments</span><span>{invite.seasonName}</span></div>
                    <h2 className="living-card-alt-title">On repeat.</h2>
                    <p className="living-card-alt-subtitle">The latest three moments shared for {invite.athleteName}.</p>
                    {recentVideos.length > 0 ? (
                      <ol className="living-card-video-list">
                        {recentVideos.map((video, index) => (
                          <li key={video.shareToken}>
                            <div className="living-card-video-heading"><strong>{video.title || video.mediaName}</strong><span>{String(index + 1).padStart(2, '0')} / {String(recentVideos.length).padStart(2, '0')}</span></div>
                            {failedVideos.includes(video.shareToken) ? (
                              <p className="living-card-video-error" role="status">This highlight is unavailable right now.</p>
                            ) : (
                              <video
                                src={video.videoUrl}
                                poster={video.posterUrl ?? undefined}
                                controls
                                preload="none"
                                playsInline
                                aria-label={`Video: ${video.title || video.mediaName}`}
                                data-testid={`video-living-card-${index}`}
                                onError={() => setFailedVideos((tokens) => tokens.includes(video.shareToken) ? tokens : [...tokens, video.shareToken])}
                                onPlay={(event) => {
                                  videosRef.current?.querySelectorAll('video').forEach((other) => {
                                    if (other !== event.currentTarget) other.pause();
                                  });
                                }}
                              />
                            )}
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <div className="living-card-empty">
                        <Play size={30} strokeWidth={1.5} aria-hidden="true" />
                        <h3>Moments on the way.</h3>
                        <p>When new videos are shared, the latest three will live here.</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
            <div className="living-card-controls" role="group" aria-label="Choose a side of the athlete card">
              <button type="button" className="living-card-control" aria-pressed={side === 'front'} aria-controls="living-card-display" onClick={() => selectSide('front')} data-testid="button-living-card-front"><RotateCcw aria-hidden="true" /> Card front</button>
              <button type="button" className="living-card-control" aria-pressed={side === 'stats'} aria-controls="living-card-display" onClick={() => selectSide('stats')} data-testid="button-living-card-stats"><ChartNoAxesCombined aria-hidden="true" /> Stats</button>
              <button type="button" className="living-card-control" aria-pressed={side === 'videos'} aria-controls="living-card-display" onClick={() => selectSide('videos')} data-testid="button-living-card-videos"><Images aria-hidden="true" /> Videos{recentVideos.length > 0 ? ` (${recentVideos.length})` : ''}</button>
            </div>
            <p className="living-card-instruction">Choose a side to turn the card. Videos play only when you press play.</p>
          </section>

          <aside className="living-card-story">
            <div className="living-card-story-kicker">Your front-row seat</div>
            <h2>Their story.<br /><em>Your seat.</em></h2>
            <p className="living-card-story-copy">
              This is {invite.athleteName}'s place in the season. Come back for the next game, a new highlight, and the numbers that made it count.
            </p>
            <div className="living-card-story-divider" />
            <section className="living-card-next" aria-labelledby="living-card-next-title">
              <div className="living-card-next-head"><CalendarDays aria-hidden="true" /> Up next</div>
              {upcoming ? (
                <>
                  <h3 id="living-card-next-title" data-testid="text-living-card-next-event">{upcoming.type === 'game' ? (upcoming.opponent ? `vs ${upcoming.opponent}` : 'Game day') : upcoming.type === 'practice' ? 'Practice' : 'Team meeting'}</h3>
                  <p className="living-card-next-date">{formatDate(upcoming.date)}{upcoming.time ? ` / ${upcoming.time}` : ''}</p>
                  {upcoming.location && <p>{upcoming.location}</p>}
                </>
              ) : (
                <>
                  <h3 id="living-card-next-title">Stay tuned.</h3>
                  <p>The next event will appear here when it is shared.</p>
                </>
              )}
              {invite.liveScoreboard && (
                <button type="button" className="living-card-live" onClick={() => selectSide('stats')} data-testid="button-living-card-live">
                  <Radio aria-hidden="true" /> View live scoreboard <ArrowRight aria-hidden="true" />
                </button>
              )}
            </section>
            {followControls && <div className="living-card-follow">{followControls}</div>}
            <Link className="living-card-original" href={`/player/${encodeURIComponent(inviteToken)}`} data-testid="link-original-hype-page">
              Visit the original Hype Page <ArrowUpRight aria-hidden="true" />
            </Link>
          </aside>
        </div>
        <footer className="living-card-footer"><span>Pixl Sports / Every game adds a chapter</span><span>{invite.seasonName} · {sport}</span></footer>
      </main>
    </Shell>
  );
}
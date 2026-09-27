import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowRight, Bell, ChartNoAxesCombined, Images, Play, Radio, RotateCcw, Send } from 'lucide-react';
import { useUser } from '@clerk/react';
import { Link } from 'wouter';
import {
  getGetAthleteFanCardQueryKey,
  getListAthleteInvitesQueryKey,
  useGetAthleteFanCard,
  useListAthleteInvites,
  useSendAthleteInviteHype,
  type PublicAthleteFanCard,
  type AthleteInviteHypeInput,
} from '@workspace/api-client-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { HypeCardReplyComposer } from './public-hype-card';
import { captureVideoThumbnail, isBlankVideoPoster } from './video-thumbnail';
import './living-athlete-card.css';

type CardSide = 'front' | 'stats' | 'videos';
type FanGame = NonNullable<PublicAthleteFanCard['stats']>['games'][number];
type FanVideo = PublicAthleteFanCard['videos'][number];
const hypeReactions = [
  { emoji: '👏', label: 'Applause' },
  { emoji: '💪', label: 'Strong' },
  { emoji: '⭐', label: 'Star' },
  { emoji: '❤️', label: 'Heart' },
  { emoji: '🔥', label: 'Fire' },
] as const;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

function formatDate(value: string) {
  if (!value) return '';
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

function gameOutcome(game: FanGame) {
  if (!game.scoreRecorded) return null;
  return game.score > game.opponentScore ? 'W' : game.score < game.opponentScore ? 'L' : 'T';
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

function FanCardVideo({
  video,
  index,
  onError,
  onPlay,
}: {
  video: FanVideo;
  index: number;
  onError: () => void;
  onPlay: (event: React.SyntheticEvent<HTMLVideoElement>) => void;
}) {
  const [poster, setPoster] = useState(video.posterUrl ?? undefined);

  useEffect(() => {
    const controller = new AbortController();
    let fallbackUrl: string | undefined;
    const recoverBlankPoster = async () => {
      if (video.posterUrl) {
        try {
          if (!(await isBlankVideoPoster(video.posterUrl, controller.signal))) return;
        } catch {
          if (controller.signal.aborted) return;
        }
      }
      const image = await captureVideoThumbnail(video.videoUrl, controller.signal);
      if (controller.signal.aborted) return;
      fallbackUrl = URL.createObjectURL(image);
      setPoster(fallbackUrl);
    };
    void recoverBlankPoster().catch(() => undefined);
    return () => {
      controller.abort();
      if (fallbackUrl) URL.revokeObjectURL(fallbackUrl);
    };
  }, [video.posterUrl, video.videoUrl]);

  return (
    <video
      src={video.videoUrl}
      poster={poster}
      controls
      preload="none"
      playsInline
      aria-label={`Video: ${video.title || video.mediaName}`}
      data-testid={`video-living-card-${index}`}
      onError={onError}
      onPlay={onPlay}
    />
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
  const [selectedGameKey, setSelectedGameKey] = useState('');
  const [trendStatId, setTrendStatId] = useState('score');
  const [localReplies, setLocalReplies] = useState<Array<{ reaction: string; message: string | null; createdAt: string }>>([]);
  const [reaction, setReaction] = useState<AthleteInviteHypeInput['reaction']>('👏');
  const [senderName, setSenderName] = useState('');
  const [message, setMessage] = useState('');
  const [hypeFeedback, setHypeFeedback] = useState('');
  const [followDialogOpen, setFollowDialogOpen] = useState(false);
  const [hypeDialogOpen, setHypeDialogOpen] = useState(false);
  const { isSignedIn } = useUser();
  const { data: ownedInvites } = useListAthleteInvites({
    query: {
      enabled: Boolean(isSignedIn),
      queryKey: getListAthleteInvitesQueryKey(),
      retry: false,
    },
  });
  const sendHype = useSendAthleteInviteHype();
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

  useEffect(() => {
    setSide('front');
    setHypeFeedback('');
    setSenderName('');
    setMessage('');
    setSelectedGameKey('');
    setTrendStatId('score');
    setLocalReplies([]);
    setFollowDialogOpen(false);
    setHypeDialogOpen(false);
  }, [inviteToken]);
  useEffect(() => { setBrokenPhoto(false); }, [photoUrl]);
  useEffect(() => {
    if (!invite) return;
    const previous = document.title;
    document.title = `${invite.athleteName} · The living card | Pixl Sports`;
    return () => { document.title = previous; };
  }, [invite?.athleteName]);
  useEffect(() => {
    if (!invite?.stats) return;
    setTrendStatId((current) => (
      current === 'score' || Object.prototype.hasOwnProperty.call(invite.stats?.stats ?? {}, current)
        ? current
        : 'score'
    ));
  }, [invite?.stats]);

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

  const recentVideos = [...invite.videos].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const sport = invite.sport.charAt(0).toUpperCase() + invite.sport.slice(1);
  const ownerInvite = ownedInvites?.find((item) => item.inviteToken === inviteToken) ?? null;
  const orderedGames = (invite.stats?.games ?? [])
    .map((game, index) => ({ game, index }))
    .sort((a, b) => a.game.date.localeCompare(b.game.date) || a.index - b.index);
  const trendOptions = invite.stats
    ? [
        { id: 'score', label: 'Team score' },
        ...Object.keys(invite.stats.stats)
          .filter((id) => id !== 'score')
          .map((id) => ({ id, label: id.replace(/[-_]/g, ' ') })),
      ]
    : [];
  const selectedTrend = trendOptions.find((item) => item.id === trendStatId) ?? trendOptions[0] ?? null;
  const recentTrendGames = orderedGames.slice(-3);
  const trendValues = selectedTrend
    ? recentTrendGames.map(({ game }) => selectedTrend.id === 'score'
      ? game.scoreRecorded ? game.score : null
      : game.stats[selectedTrend.id] ?? 0)
    : [];
  const trendMax = Math.max(1, ...trendValues.filter((value): value is number => value !== null));
  const gameOptions = [...orderedGames].reverse().map(({ game, index }) => ({
    game,
    key: `${game.date}|${game.opponent}|${game.score}|${game.opponentScore}|${index}`,
    index,
  }));
  const selectedGameOption = gameOptions.find(({ key }) => key === selectedGameKey) ?? gameOptions[0] ?? null;
  const selectedGameTeamStats = selectedGameOption
    ? Object.entries(selectedGameOption.game.stats).sort(([left], [right]) => left.localeCompare(right))
    : [];
  const selectedGameAthleteStats = selectedGameOption
    ? Object.entries(selectedGameOption.game.athleteStats).sort(([left], [right]) => left.localeCompare(right))
    : [];
  const recentReplies = [...localReplies, ...invite.replies]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 6);
  const selectSide = (next: CardSide) => {
    if (side === next) return;
    videosRef.current?.querySelectorAll('video').forEach((video) => video.pause());
    setSide(next);
  };
  const submitHype = async (event: React.FormEvent) => {
    event.preventDefault();
    setHypeFeedback('');
    try {
      await sendHype.mutateAsync({ inviteToken, data: {
        reaction,
        ...(senderName.trim() ? { senderName: senderName.trim() } : {}),
        ...(message.trim() ? { message: message.trim() } : {}),
      } });
      setSenderName('');
      setMessage('');
      setHypeFeedback(`Your ${reaction} shoutout was sent to the card owner. Thanks for cheering ${invite.athleteName} on!`);
    } catch (error) {
      const status = error && typeof error === 'object' && 'status' in error ? Number(error.status) : 0;
      setHypeFeedback(status === 429 ? 'You have sent several shoutouts. Please try again in an hour.'
        : status === 404 ? 'This card is no longer accepting shoutouts. Refresh to check its status.'
        : 'Your shoutout could not be sent. Please try again.');
    }
  };

  return (
    <Shell>
      <main className="living-card-main">
        {ownerInvite && (
          <div className="living-card-intro">
            <Link className="living-card-manage" href={`/player/${encodeURIComponent(inviteToken)}/manage`} data-testid="link-manage-living-card">
              <span>Manage this athletic card</span><ArrowRight aria-hidden="true" />
            </Link>
          </div>
        )}

        <div className="living-card-layout living-card-layout-solo">
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
                    {photoUrl && !brokenPhoto && (
                      <span className="living-card-photo-watermark" aria-hidden="true">HYPE CARD</span>
                    )}
                    <div className="living-card-front-identity">
                      <h2 className="living-card-athlete-name" data-testid="text-living-card-athlete-name">{invite.athleteName}</h2>
                      {invite.teamName && <p className="living-card-team-name" data-testid="text-living-card-team-name">{invite.teamName}</p>}
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
                          <div className="living-card-stat-feature"><strong data-testid="text-living-card-record">{invite.stats.record.wins}–{invite.stats.record.losses}–{invite.stats.record.ties}</strong><span>W – L – T · scored games</span></div>
                          <div className="living-card-stat-feature"><strong data-testid="text-living-card-games">{invite.stats.gamesPlayed}</strong><span>Finalized games</span></div>
                          <div className="living-card-stat-feature"><strong data-testid="text-living-card-score">{invite.stats.score}</strong><span>Team points / runs</span></div>
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
                        {selectedTrend && (
                          <section className="living-card-trend" aria-labelledby="living-card-trend-title" data-testid="living-card-last-three-trend">
                            <div className="living-card-section-heading">
                              <div>
                                <h3 id="living-card-trend-title">Last three games</h3>
                                <p>Combined team trend · most recent at right</p>
                              </div>
                              <label>
                                <span className="sr-only">Choose a combined stat for the last-three-games trend</span>
                                <select
                                  value={selectedTrend.id}
                                  onChange={(event) => setTrendStatId(event.currentTarget.value)}
                                  data-testid="select-living-card-trend"
                                >
                                  {trendOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                                </select>
                              </label>
                            </div>
                            {recentTrendGames.length > 0 ? (
                              <ol className="living-card-trend-list">
                                {recentTrendGames.map(({ game, index }, trendIndex) => {
                                  const value = trendValues[trendIndex];
                                  const result = gameOutcome(game);
                                  return (
                                    <li key={`${game.date}-${game.opponent}-${index}`}>
                                      <span className="living-card-trend-opponent">
                                        <small>{game.opponent ? `vs ${game.opponent}` : `Game ${index + 1}`}</small>
                                        <small>{formatDate(game.date)}</small>
                                      </span>
                                      <span className="living-card-trend-track" aria-hidden="true">
                                        {value !== null && value !== undefined && (
                                          <span style={{ width: `${Math.max(5, (value / trendMax) * 100)}%` }} />
                                        )}
                                      </span>
                                      <strong>{value === null || value === undefined ? '—' : value}</strong>
                                      <span className={`living-card-result living-card-result-${result ?? 'pending'}`}>
                                        {result ?? 'No score'}
                                      </span>
                                    </li>
                                  );
                                })}
                              </ol>
                            ) : (
                              <p className="living-card-note">Finalized games will build this trend.</p>
                            )}
                          </section>
                        )}
                        {invite.stats.games.length > 0 && (
                          <div className="living-card-final-games">
                            <h3>Choose a finalized game</h3>
                            <div className="living-card-game-picker" role="group" aria-label="Choose a finalized game to inspect">
                              {gameOptions.map(({ game, key, index }) => {
                                const outcome = gameOutcome(game);
                                const selected = selectedGameOption?.key === key;
                                return (
                                  <button
                                    type="button"
                                    key={key}
                                    aria-pressed={selected}
                                    onClick={() => setSelectedGameKey(key)}
                                    data-testid={`button-living-card-game-${index}`}
                                  >
                                    <span>
                                      <strong>{game.opponent ? `vs ${game.opponent}` : `Game ${index + 1}`}</strong>
                                      <small>{formatDate(game.date)}</small>
                                    </span>
                                    <span className={`living-card-result living-card-result-${outcome ?? 'pending'}`}>
                                      {outcome ?? '—'}
                                    </span>
                                    <strong className="living-card-game-score">
                                      {game.scoreRecorded ? `${game.score}–${game.opponentScore}` : 'Score not saved'}
                                    </strong>
                                  </button>
                                );
                              })}
                            </div>
                            {selectedGameOption && (
                              <section className="living-card-game-detail" aria-label="Selected game stats" data-testid="living-card-selected-game">
                                <div>
                                  <h4>{selectedGameOption.game.opponent ? `vs ${selectedGameOption.game.opponent}` : 'Game recap'}</h4>
                                  <p>{formatDate(selectedGameOption.game.date)} · {selectedGameOption.game.scoreRecorded
                                    ? `${selectedGameOption.game.score}–${selectedGameOption.game.opponentScore}`
                                    : 'Final score not recorded'}</p>
                                </div>
                                <div className="living-card-game-stat-group">
                                  <h5>Combined team stats</h5>
                                  {selectedGameTeamStats.length > 0 ? (
                                    <dl>
                                      {selectedGameTeamStats.map(([id, value]) => (
                                        <div key={id}><dt>{id.replace(/[-_]/g, ' ')}</dt><dd>{value}</dd></div>
                                      ))}
                                    </dl>
                                  ) : <p>No combined stats were recorded.</p>}
                                </div>
                                <div className="living-card-game-stat-group living-card-athlete-game-stats">
                                  <h5>{invite.athleteName} · individual stats</h5>
                                  {selectedGameAthleteStats.length > 0 ? (
                                    <dl>
                                      {selectedGameAthleteStats.map(([id, value]) => (
                                        <div key={id}><dt>{id.replace(/[-_]/g, ' ')}</dt><dd>{value}</dd></div>
                                      ))}
                                    </dl>
                                  ) : <p>No stats were specifically credited to {invite.athleteName}.</p>}
                                </div>
                              </section>
                            )}
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
                    <h2 className="living-card-alt-title">Season moments.</h2>
                    <p className="living-card-alt-subtitle">Highlights and reactions stay together with {invite.athleteName}’s season.</p>
                    {recentVideos.length > 0 ? (
                      <ol className="living-card-video-list">
                        {recentVideos.map((video, index) => (
                          <li key={video.shareToken}>
                            <div className="living-card-video-heading">
                              <strong>{video.title || video.mediaName}</strong>
                              <span>{String(index + 1).padStart(2, '0')} / {String(recentVideos.length).padStart(2, '0')}</span>
                            </div>
                            {failedVideos.includes(video.shareToken) ? (
                              <p className="living-card-video-error" role="status">This highlight is unavailable right now.</p>
                            ) : (
                              <FanCardVideo
                                video={video}
                                index={index}
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
                        <p>When highlights are shared, they will appear here.</p>
                      </div>
                    )}
                    {invite.videos[0] && (
                      <section id="living-card-reply-composer" className="living-card-media-reply" aria-labelledby="living-card-media-reply-title">
                        <h3 id="living-card-media-reply-title">Reply to this moment</h3>
                        <p>Choose a reaction and add an optional message without leaving this card. Replies stay separate from Hypes sent from the card front.</p>
                        <HypeCardReplyComposer
                          shareToken={invite.videos[0].shareToken}
                          className="living-card-reply-composer"
                          onSent={(reply) => {
                            setLocalReplies((current) => [{
                              reaction: reply.reaction,
                              message: reply.message ?? null,
                              createdAt: new Date().toISOString(),
                            }, ...current]);
                          }}
                        />
                      </section>
                    )}
                    {recentReplies.length > 0 && (
                      <section className="living-card-recent-replies" aria-labelledby="living-card-recent-replies-title" data-testid="living-card-recent-replies">
                        <p className="living-card-overline">From the people cheering</p>
                        <h3 id="living-card-recent-replies-title">Recent reactions</h3>
                        <ul>
                          {recentReplies.map((reply, index) => (
                            <li key={`${reply.createdAt}-${index}`}>
                              <strong>{reply.reaction}</strong>
                              {reply.message && <p>{reply.message}</p>}
                              <small>{new Date(reply.createdAt).toLocaleDateString()}</small>
                            </li>
                          ))}
                        </ul>
                      </section>
                    )}
                  </div>
                )}
                <div className="living-card-controls" role="group" aria-label="Choose a side of the athlete card">
                  <button type="button" className="living-card-control" aria-pressed={side === 'front'} aria-controls="living-card-display" onClick={() => selectSide('front')} data-testid="button-living-card-front"><RotateCcw aria-hidden="true" /> Card front</button>
                  <button type="button" className="living-card-control" aria-pressed={side === 'stats'} aria-controls="living-card-display" onClick={() => selectSide('stats')} data-testid="button-living-card-stats"><ChartNoAxesCombined aria-hidden="true" /> Stats</button>
                  <button type="button" className="living-card-control" aria-pressed={side === 'videos'} aria-controls="living-card-display" onClick={() => selectSide('videos')} data-testid="button-living-card-videos"><Images aria-hidden="true" /> Videos{recentVideos.length > 0 ? ` (${recentVideos.length})` : ''}</button>
                </div>
              </div>
            </div>

             <div className="living-card-support-actions" role="group" aria-label="Support this athlete">
               <Dialog open={followDialogOpen} onOpenChange={setFollowDialogOpen}>
                 <DialogTrigger asChild>
                   <button type="button" className="living-card-support-action living-card-support-action-follow" data-testid="button-open-fan-card-follow">
                     <Bell aria-hidden="true" />
                     <span>Follow this card</span>
                     <small>Alerts are optional</small>
                   </button>
                 </DialogTrigger>
                 <DialogContent className="living-card-dialog" data-testid="dialog-follow-fan-card">
                   <DialogHeader className="living-card-dialog-header">
                     <span className="living-card-dialog-kicker">Keep the season close</span>
                     <DialogTitle>Follow {invite.athleteName}.</DialogTitle>
                     <DialogDescription>
                        Follow this card on the device you are using. No account is needed. Choose Game Day Live alerts only if you want them.
                     </DialogDescription>
                   </DialogHeader>
                   <div className="living-card-dialog-body">
                     {followControls}
                   </div>
                 </DialogContent>
               </Dialog>

               <Dialog open={hypeDialogOpen} onOpenChange={setHypeDialogOpen}>
                 <DialogTrigger asChild>
                   <button type="button" className="living-card-support-action living-card-support-action-hype" data-testid="button-open-fan-card-hypes">
                     <Send aria-hidden="true" />
                      <span>Send a Shoutout</span>
                     <small>A note for the owner</small>
                   </button>
                 </DialogTrigger>
                 <DialogContent className="living-card-dialog living-card-hype-dialog" data-testid="dialog-hypes-fan-card">
                   <DialogHeader className="living-card-dialog-header">
                     <span className="living-card-dialog-kicker">From the stands</span>
                      <DialogTitle>Send a Shoutout.</DialogTitle>
                     <DialogDescription>
                       Pick a cheer and add a short message for {invite.athleteName}. Only the card owner can read your message.
                     </DialogDescription>
                   </DialogHeader>
                   <div className="living-card-dialog-body">
                     {invite.hypesEnabled ? (
                       <form onSubmit={(event) => void submitHype(event)} data-testid="form-fan-card-hype">
                          <fieldset className="living-card-hype-reactions">
                            <legend>Your cheer</legend>
                            {hypeReactions.map(({ emoji, label }) => (
                              <button key={emoji} type="button" onClick={() => setReaction(emoji)} aria-label={`React with ${label}`} aria-pressed={reaction === emoji}>
                                {emoji}
                              </button>
                            ))}
                          </fieldset>
                          <label htmlFor="fan-card-sender-name">Your name (optional)</label>
                          <input id="fan-card-sender-name" type="text" value={senderName} onChange={(event) => setSenderName(event.target.value)} maxLength={60} autoComplete="name" placeholder="How should we credit you?" data-testid="input-fan-card-sender-name" />
                          <p className="living-card-name-note">Leave blank to send anonymously. Only the card owner sees your name.</p>
                         <label htmlFor="fan-card-message">Short message (optional)</label>
                         <textarea id="fan-card-message" value={message} onChange={(event) => setMessage(event.target.value)} maxLength={240} rows={4} placeholder="A few words of encouragement" data-testid="input-fan-card-message" />
                         <div className="living-card-dialog-form-footer">
                           <span>{message.length}/240</span>
                            <button type="submit" disabled={sendHype.isPending} data-testid="button-submit-fan-card-hype">{sendHype.isPending ? 'Sending shoutout…' : 'Send a Shoutout'}</button>
                         </div>
                       </form>
                     ) : (
                       <div className="living-card-dialog-disabled" data-testid="status-fan-card-hypes-disabled">
                         <Send aria-hidden="true" />
                          <h3>Shoutouts are turned off.</h3>
                         <p>The owner is not accepting messages on this card right now. You can still follow the season and view its public updates.</p>
                       </div>
                     )}
                     <p role="status" aria-live="polite" className="living-card-hype-feedback" data-testid="fan-card-hype-feedback">{hypeFeedback}</p>
                   </div>
                 </DialogContent>
               </Dialog>
             </div>
            <p className="living-card-instruction">Choose a side to turn the card. Videos play only when you press play.</p>
          </section>

        </div>
        <footer className="living-card-footer"><span>Pixl Sports / Every game adds a chapter</span><span>{invite.seasonName} · {sport}</span></footer>
      </main>
    </Shell>
  );
}
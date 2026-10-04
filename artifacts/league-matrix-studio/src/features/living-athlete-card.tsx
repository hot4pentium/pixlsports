import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ArrowRight, Bell, CalendarDays, ChartNoAxesCombined, Radio, RotateCcw, Send, Zap } from 'lucide-react';
import { useUser } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import {
  getGetAthleteFanCardQueryKey,
  getListAthleteInviteHypesQueryKey,
  getListAthleteInvitesQueryKey,
  getListPublicAthleteInviteHypesQueryKey,
  useDeleteAthleteInviteHype,
  useGetAthleteFanCard,
  useListAthleteInviteHypes,
  useListAthleteInvites,
  useListPublicAthleteInviteHypes,
  useSendAthleteInviteHype,
  useSendAthleteLiveTap,
  useUpdateAthleteInvite,
  type PublicAthleteFanCard,
  type AthleteInviteHypeInput,
} from '@workspace/api-client-react';
import { hasEventToday } from './athlete-event-links';
import { resolveHypeCardAthleteName } from './hype-card-appearance';
import { getUserProfile } from './supporter-dashboard-model';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { LivingAthleteCardFront } from './living-athlete-card-front';
import { BackNavigationLink } from '@/components/back-navigation-link';

type CardSide = 'front' | 'responses' | 'stats' | 'events' | 'live-taps';
type FanGame = NonNullable<PublicAthleteFanCard['stats']>['games'][number];
const liveTapAccessTokenPattern = /^[A-Za-z0-9_-]{40,100}$/;
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
          <BackNavigationLink href="/" label="Back to Pixl Sports" testId="link-back-public-home" variant="public" />
        </div>
      </header>
      {children}
    </div>
  );
}

function LivingCardControls({
  side,
  eventToday,
  eventCount,
  onSelectSide,
}: {
  side: CardSide;
  eventToday: boolean;
  eventCount: number;
  onSelectSide: (next: CardSide) => void;
}) {
  return (
    <div className="living-card-controls" role="group" aria-label="Choose a side of the athlete card">
      <button type="button" className="living-card-control" aria-label="Responses" aria-pressed={side === 'responses'} aria-controls="living-card-display" onClick={() => onSelectSide('responses')} data-testid="button-living-card-responses"><span className="living-card-control-emoji" aria-hidden="true">👍</span> Replies</button>
      <button type="button" className="living-card-control" aria-pressed={side === 'stats'} aria-controls="living-card-display" onClick={() => onSelectSide('stats')} data-testid="button-living-card-stats"><ChartNoAxesCombined aria-hidden="true" /> Stats</button>
      <button type="button" className="living-card-control" aria-label="Live Taps" aria-pressed={side === 'live-taps'} aria-controls="living-card-display" onClick={() => onSelectSide('live-taps')} data-testid="button-living-card-live-taps"><Zap aria-hidden="true" /> Taps</button>
      <button type="button" className={`living-card-control${eventToday ? ' living-card-control-today' : ''}`} aria-pressed={side === 'events'} aria-controls="living-card-display" onClick={() => onSelectSide('events')} data-testid="button-living-card-events"><CalendarDays aria-hidden="true" /> Events{eventCount > 0 && <span className="living-card-control-count">({eventCount})</span>}{eventToday && <span className="sr-only"> · Event today</span>}</button>
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
  const [todayTick, setTodayTick] = useState(() => Date.now());
  const [brokenPhoto, setBrokenPhoto] = useState(false);
  const [selectedGameKey, setSelectedGameKey] = useState('');
  const [trendStatId, setTrendStatId] = useState('score');
  const [localReplies, setLocalReplies] = useState<Array<{ reaction: string; message: string | null; createdAt: string }>>([]);
  const [reaction, setReaction] = useState<AthleteInviteHypeInput['reaction']>('👏');
  const [senderName, setSenderName] = useState('');
  const [message, setMessage] = useState('');
  const [publicConsent, setPublicConsent] = useState(false);
  const [hypeFeedback, setHypeFeedback] = useState('');
  const [responseFeedback, setResponseFeedback] = useState('');
  const [liveTapAccessToken, setLiveTapAccessToken] = useState<string | null>(null);
  const [liveTapFeedback, setLiveTapFeedback] = useState('');
  const [followDialogOpen, setFollowDialogOpen] = useState(false);
  const [hypeDialogOpen, setHypeDialogOpen] = useState(false);
  const [profileNameSyncError, setProfileNameSyncError] = useState(false);
  const [profileNameSyncRetry, setProfileNameSyncRetry] = useState(0);
  const profileNameSyncAttemptRef = useRef('');
  const { user, isLoaded: clerkLoaded, isSignedIn } = useUser();
  const profile = getUserProfile(user);
  const queryClient = useQueryClient();
  const ownedInvitesQuery = useListAthleteInvites({
    query: {
      enabled: Boolean(isSignedIn),
      queryKey: getListAthleteInvitesQueryKey(),
      retry: false,
    },
  });
  const ownedInvites = ownedInvitesQuery.data;
  const updateInvite = useUpdateAthleteInvite();
  const sendHype = useSendAthleteInviteHype();
  const sendLiveTap = useSendAthleteLiveTap();
  const deleteHype = useDeleteAthleteInviteHype();
  const { data: invite, isLoading, isError, refetch } = useGetAthleteFanCard(inviteToken, {
    query: {
      enabled: !!inviteToken,
      queryKey: getGetAthleteFanCardQueryKey(inviteToken),
      retry: false,
      refetchOnWindowFocus: true,
      refetchInterval: (query) => query.state.data?.liveTaps.active ? 5_000 : 10_000,
    },
  });
  const ownerInvite = ownedInvites?.find((item) => item.inviteToken === inviteToken) ?? null;
  const publicShoutouts = useListPublicAthleteInviteHypes(inviteToken, {
    query: {
      enabled: !!inviteToken && side === 'responses',
      queryKey: getListPublicAthleteInviteHypesQueryKey(inviteToken),
      refetchOnWindowFocus: true,
      refetchInterval: 30_000,
      retry: false,
    },
  });
  const ownerShoutouts = useListAthleteInviteHypes(inviteToken, {
    query: {
      enabled: !!inviteToken && side === 'responses' && Boolean(ownerInvite),
      queryKey: getListAthleteInviteHypesQueryKey(inviteToken),
      refetchOnWindowFocus: true,
      refetchInterval: 30_000,
      retry: false,
    },
  });
  const profileAthleteName = profile.athleteName.trim();
  const displayAthleteName = resolveHypeCardAthleteName(
    ownerInvite ? profileAthleteName : '',
    invite?.athleteName ?? '',
  );
  const profileNameSyncKey = ownerInvite && profileAthleteName && ownerInvite.athleteName.trim() !== profileAthleteName
    ? `${ownerInvite.inviteToken}:${profileAthleteName}`
    : '';

  const photoUrl = invite?.photoUrl ?? null;

  useEffect(() => {
    if (!ownerInvite || !profileNameSyncKey || updateInvite.isPending) return;
    if (profileNameSyncAttemptRef.current === profileNameSyncKey) return;
    profileNameSyncAttemptRef.current = profileNameSyncKey;
    setProfileNameSyncError(false);
    void updateInvite.mutateAsync({
      inviteToken: ownerInvite.inviteToken,
      data: {
        athleteName: profileAthleteName,
        teamName: ownerInvite.teamName,
        seasonName: ownerInvite.seasonName,
        seasonEndsAt: ownerInvite.seasonEndsAt,
        timezone: ownerInvite.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        sport: ownerInvite.sport,
        trackerProjectId: ownerInvite.trackerProjectId,
        scheduleProjectId: null,
        showHypeCard: ownerInvite.showHypeCard,
        showStats: ownerInvite.showStats,
        showSchedule: false,
        showEvents: ownerInvite.showEvents,
        hypesEnabled: ownerInvite.hypesEnabled,
        paused: ownerInvite.paused,
      },
    }).then(async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListAthleteInvitesQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getGetAthleteFanCardQueryKey(inviteToken) }),
      ]);
    }).catch(() => setProfileNameSyncError(true));
  }, [
    inviteToken,
    ownerInvite?.inviteToken,
    ownerInvite?.athleteName,
    ownerInvite?.teamName,
    ownerInvite?.seasonName,
    ownerInvite?.seasonEndsAt,
    ownerInvite?.timezone,
    ownerInvite?.sport,
    ownerInvite?.trackerProjectId,
    ownerInvite?.showHypeCard,
    ownerInvite?.showStats,
    ownerInvite?.showEvents,
    ownerInvite?.hypesEnabled,
    ownerInvite?.paused,
    profileAthleteName,
    profileNameSyncKey,
    profileNameSyncRetry,
    updateInvite.isPending,
    updateInvite.mutateAsync,
    queryClient,
  ]);

  useEffect(() => {
    setSide('front');
    setHypeFeedback('');
    setSenderName('');
    setMessage('');
    setPublicConsent(false);
    setResponseFeedback('');
    setSelectedGameKey('');
    setTrendStatId('score');
    setLocalReplies([]);
    setFollowDialogOpen(false);
    setHypeDialogOpen(false);
    setLiveTapFeedback('');
  }, [inviteToken]);
  useEffect(() => {
    const storageKey = `pixlSports:liveTaps:${inviteToken}`;
    try {
      const suppliedToken = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('live-taps');
      if (suppliedToken && liveTapAccessTokenPattern.test(suppliedToken)) {
        window.localStorage.setItem(storageKey, suppliedToken);
        window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}`);
        setLiveTapAccessToken(suppliedToken);
        return;
      }
      const savedToken = window.localStorage.getItem(storageKey);
      setLiveTapAccessToken(savedToken && liveTapAccessTokenPattern.test(savedToken) ? savedToken : null);
    } catch {
      setLiveTapAccessToken(null);
    }
  }, [inviteToken]);
  useEffect(() => { setBrokenPhoto(false); }, [photoUrl]);
  useEffect(() => {
    const updateToday = () => setTodayTick(Date.now());
    const timer = window.setInterval(updateToday, 30_000);
    document.addEventListener('visibilitychange', updateToday);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', updateToday); };
  }, []);
  useEffect(() => {
    if (!invite) return;
    const previous = document.title;
    document.title = `${displayAthleteName} · HYPE Card | Pixl Sports`;
    return () => { document.title = previous; };
  }, [displayAthleteName]);
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

  const linkedEvents = invite.events ?? [];
  const eventToday = hasEventToday(linkedEvents, invite.timezone, new Date(todayTick));
  const sport = invite.sport.charAt(0).toUpperCase() + invite.sport.slice(1);
  const shoutouts = ownerInvite ? ownerShoutouts.data : publicShoutouts.data;
  const shoutoutsLoading = ownerInvite ? ownerShoutouts.isPending : publicShoutouts.isPending;
  const shoutoutsError = ownerInvite ? ownerShoutouts.isError : publicShoutouts.isError;
  const showSupportActions = clerkLoaded && (
    !isSignedIn
    || (ownedInvitesQuery.isSuccess && !ownedInvitesQuery.isFetching && !ownerInvite)
  );
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
    setSide(next);
  };
  const controlsBelowCard = invite.cardAppearance?.design === 'breakout' || invite.cardAppearance?.design === 'gallery';
  const submitHype = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!publicConsent) return;
    setHypeFeedback('');
    try {
      await sendHype.mutateAsync({ inviteToken, data: {
        reaction,
        publiclyVisible: true,
        ...(senderName.trim() ? { senderName: senderName.trim() } : {}),
        ...(message.trim() ? { message: message.trim() } : {}),
      } });
      setSenderName('');
      setMessage('');
      setPublicConsent(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListPublicAthleteInviteHypesQueryKey(inviteToken) }),
        queryClient.invalidateQueries({ queryKey: getListAthleteInviteHypesQueryKey(inviteToken) }),
      ]);
      setHypeFeedback(`Your ${reaction} Shoutout is now visible on the Responses side. Thanks for cheering ${displayAthleteName} on!`);
    } catch (error) {
      const status = error && typeof error === 'object' && 'status' in error ? Number(error.status) : 0;
      setHypeFeedback(status === 429 ? 'You have sent several shoutouts. Please try again in an hour.'
        : status === 404 ? 'This card is no longer accepting shoutouts. Refresh to check its status.'
        : 'Your shoutout could not be sent. Please try again.');
    }
  };
  const submitLiveTap = async (cheerKey: string) => {
    if (!invite.liveTaps.active || (!ownerInvite && !liveTapAccessToken)) return;
    setLiveTapFeedback('');
    try {
      const updated = await sendLiveTap.mutateAsync({
        inviteToken,
        data: {
          cheerKey,
          ...(liveTapAccessToken ? { accessToken: liveTapAccessToken } : {}),
        },
      });
      queryClient.setQueryData<PublicAthleteFanCard>(
        getGetAthleteFanCardQueryKey(inviteToken),
        (current) => {
          if (!current || current.liveTaps.gameId !== updated.gameId) return current;
          return {
            ...current,
            liveTaps: {
              ...updated,
              cheers: updated.cheers.map((cheer) => ({
                ...cheer,
                count: Math.max(
                  cheer.count,
                  current.liveTaps.cheers.find((item) => item.key === cheer.key)?.count ?? 0,
                ),
              })),
            },
          };
        },
      );
      const cheer = updated.cheers.find((item) => item.key === cheerKey);
      setLiveTapFeedback(`${cheer?.label ?? 'Cheer'} counted for this game.`);
    } catch (error) {
      const status = error && typeof error === 'object' && 'status' in error ? Number(error.status) : 0;
      if (status === 403 && liveTapAccessToken) {
        try {
          window.localStorage.removeItem(`pixlSports:liveTaps:${inviteToken}`);
        } catch {
          // Keep the visible authorization error useful when storage is unavailable.
        }
        setLiveTapAccessToken(null);
      }
      setLiveTapFeedback(status === 403
        ? 'This family QR code is invalid or has been revoked. Ask the card owner for a new code.'
        : status === 404
          ? 'This HYPE Card is unavailable for Live Taps.'
          : status === 409
            ? 'Live Taps are closed because Game Day Live is not active.'
            : status === 429
              ? 'This family QR code has sent several taps. Try again in a moment.'
              : 'Your cheer could not be counted. Please try again.');
    }
  };
  const removeShoutout = async (hypeId: string) => {
    if (!ownerInvite || !window.confirm('Remove this Shoutout from the card? This cannot be undone.')) return;
    setResponseFeedback('');
    try {
      await deleteHype.mutateAsync({ inviteToken, hypeId });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListPublicAthleteInviteHypesQueryKey(inviteToken) }),
        queryClient.invalidateQueries({ queryKey: getListAthleteInviteHypesQueryKey(inviteToken) }),
      ]);
      setResponseFeedback('Shoutout removed.');
    } catch {
      setResponseFeedback('The Shoutout could not be removed. Please try again.');
    }
  };

  return (
    <Shell>
      <main className="living-card-main">
        {ownerInvite && profileNameSyncKey && updateInvite.isPending && (
          <p className="mb-4 border-l-2 border-sky-300 bg-sky-950/60 px-4 py-3 text-sm text-white" role="status" data-testid="status-profile-name-sync">
            Updating the shared HYPE Card name from your athlete profile…
          </p>
        )}
        {ownerInvite && profileNameSyncError && (
          <div className="mb-4 border-l-2 border-amber-400 bg-amber-50 px-4 py-3 text-sm text-amber-950" role="alert" data-testid="error-profile-name-sync">
            <p>The card preview uses your profile name, but the shared card could not be updated for other viewers.</p>
            <button
              type="button"
              className="mt-2 min-h-10 font-bold underline underline-offset-2"
              onClick={() => {
                profileNameSyncAttemptRef.current = '';
                setProfileNameSyncError(false);
                setProfileNameSyncRetry((attempt) => attempt + 1);
              }}
            >
              Retry name update
            </button>
          </div>
        )}
        {ownerInvite && (
          <div className="living-card-intro">
            <Link className="living-card-manage" href={`/player/${encodeURIComponent(inviteToken)}/manage`} data-testid="link-manage-living-card">
              <span>Manage this athletic card</span><ArrowRight aria-hidden="true" />
            </Link>
          </div>
        )}

        <div className="living-card-layout living-card-layout-solo">
          <section className="living-card-stage" data-design={invite.cardAppearance?.design ?? 'classic'} aria-label={`${displayAthleteName}'s HYPE Card`}>
            <div className="living-card-frame-outer">
              <div className="living-card-frame" data-side={side} data-design={invite.cardAppearance?.design ?? 'classic'} style={invite.cardAppearance?.accentColor && /^#[0-9a-f]{6}$/i.test(invite.cardAppearance.accentColor) ? ({ '--pixl-accent': invite.cardAppearance.accentColor } as CSSProperties) : undefined} id="living-card-display" role="region" aria-label={`${displayAthleteName} — ${side === 'front' ? 'card front' : side === 'responses' ? 'viewer responses' : side === 'stats' ? 'finalized stats' : side === 'events' ? 'events' : 'Live Taps tally'}`}>
                <div className="living-card-flip-inner">
                  <div className="living-card-flip-face living-card-flip-front">
                    {side === 'front' && (
                      <LivingAthleteCardFront
                        key="front"
                        athleteName={displayAthleteName}
                        teamName={invite.teamName}
                        photoUrl={photoUrl && !brokenPhoto ? photoUrl : null}
                        appearance={invite.cardAppearance}
                        sport={invite.sport}
                        cutoutUrl={invite.cutoutUrl}
                        onPhotoError={() => setBrokenPhoto(true)}
                      />
                    )}
                  </div>
                  <div className="living-card-flip-face living-card-flip-back">
                {side === 'stats' && (
                  <div className="living-card-face living-card-face-alt" key="stats">
                    <div className="living-card-alt-top"><span className="living-card-overline">Pixl / The record</span><span>{invite.seasonName}</span></div>
                    <h2 className="living-card-alt-title">Season stats.</h2>
                    <p className="living-card-alt-subtitle">{displayAthleteName} / {invite.teamName || sport} / Finalized games only</p>
                    {invite.liveScoreboard && (
                      <section className="living-card-scoreboard" aria-label="Game Day Live scoreboard" data-testid="fan-card-live-scoreboard">
                        <div className="living-card-scoreboard-heading"><Radio size={17} aria-hidden="true" /> Game Day Live <span>View only</span></div>
                        <div className="living-card-scoreboard-row">
                          <span>{invite.liveScoreboard.teamName || displayAthleteName}</span>
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
                                  <h5>{displayAthleteName} · individual stats</h5>
                                  {selectedGameAthleteStats.length > 0 ? (
                                    <dl>
                                      {selectedGameAthleteStats.map(([id, value]) => (
                                        <div key={id}><dt>{id.replace(/[-_]/g, ' ')}</dt><dd>{value}</dd></div>
                                      ))}
                                    </dl>
                                  ) : <p>No stats were specifically credited to {displayAthleteName}.</p>}
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

                {side === 'events' && (
                  <div className="living-card-face living-card-face-alt" key="events" data-testid="living-card-events-side">
                    <div className="living-card-alt-top"><span className="living-card-overline">Pixl / Game days</span><span>{invite.seasonName}</span></div>
                    <h2 className="living-card-alt-title">Events.</h2>
                    <p className="living-card-alt-subtitle">
                      {invite.showEvents
                        ? `All eligible Event Cards saved by ${displayAthleteName}’s card owner appear here.`
                        : 'The card owner has turned off event sharing.'}
                    </p>
                    {invite.showEvents && linkedEvents.length > 0 ? (
                      <ol className="living-card-events-list" aria-label="Event Cards">
                        {linkedEvents.map((event) => (
                          <li className="living-card-event" data-status={event.status} key={`${event.shareToken}-${event.eventId}`} data-testid={`card-living-event-${event.shareToken}`}>
                            <div className="living-card-event-top"><span>{event.type} / {formatDate(event.date) || 'Date to come'}</span><span>{event.status}</span></div>
                            <h3>{event.opponent ? `vs ${event.opponent}` : event.title}</h3>
                            {event.opponent && <p className="living-card-event-title">{event.title}</p>}
                            <dl>
                              <div><dt>Time</dt><dd>{event.time || 'To be announced'}</dd></div>
                              <div><dt>Location</dt><dd>{event.location || 'To be announced'}</dd></div>
                            </dl>
                          </li>
                        ))}
                      </ol>
                    ) : invite.showEvents ? (
                      <div className="living-card-empty" data-testid="living-card-events-empty">
                        <CalendarDays size={30} strokeWidth={1.5} aria-hidden="true" />
                        <h3>Game days will land here.</h3>
                        <p>There are no eligible Event Cards to show yet. Check back as the season moves.</p>
                      </div>
                    ) : null}
                  </div>
                )}
                {side === 'live-taps' && (
                  <div className="living-card-face living-card-face-alt" key="live-taps" data-testid="living-card-live-taps-side">
                    <div className="living-card-alt-top"><span className="living-card-overline">Pixl / Family cheers</span><span>{invite.seasonName}</span></div>
                    <h2 className="living-card-alt-title">Live Taps.</h2>
                    <p className="living-card-alt-subtitle">
                      {invite.liveTaps.active
                        ? `Cheer for ${displayAthleteName} during Game Day Live.`
                        : 'The tally opens when the card owner starts Game Day Live.'}
                    </p>
                    <section className="living-card-live-taps" aria-labelledby="living-card-live-taps-title">
                      <div className="living-card-live-taps-heading">
                        <div>
                          <p className="living-card-overline">Current game</p>
                          <h3 id="living-card-live-taps-title">{invite.liveTaps.active ? 'Family cheer tally' : 'Waiting for Game Day Live'}</h3>
                        </div>
                        <strong data-testid="text-live-tap-total">
                          {invite.liveTaps.cheers.reduce((total, cheer) => total + cheer.count, 0)}
                        </strong>
                      </div>
                      <ul className="living-card-live-tap-list" aria-label="Sport-specific cheers">
                        {invite.liveTaps.cheers.map((cheer) => (
                          <li key={cheer.key}>
                            <button
                              type="button"
                              onClick={() => void submitLiveTap(cheer.key)}
                              disabled={!invite.liveTaps.active || (!ownerInvite && !liveTapAccessToken) || sendLiveTap.isPending}
                              aria-label={`${cheer.label}, ${cheer.count} taps`}
                              data-testid={`button-live-tap-${cheer.key}`}
                            >
                              <span aria-hidden="true">{cheer.emoji}</span>
                              <span>{cheer.label}</span>
                              <strong data-testid={`text-live-tap-count-${cheer.key}`}>{cheer.count}</strong>
                            </button>
                          </li>
                        ))}
                      </ul>
                      {!invite.liveTaps.active ? (
                        <p className="living-card-live-tap-note" data-testid="live-taps-not-active">
                          Cheers are tallied separately from official stats and cannot be added until Game Day Live is active.
                        </p>
                      ) : !ownerInvite && !liveTapAccessToken ? (
                        <p className="living-card-live-tap-note" data-testid="live-taps-family-link-required">
                          To tap, scan the private family QR code from the card owner. The public HYPE Card link is view-only.
                        </p>
                      ) : (
                        <p className="living-card-live-tap-note">Every tap adds one cheer to this game. Cheers never change official stats.</p>
                      )}
                      <p
                        className="living-card-live-tap-feedback"
                        role={liveTapFeedback.includes('could not') || liveTapFeedback.includes('revoked') || liveTapFeedback.includes('limit') ? 'alert' : 'status'}
                        aria-live="polite"
                        data-testid="status-live-tap-feedback"
                      >
                        {liveTapFeedback}
                      </p>
                    </section>
                  </div>
                )}
                {side === 'responses' && (
                  <div className="living-card-face living-card-face-alt" key="responses" data-testid="living-card-responses-side">
                    <div className="living-card-alt-top"><span className="living-card-overline">Pixl / From the stands</span><span>{invite.seasonName}</span></div>
                    <h2 className="living-card-alt-title">Responses.</h2>
                    <p className="living-card-alt-subtitle">Cheers shared for {displayAthleteName}. Names stay private; older owner-only messages are not shown to other viewers.</p>
                    {shoutoutsLoading ? <p className="living-card-note" role="status">Loading responses…</p>
                      : shoutoutsError ? <div className="living-card-empty" role="alert"><h3>Responses are unavailable.</h3><button type="button" onClick={() => void (ownerInvite ? ownerShoutouts.refetch() : publicShoutouts.refetch())}>Try again</button></div>
                      : shoutouts && shoutouts.length > 0 ? (
                        <ol className="living-card-response-list" aria-label="Viewer responses">
                          {shoutouts.map((item) => (
                            <li key={item.id} data-testid="living-card-response">
                              <span className="living-card-response-emoji" aria-hidden="true">{item.reaction}</span>
                              <div className="living-card-response-content">
                                <small>{new Date(item.createdAt).toLocaleDateString()}{ownerInvite && 'publiclyVisible' in item && !item.publiclyVisible ? ' · Private · Owner only' : ''}</small>
                                {item.message ? <p>{item.message}</p> : <p className="living-card-response-cheer">Cheering {displayAthleteName} on!</p>}
                              </div>
                              {ownerInvite && <button type="button" className="living-card-response-remove" disabled={deleteHype.isPending} onClick={() => void removeShoutout(item.id)} aria-label={`Remove response from ${new Date(item.createdAt).toLocaleDateString()}`}>Remove</button>}
                            </li>
                          ))}
                        </ol>
                      ) : (
                        <div className="living-card-empty"><h3>Be the first to cheer.</h3><p>New public Shoutouts will appear here.</p></div>
                      )}
                    {ownerInvite && <p role={responseFeedback.includes('could not') ? 'alert' : 'status'} aria-live="polite" className="living-card-response-feedback">{responseFeedback}</p>}
                  </div>
                )}
                  </div>
                </div>
                {!controlsBelowCard && <LivingCardControls side={side} eventToday={eventToday} eventCount={linkedEvents.length} onSelectSide={selectSide} />}
              </div>
            </div>
            {controlsBelowCard && <LivingCardControls side={side} eventToday={eventToday} eventCount={linkedEvents.length} onSelectSide={selectSide} />}
            <button type="button" className="living-card-return-front" aria-pressed={side === 'front'} aria-controls="living-card-display" onClick={() => selectSide('front')} data-testid="button-living-card-front"><RotateCcw aria-hidden="true" /> Flip to card front</button>

             {showSupportActions && <div className="living-card-support-actions" role="group" aria-label="Support this athlete">
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
                     <DialogTitle>Follow {displayAthleteName}.</DialogTitle>
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
                      <small>Share a public cheer</small>
                   </button>
                 </DialogTrigger>
                 <DialogContent className="living-card-dialog living-card-hype-dialog" data-testid="dialog-hypes-fan-card">
                   <DialogHeader className="living-card-dialog-header">
                     <span className="living-card-dialog-kicker">From the stands</span>
                      <DialogTitle>Send a Shoutout.</DialogTitle>
                     <DialogDescription>
                        Pick a cheer and add a short message for {displayAthleteName}. Your emoji and message will appear publicly on this card; your name is only visible to the owner.
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
                          <p className="living-card-name-note">Leave blank to send anonymously. Your name is never shown to other viewers.</p>
                         <label htmlFor="fan-card-message">Short message (optional)</label>
                         <textarea id="fan-card-message" value={message} onChange={(event) => setMessage(event.target.value)} maxLength={240} rows={4} placeholder="A few words of encouragement" data-testid="input-fan-card-message" />
                          <label className="living-card-public-consent"><input type="checkbox" checked={publicConsent} onChange={(event) => setPublicConsent(event.target.checked)} required data-testid="checkbox-fan-card-public-consent" /><span>I understand my emoji and message will be visible to everyone viewing this card.</span></label>
                         <div className="living-card-dialog-form-footer">
                           <span>{message.length}/240</span>
                             <button type="submit" disabled={sendHype.isPending || !publicConsent} data-testid="button-submit-fan-card-hype">{sendHype.isPending ? 'Sending shoutout…' : 'Share Shoutout'}</button>
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
              </div>}
            <p className="living-card-instruction">Choose a side to turn the card.</p>
          </section>

        </div>
        <footer className="living-card-footer"><span>Pixl Sports / Every game adds a chapter</span><span>{invite.seasonName} · {sport}</span></footer>
      </main>
    </Shell>
  );
}
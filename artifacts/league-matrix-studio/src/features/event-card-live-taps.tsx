import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getListAthleteInvitesQueryKey,
  getListAthleteInviteLiveTapAccessLinksQueryKey,
  getListStatTrackerSharesQueryKey,
  getGetAthleteFanCardQueryKey,
  useCreateAthleteInviteLiveTapAccessLink,
  useCreateStatTrackerShare,
  useGetAthleteFanCard,
  useListAthleteInvites,
  useListAthleteInviteLiveTapAccessLinks,
  useListStatTrackerShares,
  useRevokeAthleteInviteLiveTapAccessLink,
  useSendAthleteLiveTap,
  useStartAthleteInviteLive,
  useUpdateStatTrackerShare,
  type PublicAthleteFanCard,
  type StatTrackerShare,
} from '@workspace/api-client-react';
import QRCode from 'qrcode';
import { Link } from 'wouter';
import { QrCode, Radio, ShieldCheck, SquareStop } from 'lucide-react';
import {
  createGameSession,
  endGame,
  getSportRule,
  readStoredActiveGame,
  sports,
  type GameSession,
  type SoccerPeriodFormat,
  type Sport,
} from './stat-tracker';
import { SoccerPeriodChoice } from './tracker-period-controls';
import { buildWorkspaceToolHref } from './workspace-context';
import { toStatTrackerShareInput } from './stat-tracker-share';
import { athleteFamilyLiveTapsUrl } from './athlete-fan-card-url';
import './event-card-live-taps.css';

type SavedLiveTapsSession = {
  version: 1;
  eventId: string;
  inviteToken: string;
  shareToken: string;
  game: GameSession;
  live: boolean;
};

function restoreLiveTapsGame(share: StatTrackerShare): GameSession | null {
  const snapshot = share.game;
  if (
    share.liveTapsOnly !== true
    || !share.sourceEventId
    || snapshot.status !== 'live'
    || snapshot.score !== 0
    || snapshot.opponentScore !== 0
    || snapshot.trackYards
    || snapshot.events.length > 0
    || Object.values(snapshot.stats).some((count) => count !== 0)
    || Object.values(snapshot.yardStats).some((count) => count !== 0)
  ) {
    return null;
  }
  const game = createGameSession(snapshot.sport, {
    date: snapshot.date,
    opponent: snapshot.opponent,
    sourceEventId: share.sourceEventId,
    ...(snapshot.sport === 'soccer' && snapshot.soccerPeriodFormat
      ? { soccerPeriodFormat: snapshot.soccerPeriodFormat }
      : {}),
  });
  return {
    ...game,
    id: snapshot.id,
    status: 'live',
    period: snapshot.period,
    score: 0,
    opponentScore: 0,
    stats: { ...snapshot.stats },
    trackYards: false,
    yardStats: { ...snapshot.yardStats },
    events: [],
    liveTapsOnly: true,
  };
}

type EventCardLiveTapsProps = {
  userId?: string | null;
  sport: Sport | null;
  athleteName: string;
  teamName: string;
  eventId: string;
  date: string;
  time: string;
  location: string;
  opponent: string;
};

function sessionStorageKey(userId: string, eventId: string) {
  return `leaguematrix-live-taps-only:${encodeURIComponent(userId)}:${encodeURIComponent(eventId)}`;
}

function readSavedSession(userId: string | null | undefined, eventId: string): SavedLiveTapsSession | null {
  if (!userId) return null;
  try {
    const raw = window.localStorage.getItem(sessionStorageKey(userId, eventId));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<SavedLiveTapsSession> | null;
    const game = value?.game;
    if (
      value?.version !== 1
      || value.eventId !== eventId
      || typeof value.inviteToken !== 'string'
      || typeof value.shareToken !== 'string'
      || typeof value.live !== 'boolean'
      || !game
      || typeof game.id !== 'string'
      || !sports.includes(game.sport)
      || game.status !== 'live'
      || game.sourceEventId !== eventId
      || game.score !== 0
      || game.opponentScore !== 0
      || game.trackYards === true
      || !Array.isArray(game.events)
      || game.events.length !== 0
      || Object.values(game.stats ?? {}).some((count) => count !== 0)
      || Object.values(game.yardStats ?? {}).some((count) => count !== 0)
    ) {
      return null;
    }
    return value as SavedLiveTapsSession;
  } catch {
    return null;
  }
}

function getApiError(error: unknown, fallback: string) {
  if (error && typeof error === 'object' && 'data' in error) {
    const detail = (error as { data?: { error?: string } }).data?.error;
    if (detail) return detail;
  }
  return fallback;
}

export function EventCardLiveTaps({
  userId,
  sport,
  athleteName,
  teamName,
  eventId,
  date,
  time,
  location,
  opponent,
}: EventCardLiveTapsProps) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<SavedLiveTapsSession | null>(() => readSavedSession(userId, eventId));
  const [selectedInviteToken, setSelectedInviteToken] = useState('');
  const [soccerPeriodFormat, setSoccerPeriodFormat] = useState<SoccerPeriodFormat | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [qrAccessId, setQrAccessId] = useState('');
  const [pendingCheerKeys, setPendingCheerKeys] = useState<Set<string>>(() => new Set());
  const [shareFromCreate, setShareFromCreate] = useState<StatTrackerShare | null>(null);
  const inviteLinksQuery = useListAthleteInvites({
    query: {
      enabled: Boolean(userId),
      queryKey: [...getListAthleteInvitesQueryKey(), userId],
      staleTime: 10_000,
    },
  });
  const availableInvites = useMemo(
    () => (inviteLinksQuery.data ?? []).filter((invite) => !invite.paused && (!sport || invite.sport === sport)),
    [inviteLinksQuery.data, sport],
  );
  useEffect(() => {
    if (session || !availableInvites.length) return;
    setSelectedInviteToken((current) => availableInvites.some((invite) => invite.inviteToken === current)
      ? current
      : (availableInvites.find((invite) => invite.sport === sport) ?? availableInvites[0]).inviteToken);
  }, [availableInvites, session, sport]);

  const selectedInvite = availableInvites.find((invite) => invite.inviteToken === selectedInviteToken) ?? null;
  const sessionInvite = session
    ? inviteLinksQuery.data?.find((invite) => invite.inviteToken === session.inviteToken) ?? null
    : null;
  const liveTapInvite = session ? sessionInvite : selectedInvite;
  const liveTapAccessLinks = useListAthleteInviteLiveTapAccessLinks(liveTapInvite?.inviteToken ?? '', {
    query: {
      enabled: Boolean(userId && liveTapInvite?.inviteToken),
      queryKey: getListAthleteInviteLiveTapAccessLinksQueryKey(liveTapInvite?.inviteToken ?? ''),
      retry: false,
    },
  });
  const liveTapSummaryQuery = useGetAthleteFanCard(liveTapInvite?.inviteToken ?? '', {
    query: {
      enabled: Boolean(session?.live && liveTapInvite?.inviteToken),
      queryKey: getGetAthleteFanCardQueryKey(liveTapInvite?.inviteToken ?? ''),
      refetchOnWindowFocus: true,
      refetchInterval: session?.live ? 5_000 : false,
      retry: false,
    },
  });
  const trackerShareQuery = useListStatTrackerShares({
    query: {
      enabled: Boolean(userId),
      queryKey: [...getListStatTrackerSharesQueryKey(), userId],
      staleTime: 0,
      refetchOnWindowFocus: true,
    },
  });
  const createTrackerShare = useCreateStatTrackerShare();
  const startAthleteLive = useStartAthleteInviteLive();
  const updateTrackerShare = useUpdateStatTrackerShare();
  const createLiveTapAccessLink = useCreateAthleteInviteLiveTapAccessLink();
  const revokeLiveTapAccessLink = useRevokeAthleteInviteLiveTapAccessLink();
  const sendLiveTap = useSendAthleteLiveTap();
  const shareFromList = session
    ? trackerShareQuery.data?.find((share) => share.shareToken === session.shareToken) ?? null
    : null;
  const currentShare = shareFromCreate?.shareToken === session?.shareToken
    ? shareFromList ?? shareFromCreate
    : shareFromList;
  const recoverableSession = useMemo(() => {
    if (session || !sport || !inviteLinksQuery.data || !trackerShareQuery.data) return null;
    for (const invite of inviteLinksQuery.data) {
      if (invite.sport !== sport || !invite.liveTrackerShareToken) continue;
      const share = trackerShareQuery.data.find((candidate) => candidate.shareToken === invite.liveTrackerShareToken);
      if (share?.sourceEventId !== eventId) continue;
      const game = restoreLiveTapsGame(share);
      if (game) return { invite, share, game };
    }
    return null;
  }, [eventId, inviteLinksQuery.data, session, sport, trackerShareQuery.data]);
  const liveTapSummary = liveTapSummaryQuery.data?.liveTaps;
  const hasCurrentLiveTapSummary = Boolean(
    session?.live
    && liveTapSummary?.active
    && liveTapSummary.gameId === session.game.id,
  );
  const trackerHref = buildWorkspaceToolHref('stats', {
    id: eventId,
    type: 'game',
    date,
    time,
    location,
    opponent,
  });

  useEffect(() => {
    if (!session || currentShare?.game.status !== 'final') return;
    try {
      if (userId) window.localStorage.removeItem(sessionStorageKey(userId, eventId));
    } catch {
      // A finalized server session is still safe if browser cleanup is unavailable.
    }
    setSession(null);
    setQrDataUrl('');
    setQrAccessId('');
    setNotice('Game Day Live ended. Family QR access remains active until you revoke it.');
  }, [currentShare?.game.status, eventId, session, userId]);

  const persistSession = (next: SavedLiveTapsSession) => {
    setSession(next);
    if (!userId) return false;
    try {
      window.localStorage.setItem(sessionStorageKey(userId, eventId), JSON.stringify(next));
      return true;
    } catch {
      return false;
    }
  };

  const startLiveTaps = async () => {
    setError('');
    setNotice('');
    if (!userId) {
      setError('Sign in to start Live Taps for this game.');
      return;
    }
    if (!session && !selectedInvite) {
      setError('Set up or resume a Player Showcase for this sport before starting Live Taps.');
      return;
    }
    if (!session && selectedInvite?.sport === 'soccer' && !soccerPeriodFormat) {
      setError('Choose halves or quarters before starting this soccer game.');
      return;
    }

    setBusy(true);
    try {
      let activeSession = session;
      if (!activeSession) {
        const activeTrackerGame = readStoredActiveGame(window.localStorage, userId);
        if (activeTrackerGame && activeTrackerGame.status !== 'final') {
          setError('A Stat Tracker game is already open. Finish that game before starting a separate Live Taps-only session.');
          return;
        }
        const invite = selectedInvite!;
        const game = {
          ...createGameSession(invite.sport, {
            date: date || new Date().toISOString().slice(0, 10),
            opponent: opponent.trim(),
            sourceEventId: eventId,
            ...(invite.sport === 'soccer' ? { soccerPeriodFormat: soccerPeriodFormat! } : {}),
          }),
          liveTapsOnly: true,
        };
        const createdShare = await createTrackerShare.mutateAsync({
          data: toStatTrackerShareInput(game, athleteName, teamName),
        });
        activeSession = {
          version: 1,
          eventId,
          inviteToken: invite.inviteToken,
          shareToken: createdShare.shareToken,
          game,
          live: false,
        };
        setShareFromCreate(createdShare);
        persistSession(activeSession);
      }

      await startAthleteLive.mutateAsync({
        inviteToken: activeSession.inviteToken,
        data: { shareToken: activeSession.shareToken },
      });
      const sessionSaved = persistSession({ ...activeSession, live: true });
      setNotice(sessionSaved
        ? 'Game Day Live is on. This mode does not record player stats; create a private family QR for cheers.'
        : 'Game Day Live is on, but this browser could not save the session. Keep this card open until you end it.');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListStatTrackerSharesQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getListAthleteInvitesQueryKey() }),
      ]);
    } catch (caught) {
      setError(getApiError(caught, 'Live Taps could not start. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  const recoverLiveTaps = () => {
    if (!recoverableSession || !userId) return;
    setError('');
    setNotice('Active Live Taps reopened. Existing family QR codes and cheers are still available.');
    persistSession({
      version: 1,
      eventId,
      inviteToken: recoverableSession.invite.inviteToken,
      shareToken: recoverableSession.share.shareToken,
      game: recoverableSession.game,
      live: true,
    });
  };

  const createFamilyQr = async () => {
    if (!session?.live || !liveTapInvite) return;
    setError('');
    setNotice('');
    setQrDataUrl('');
    setQrAccessId('');
    try {
      const created = await createLiveTapAccessLink.mutateAsync({ inviteToken: liveTapInvite.inviteToken });
      setQrAccessId(created.id);
      const qr = await QRCode.toDataURL(
        athleteFamilyLiveTapsUrl(liveTapInvite.inviteToken, created.accessToken),
        { errorCorrectionLevel: 'Q', margin: 3, width: 360, color: { dark: '#07172b', light: '#ffffff' } },
      );
      setQrDataUrl(qr);
      setNotice('Family QR ready. Show it to someone at the game so they can scan and send cheers.');
      void queryClient.invalidateQueries({
        queryKey: getListAthleteInviteLiveTapAccessLinksQueryKey(liveTapInvite.inviteToken),
      });
    } catch (caught) {
      setError(getApiError(caught, 'The family QR could not be created. Revoke any new access link before trying again.'));
      void queryClient.invalidateQueries({
        queryKey: getListAthleteInviteLiveTapAccessLinksQueryKey(liveTapInvite.inviteToken),
      });
    }
  };

  const sendOwnerCheer = async (cheerKey: string) => {
    if (!userId || !session?.live || !liveTapInvite || !hasCurrentLiveTapSummary) return;
    setError('');
    setNotice('');
    setPendingCheerKeys((current) => new Set(current).add(cheerKey));
    try {
      const updated = await sendLiveTap.mutateAsync({
        inviteToken: liveTapInvite.inviteToken,
        data: { cheerKey },
      });
      queryClient.setQueryData<PublicAthleteFanCard>(
        getGetAthleteFanCardQueryKey(liveTapInvite.inviteToken),
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
      setNotice(`${cheer?.label ?? 'Cheer'} counted for this game.`);
    } catch (caught) {
      setError(getApiError(caught, 'The cheer could not be counted. Check that Game Day Live is still active, then try again.'));
    } finally {
      setPendingCheerKeys((current) => {
        const next = new Set(current);
        next.delete(cheerKey);
        return next;
      });
    }
  };

  const revokeFamilyQr = async (accessId: string) => {
    if (!liveTapInvite) return;
    setError('');
    setNotice('');
    try {
      await revokeLiveTapAccessLink.mutateAsync({ inviteToken: liveTapInvite.inviteToken, accessId });
      if (qrAccessId === accessId) {
        setQrAccessId('');
        setQrDataUrl('');
      }
      setNotice('Family QR access revoked. It can no longer add cheers.');
      await queryClient.invalidateQueries({
        queryKey: getListAthleteInviteLiveTapAccessLinksQueryKey(liveTapInvite.inviteToken),
      });
    } catch (caught) {
      setError(getApiError(caught, 'Family QR access could not be revoked. Try again.'));
    }
  };

  const endLiveTaps = async () => {
    if (!session) return;
    setError('');
    setNotice('');
    setBusy(true);
    try {
      let share = currentShare;
      if (!share) {
        const refreshed = await trackerShareQuery.refetch();
        share = refreshed.data?.find((candidate) => candidate.shareToken === session.shareToken) ?? null;
      }
      if (!share) throw new Error('The Live Taps game could not be found. Refresh and try again.');
      await updateTrackerShare.mutateAsync({
        shareToken: session.shareToken,
        data: {
          ...toStatTrackerShareInput(endGame(session.game), athleteName, teamName),
          expectedRevision: share.revision,
        },
      });
      try {
        window.localStorage.removeItem(sessionStorageKey(userId!, eventId));
      } catch {
        // The final server status will clear a stale local session on the next open.
      }
      setSession(null);
      setShareFromCreate(null);
      setQrDataUrl('');
      setQrAccessId('');
      setNotice('Game Day Live ended. Family QR access remains active until you revoke it.');
      await queryClient.invalidateQueries({ queryKey: getListStatTrackerSharesQueryKey() });
      await queryClient.invalidateQueries({ queryKey: getListAthleteInvitesQueryKey() });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : getApiError(caught, 'Game Day Live could not be ended. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="event-card-live-taps" aria-labelledby={`event-card-live-taps-title-${eventId}`} data-testid="event-card-live-taps">
      <div className="event-card-live-taps__heading">
        <span className="event-card-live-taps__icon" aria-hidden="true"><Radio size={17} /></span>
        <div>
          <p className="event-card-live-taps__eyebrow">A simpler game-day option</p>
          <h4 id={`event-card-live-taps-title-${eventId}`}>Live Taps only</h4>
        </div>
      </div>
      <p className="event-card-live-taps__intro">
        Start a game-day cheer space without entering or saving player stats. Show the private QR to family at the game.
      </p>

      {!userId ? (
        <p className="event-card-live-taps__message">Sign in to start Live Taps and create a family QR.</p>
      ) : inviteLinksQuery.isLoading ? (
        <p className="event-card-live-taps__message" role="status">Checking your Player Showcase…</p>
      ) : inviteLinksQuery.isError ? (
        <p className="event-card-live-taps__message event-card-live-taps__message--error" role="alert">
          Your Player Showcase could not be checked. Refresh the Event Card and try again.
        </p>
      ) : !session && !availableInvites.length ? (
        <div className="event-card-live-taps__message">
          <p>Create or resume a Player Showcase before starting Game Day Live.</p>
          <Link href="/studio/player-showcase" className="event-card-live-taps__secondary">Open Player Showcase</Link>
        </div>
      ) : !session ? (
        <div className="event-card-live-taps__setup">
          {trackerShareQuery.isFetching && (
            <p className="event-card-live-taps__message" role="status">Checking for an active Live Taps game…</p>
          )}
          {trackerShareQuery.isError && (
            <div className="event-card-live-taps__message event-card-live-taps__message--error" role="alert">
              <p>Your active Live Taps games could not be checked.</p>
              <button
                type="button"
                className="event-card-live-taps__owner-retry"
                onClick={() => void trackerShareQuery.refetch()}
                data-testid="button-retry-live-taps-recovery"
              >
                Try again
              </button>
            </div>
          )}
          {recoverableSession && (
            <div className="event-card-live-taps__message" data-testid="live-taps-recovery">
              <p>
                Active Game Day Live found for {recoverableSession.invite.athleteName}
                {recoverableSession.game.opponent ? ` · vs ${recoverableSession.game.opponent}` : ''}.
                Reopen it to manage family QR access and keep the cheer tally.
              </p>
              <button
                type="button"
                className="event-card-live-taps__primary"
                onClick={recoverLiveTaps}
                disabled={trackerShareQuery.isFetching}
                data-testid="button-recover-live-taps"
              >
                Reopen active Live Taps
              </button>
            </div>
          )}
          {availableInvites.length > 1 && (
            <label className="event-card-live-taps__label">
              Player Showcase
              <select value={selectedInvite?.inviteToken ?? ''} onChange={(event) => setSelectedInviteToken(event.target.value)} data-testid="select-live-taps-player">
                {availableInvites.map((invite) => (
                  <option key={invite.inviteToken} value={invite.inviteToken}>
                    {invite.athleteName} · {getSportRule(invite.sport).label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {selectedInvite?.sport === 'soccer' && (
            <div className="event-card-live-taps__soccer-choice">
              <p>Choose the format for this soccer game.</p>
              <SoccerPeriodChoice value={soccerPeriodFormat} onChange={setSoccerPeriodFormat} />
            </div>
          )}
          <button
            type="button"
            className="event-card-live-taps__primary"
            onClick={() => void startLiveTaps()}
            disabled={busy || trackerShareQuery.isFetching || trackerShareQuery.isError || (selectedInvite?.sport === 'soccer' && !soccerPeriodFormat)}
            data-testid="button-start-live-taps-only"
          >
            <Radio size={16} aria-hidden="true" /> {busy ? 'Starting…' : 'Start Live Taps only'}
          </button>
        </div>
      ) : (
        <div className="event-card-live-taps__active">
          <div className="event-card-live-taps__live-status" role="status" data-testid="status-live-taps-only">
            <span className="event-card-live-taps__live-dot" aria-hidden="true" />
            <div>
              <strong>{session.live ? 'Game Day Live is on' : 'Ready to start Game Day Live'}</strong>
              <span>{opponent ? `vs ${opponent}` : 'This game'} · no stats are being recorded</span>
            </div>
          </div>
          {!session.live ? (
            <button
              type="button"
              className="event-card-live-taps__primary"
              onClick={() => void startLiveTaps()}
              disabled={busy}
              data-testid="button-retry-start-live-taps-only"
            >
              <Radio size={16} aria-hidden="true" /> {busy ? 'Starting…' : 'Start Game Day Live'}
            </button>
          ) : liveTapInvite?.paused ? (
            <div className="event-card-live-taps__message event-card-live-taps__message--error" role="alert">
              <p>This Player Showcase is paused, so family taps are unavailable until it is resumed.</p>
              <Link
                href="/studio/player-showcase"
                className="event-card-live-taps__secondary"
                data-testid="link-resume-live-taps-showcase"
              >
                Open Player Showcase to resume
              </Link>
            </div>
          ) : liveTapInvite ? (
            <>
              <div className="event-card-live-taps__quick-tools">
                <section className="event-card-live-taps__owner-board" aria-label="Your quick cheers">
                  <div className="event-card-live-taps__owner-board-heading">
                    <div>
                      <p className="event-card-live-taps__eyebrow">No stats recorded</p>
                      <h5>Tap a cheer</h5>
                    </div>
                    <Radio size={17} aria-hidden="true" />
                  </div>
                  <p className="event-card-live-taps__message">Your cheers and family QR taps share this game tally.</p>
                  {liveTapSummaryQuery.isLoading ? (
                    <p className="event-card-live-taps__message" role="status">Loading quick cheers…</p>
                  ) : liveTapSummaryQuery.isError ? (
                    <div className="event-card-live-taps__message event-card-live-taps__message--error" role="alert">
                      <p>The quick-cheer board could not load.</p>
                      <button
                        type="button"
                        className="event-card-live-taps__owner-retry"
                        onClick={() => void liveTapSummaryQuery.refetch()}
                      >
                        Try again
                      </button>
                    </div>
                  ) : hasCurrentLiveTapSummary && liveTapSummary ? (
                    <div className="event-card-live-taps__cheers" data-testid="owner-live-taps-controls">
                      {liveTapSummary.cheers.map((cheer) => (
                        <button
                          key={cheer.key}
                          type="button"
                          className="event-card-live-taps__cheer"
                          onClick={() => void sendOwnerCheer(cheer.key)}
                          disabled={pendingCheerKeys.has(cheer.key)}
                          aria-label={`${cheer.label}: ${cheer.count} cheers. Tap to add one.`}
                          data-testid={`button-owner-live-tap-${cheer.key}`}
                        >
                          <span className="event-card-live-taps__cheer-emoji" aria-hidden="true">{cheer.emoji}</span>
                          <span className="event-card-live-taps__cheer-label">{cheer.label}</span>
                          <span className="event-card-live-taps__cheer-count" data-testid={`text-owner-live-tap-count-${cheer.key}`}>{cheer.count}</span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="event-card-live-taps__message event-card-live-taps__message--error" role="status">
                      Live Taps are no longer active for this game. Refresh the Event Card before cheering.
                    </p>
                  )}
                </section>

                <section className="event-card-live-taps__family-access" aria-label="Family QR access">
                  <div className="event-card-live-taps__qr-actions">
                    <button
                      type="button"
                      className="event-card-live-taps__primary"
                      onClick={() => void createFamilyQr()}
                      disabled={createLiveTapAccessLink.isPending}
                      data-testid="button-create-event-card-live-tap-qr"
                    >
                      <QrCode size={16} aria-hidden="true" />
                      {createLiveTapAccessLink.isPending ? 'Creating QR…' : qrDataUrl ? 'Create another family QR' : 'Create family QR'}
                    </button>
                    <span className="event-card-live-taps__security"><ShieldCheck size={14} aria-hidden="true" /> Private, revocable access</span>
                  </div>
                  {qrDataUrl && (
                    <figure className="event-card-live-taps__qr" data-testid="event-card-live-taps-qr">
                      <img src={qrDataUrl} alt={`Private family Live Taps QR code for ${athleteName}`} data-testid="img-event-card-live-taps-qr" />
                      <figcaption>
                        Show this code to a family member at the game. They can cheer for {athleteName} until Game Day Live ends or you revoke the QR.
                      </figcaption>
                    </figure>
                  )}
                  {liveTapAccessLinks.isLoading ? (
                    <p className="event-card-live-taps__message" role="status">Checking active family QR codes…</p>
                  ) : liveTapAccessLinks.isError ? (
                    <p className="event-card-live-taps__message event-card-live-taps__message--error" role="alert">Active family QR codes could not be loaded.</p>
                  ) : liveTapAccessLinks.data?.length ? (
                    <>
                      <p className="event-card-live-taps__message" role="status" data-testid="text-event-card-live-taps-active-qr-note">
                        {liveTapAccessLinks.data.length} active family QR {liveTapAccessLinks.data.length === 1 ? 'code remains' : 'codes remain'} valid when you leave this Event Card. Creating a new QR does not deactivate older codes. Use Revoke beside any code you no longer want to work.
                      </p>
                      <ul className="event-card-live-taps__access-list" data-testid="event-card-live-taps-access-list">
                        {liveTapAccessLinks.data.map((access) => (
                          <li key={access.id}>
                            <span>Family QR · {new Date(access.createdAt).toLocaleDateString()}</span>
                            <button
                              type="button"
                              onClick={() => void revokeFamilyQr(access.id)}
                              disabled={revokeLiveTapAccessLink.isPending}
                              data-testid={`button-revoke-event-card-live-tap-qr-${access.id}`}
                            >
                              Revoke
                            </button>
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    <p className="event-card-live-taps__message">No family QR codes yet. Create one to let someone at the game send cheers.</p>
                  )}
                </section>
              </div>
            </>
          ) : (
            <div className="event-card-live-taps__message event-card-live-taps__message--error" role="alert">
              <p>The Player Showcase for this game is unavailable. Resume the matching card to enable family taps.</p>
              <Link
                href="/studio/player-showcase"
                className="event-card-live-taps__secondary"
                data-testid="link-recover-live-taps-showcase"
              >
                Open Player Showcase
              </Link>
            </div>
          )}
          <button
            type="button"
            className="event-card-live-taps__end"
            onClick={() => void endLiveTaps()}
            disabled={busy || !currentShare}
            data-testid="button-end-live-taps-only"
          >
            <SquareStop size={15} aria-hidden="true" /> {busy ? 'Ending…' : 'End Live Taps'}
          </button>
          <p className="event-card-live-taps__small">
            Ending the session closes cheers for this game. Family QR codes remain active for future Game Day Live sessions until revoked.
          </p>
        </div>
      )}

      {error && <p className="event-card-live-taps__message event-card-live-taps__message--error" role="alert" data-testid="error-event-card-live-taps">{error}</p>}
      {notice && <p className="event-card-live-taps__message" role="status" aria-live="polite" data-testid="notice-event-card-live-taps">{notice}</p>}
      <Link href={trackerHref} className="event-card-live-taps__full-tracker">Want stats too? Open Stat Tracker</Link>
    </section>
  );
}

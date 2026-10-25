import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getListAthleteInvitesQueryKey,
  getListAthleteInviteLiveTapAccessLinksQueryKey,
  getListStatTrackerSharesQueryKey,
  useCreateAthleteInviteLiveTapAccessLink,
  useCreateStatTrackerShare,
  useListAthleteInvites,
  useListAthleteInviteLiveTapAccessLinks,
  useListStatTrackerShares,
  useRevokeAthleteInviteLiveTapAccessLink,
  useStartAthleteInviteLive,
  useUpdateStatTrackerShare,
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
  const trackerShareQuery = useListStatTrackerShares({
    query: {
      enabled: Boolean(userId && session),
      queryKey: [...getListStatTrackerSharesQueryKey(), userId],
      staleTime: 0,
    },
  });
  const createTrackerShare = useCreateStatTrackerShare();
  const startAthleteLive = useStartAthleteInviteLive();
  const updateTrackerShare = useUpdateStatTrackerShare();
  const createLiveTapAccessLink = useCreateAthleteInviteLiveTapAccessLink();
  const revokeLiveTapAccessLink = useRevokeAthleteInviteLiveTapAccessLink();
  const shareFromList = session
    ? trackerShareQuery.data?.find((share) => share.shareToken === session.shareToken) ?? null
    : null;
  const currentShare = shareFromCreate?.shareToken === session?.shareToken
    ? shareFromList ?? shareFromCreate
    : shareFromList;
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
        const game = createGameSession(invite.sport, {
          date: date || new Date().toISOString().slice(0, 10),
          opponent: opponent.trim(),
          sourceEventId: eventId,
          ...(invite.sport === 'soccer' ? { soccerPeriodFormat: soccerPeriodFormat! } : {}),
        });
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
            disabled={busy || (selectedInvite?.sport === 'soccer' && !soccerPeriodFormat)}
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
            <p className="event-card-live-taps__message event-card-live-taps__message--error" role="alert">
              This Player Showcase is paused, so family taps are unavailable until it is resumed.
            </p>
          ) : liveTapInvite ? (
            <>
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
              ) : (
                <p className="event-card-live-taps__message">No family QR codes yet. Create one to let someone at the game send cheers.</p>
              )}
            </>
          ) : (
            <p className="event-card-live-taps__message event-card-live-taps__message--error" role="alert">
              The Player Showcase for this game is unavailable. Resume the matching card to enable family taps.
            </p>
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

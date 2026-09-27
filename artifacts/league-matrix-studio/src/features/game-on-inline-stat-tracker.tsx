import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'wouter';
import { CircleStop, ExternalLink, Minus, Pause, Play, Plus, RotateCcw } from 'lucide-react';
import {
  addStatEvent,
  advanceGamePeriod,
  adjustScore,
  countStatEventsByAttribution,
  createGameSession,
  endGame,
  getGamePhaseLabel,
  outcomeFromScore,
  getSportRule,
  getTrackerStorageKeys,
  getTrackerSportForProfile,
  readStoredActiveGame,
  readStoredTrackerData,
  saveStoredActiveGame,
  undoLastStatEvent,
  type GameSession,
  type GameOutcome,
  type Sport,
} from './stat-tracker';
import { buildWorkspaceToolHref } from './workspace-context';
import { GameOutcomePicker, TrackerCompletionDialog } from './tracker-completion-dialog';
import { SoccerPeriodChoice } from './tracker-period-controls';
import './game-on-inline-stat-tracker.css';

type GameOnInlineStatTrackerProps = {
  userId?: string | null;
  sport: Sport | null;
  athleteName: string;
  teamName: string;
  eventId: string;
  date: string;
  time: string;
  location: string;
  opponent: string;
  onGameEnded?: (completedAt: string) => Promise<void>;
};

function eventMatchesGame(game: GameSession, date: string, opponent: string) {
  return game.date === date
    && game.opponent.trim().toLowerCase() === opponent.trim().toLowerCase();
}

function findCompletedGame(userId: string, date: string, opponent: string) {
  const { games } = readStoredTrackerData(window.localStorage, userId);
  return [...games].reverse().find((candidate) => (
    candidate.status === 'final' && eventMatchesGame(candidate, date, opponent)
  )) ?? null;
}

function initials(name: string) {
  return name.trim().split(/\s+/).filter(Boolean).slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '').join('') || 'A';
}

export function GameOnInlineStatTracker({
  userId,
  sport,
  athleteName,
  teamName,
  eventId,
  date,
  time,
  location,
  opponent,
  onGameEnded,
}: GameOnInlineStatTrackerProps) {
  const titleId = useId();
  const endConfirmationId = useId();
  const endConfirmationHeadingId = useId();
  const currentGameRef = useRef<GameSession | null>(null);
  const endGameButtonRef = useRef<HTMLButtonElement>(null);
  const cancelEndGameButtonRef = useRef<HTMLButtonElement>(null);
  const completedStatusRef = useRef<HTMLDivElement>(null);
  const wasConfirmingEndGame = useRef(false);
  const focusCompletedStatusOnEnd = useRef(false);
  const [game, setGame] = useState<GameSession | null>(null);
  const [completedGame, setCompletedGame] = useState<GameSession | null>(null);
  const [otherActiveGame, setOtherActiveGame] = useState<GameSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [calendarStatusSyncing, setCalendarStatusSyncing] = useState(false);
  const [calendarStatusSyncError, setCalendarStatusSyncError] = useState('');
  const [endedElsewhere, setEndedElsewhere] = useState(false);
  const [confirmEndGame, setConfirmEndGame] = useState(false);
  const [includeFinalScore, setIncludeFinalScore] = useState(false);
  const [manualOutcome, setManualOutcome] = useState<GameOutcome | null>(null);
  const [completionOpen, setCompletionOpen] = useState(false);
  const trackerHref = buildWorkspaceToolHref('stats', {
    id: eventId,
    type: 'game',
    date,
    time,
    location,
    opponent,
  });

  const setCurrentGame = (next: GameSession | null) => {
    currentGameRef.current = next;
    setGame(next);
  };

  useEffect(() => {
    if (confirmEndGame) {
      cancelEndGameButtonRef.current?.focus();
    } else if (wasConfirmingEndGame.current) {
      endGameButtonRef.current?.focus();
    }
    wasConfirmingEndGame.current = confirmEndGame;
  }, [confirmEndGame]);

  useEffect(() => {
    if (completedGame && focusCompletedStatusOnEnd.current) {
      completedStatusRef.current?.focus();
      focusCompletedStatusOnEnd.current = false;
    }
  }, [completedGame]);

  useEffect(() => {
    setConfirmEndGame(false);
  }, [game?.id]);

  const createEventGame = () => {
    if (!userId) return;
    try {
      const storedData = readStoredTrackerData(window.localStorage, userId);
      const nextSport = getTrackerSportForProfile(storedData, sport);
      const next = createGameSession(nextSport, {
        date,
        opponent,
        ...(nextSport === 'soccer' ? { soccerPeriodFormat: null } : {}),
      });
      saveStoredActiveGame(window.localStorage, userId, next);
      setOtherActiveGame(null);
      setCompletedGame(null);
      setEndedElsewhere(false);
      setCurrentGame(next);
      setError('');
    } catch {
      setError('This game could not be saved on this device. Check storage access and try again.');
    }
  };

  useEffect(() => {
    setLoading(true);
    setError('');
    setOtherActiveGame(null);
    setCompletedGame(null);
    setEndedElsewhere(false);
    setCurrentGame(null);

    if (!userId) {
      setLoading(false);
      return;
    }

    try {
      const activeGame = readStoredActiveGame(window.localStorage, userId);
      if (activeGame) {
        if (eventMatchesGame(activeGame, date, opponent)) setCurrentGame(activeGame);
        else setOtherActiveGame(activeGame);
      } else {
        const completed = findCompletedGame(userId, date, opponent);
        if (completed) setCompletedGame(completed);
        else createEventGame();
      }
    } catch {
      setError('The saved Stat Tracker game could not be opened on this device.');
    } finally {
      setLoading(false);
    }
  }, [userId, date, opponent, sport, eventId]);

  useEffect(() => {
    if (!userId) return;
    const key = getTrackerStorageKeys(userId).activeGame;
    const handleStorage = (event: StorageEvent) => {
      if (event.storageArea && event.storageArea !== window.localStorage) return;
      if (event.key !== key) return;
      try {
        const activeGame = readStoredActiveGame(window.localStorage, userId);
        if (!activeGame) {
          setOtherActiveGame(null);
          setCurrentGame(null);
          const completed = findCompletedGame(userId, date, opponent);
          setCompletedGame(completed);
          setEndedElsewhere(!completed);
          return;
        }
        setEndedElsewhere(false);
        if (eventMatchesGame(activeGame, date, opponent)) {
          setOtherActiveGame(null);
          setCompletedGame(null);
          setCurrentGame(activeGame);
        } else {
          setCurrentGame(null);
          setCompletedGame(null);
          setOtherActiveGame(activeGame);
        }
      } catch {
        setError('The saved Stat Tracker game could not be refreshed.');
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [userId, date, opponent]);

  const updateGame = (change: (current: GameSession) => GameSession) => {
    const current = currentGameRef.current;
    if (!current) return;
    const next = change(current);
    setCurrentGame(next);
    if (!userId) return;
    try {
      saveStoredActiveGame(window.localStorage, userId, next);
      setError('');
    } catch {
      setError('This update could not be saved on this device. Check storage access before continuing.');
    }
  };

  const syncCompletedGameToCalendar = async (completed: GameSession) => {
    if (!onGameEnded) return;
    setCalendarStatusSyncing(true);
    setCalendarStatusSyncError('');
    try {
      await onGameEnded(completed.endedAt ?? new Date().toISOString());
    } catch (error) {
      const status = error && typeof error === 'object' && 'status' in error ? error.status : null;
      setCalendarStatusSyncError(
        status === 409
          ? 'Stats are saved on this device, but Calendar changed while this game was open. Retry to update the latest schedule.'
          : 'Stats are saved on this device, but the Calendar game could not be marked Final. Check your connection and retry the Calendar update.',
      );
    } finally {
      setCalendarStatusSyncing(false);
    }
  };

  const finishGame = () => {
    const current = currentGameRef.current;
    if (!current || !userId) return;
    try {
      const completed = endGame({ ...current, ...(manualOutcome ? { outcome: manualOutcome } : {}) }, new Date(), includeFinalScore);
      const storedData = readStoredTrackerData(window.localStorage, userId);
      const nextData = {
        ...storedData,
        games: [...storedData.games.filter((savedGame) => savedGame.id !== completed.id), completed],
      };
      window.localStorage.setItem(getTrackerStorageKeys(userId).history, JSON.stringify(nextData));
      saveStoredActiveGame(window.localStorage, userId, null);
      setCurrentGame(null);
      focusCompletedStatusOnEnd.current = false;
      setCompletedGame(completed);
      setCompletionOpen(true);
      setOtherActiveGame(null);
      setEndedElsewhere(false);
      setConfirmEndGame(false);
      setError('');
      void syncCompletedGameToCalendar(completed);
    } catch {
      setError('The game could not be ended. Your live stats are still saved on this device.');
    }
  };

  const rule = game ? getSportRule(game.sport) : null;
  const featuredStats = rule?.stats.filter((item) => item.featured && !item.liveHidden) ?? [];
  const stats = rule
    ? (featuredStats.length ? featuredStats : rule.stats.filter((item) => !item.liveHidden).slice(0, 6))
    : [];

  return (
    <section className="game-on-quick-tracker" aria-labelledby={titleId} data-testid={`game-on-inline-stat-tracker-${eventId}`}>
      <div className="game-on-quick-tracker__heading">
        <div className="game-on-quick-tracker__heading-copy">
          <p className="game-on-quick-tracker__eyebrow">Game day · Stat Tracker</p>
          <h3 id={titleId} tabIndex={-1} className="game-on-quick-tracker__title">
            {opponent ? `vs ${opponent}` : 'Live scoreboard'}
          </h3>
        </div>
        <Link href={trackerHref} className="game-on-quick-tracker__full-link" data-testid={`link-card-stats-${eventId}`}>
          Full tracker <ExternalLink size={14} aria-hidden="true" />
        </Link>
      </div>

      {loading ? (
        <p className="game-on-quick-tracker__message" role="status">Opening this game’s tracker…</p>
      ) : !userId ? (
        <div className="game-on-quick-tracker__message">
          <p>Sign in to save the scoreboard and tap stats for this game.</p>
          <Link href={trackerHref} className="game-on-quick-tracker__primary">Sign in to track stats</Link>
        </div>
      ) : otherActiveGame ? (
        <div className="game-on-quick-tracker__message" role="alert" data-testid="status-inline-tracker-conflict">
          <p>
            Another game is already open in Stat Tracker
            {otherActiveGame.opponent ? `: vs ${otherActiveGame.opponent}` : ''}. Its stats are safe; finish it before starting this game.
          </p>
          <Link href={trackerHref} className="game-on-quick-tracker__primary">Open the active tracker</Link>
        </div>
      ) : endedElsewhere && !game ? (
        <div className="game-on-quick-tracker__message" role="status">
          <p>This game was ended in another tab.</p>
          <button type="button" onClick={createEventGame} className="game-on-quick-tracker__primary">Start a new tracker</button>
        </div>
      ) : completedGame && !game ? (
        <div ref={completedStatusRef} tabIndex={-1} className="game-on-quick-tracker__message" role="status" data-testid="status-inline-tracker-completed">
          <p>This game is ended and saved on this device. Open the full tracker to review or sync it.</p>
          {calendarStatusSyncing && (
            <p className="game-on-quick-tracker__save-warning" role="status" data-testid="status-inline-calendar-sync">
              Updating this game’s Calendar status…
            </p>
          )}
          {calendarStatusSyncError && (
            <div className="game-on-quick-tracker__save-warning" role="alert" data-testid="error-inline-calendar-sync">
              <p>{calendarStatusSyncError}</p>
              <button
                type="button"
                className="game-on-quick-tracker__primary"
                disabled={calendarStatusSyncing}
                onClick={() => { if (completedGame) void syncCompletedGameToCalendar(completedGame); }}
                data-testid="button-inline-retry-calendar-sync"
              >
                Retry Calendar update
              </button>
            </div>
          )}
          <button type="button" onClick={createEventGame} className="game-on-quick-tracker__primary" data-testid="button-inline-new-tracker">Start another tracker</button>
        </div>
      ) : error && !game ? (
        <p className="game-on-quick-tracker__message game-on-quick-tracker__message--error" role="alert">{error}</p>
      ) : game && rule && game.sport === 'soccer' && game.soccerPeriodFormat === null ? (
        <div className="game-on-quick-tracker__message" data-testid="inline-soccer-period-setup">
          <p>Choose the soccer game format before recording plays.</p>
          <SoccerPeriodChoice
            value={null}
            onChange={(format) => updateGame((current) => ({ ...current, soccerPeriodFormat: format }))}
            className="mt-3"
          />
          {error && <p className="game-on-quick-tracker__save-warning" role="alert">{error}</p>}
        </div>
      ) : game && rule ? (
        <>
          <div className="game-on-quick-tracker__scoreboard" data-testid="game-on-inline-scoreboard" aria-live="polite">
            <div className="game-on-quick-tracker__scoreboard-top">
              <span className={`game-on-quick-tracker__live${game.status === 'paused' ? ' game-on-quick-tracker__live--paused' : ''}`} data-testid="game-on-inline-status">
                <span aria-hidden="true" /> {game.status === 'paused' ? 'Paused' : 'Live'}
              </span>
              <span className="game-on-quick-tracker__period" data-testid="inline-tracker-period">{getGamePhaseLabel(game)} {game.period}</span>
            </div>
            <div className="game-on-quick-tracker__score-grid">
              {([
                ['athlete', teamName || athleteName || 'Your score', game.score],
                ['opponent', opponent || 'Opponent', game.opponentScore],
              ] as const).map(([side, label, score]) => (
                <div className="game-on-quick-tracker__score-card" key={side} data-testid={`game-on-inline-score-${side}`}>
                  <span className="game-on-quick-tracker__score-label">{label}</span>
                  <strong className="game-on-quick-tracker__score-value" data-testid={`game-on-inline-score-value-${side}`}>{score}</strong>
                  <div className="game-on-quick-tracker__score-actions">
                    <button type="button" disabled={game.status !== 'live'} onClick={() => updateGame((current) => adjustScore(current, side, -1))} aria-label={`Subtract one from ${label}`} data-testid={`button-inline-score-${side}-decrease`}><Minus size={16} aria-hidden="true" /></button>
                    <button type="button" disabled={game.status !== 'live'} onClick={() => updateGame((current) => adjustScore(current, side, 1))} aria-label={`Add one to ${label}`} data-testid={`button-inline-score-${side}-increase`}><Plus size={16} aria-hidden="true" /></button>
                  </div>
                </div>
              ))}
            </div>
            <div className="game-on-quick-tracker__period-row">
              <span>Now tracking {getGamePhaseLabel(game).toLowerCase()} {game.period}</span>
              <button
                type="button"
                disabled={confirmEndGame}
                onClick={() => updateGame(advanceGamePeriod)}
                aria-label={`Advance to ${getGamePhaseLabel(game)} ${game.period + 1}`}
                data-testid="button-inline-advance-game-period"
              >
                Next {getGamePhaseLabel(game)}
              </button>
            </div>
          </div>

          <div className="game-on-quick-tracker__stats-heading">
            <div>
              <p className="game-on-quick-tracker__eyebrow">Tap a stat</p>
              <p className="game-on-quick-tracker__stats-summary">
                {Object.values(game.stats).reduce((sum, count) => sum + count, 0)} plays · {game.score} pts
              </p>
            </div>
          </div>

          <div className="game-on-quick-tracker__stat-grid">
            {stats.map((item) => {
              const counts = countStatEventsByAttribution(game, [item.id]);
              return (
                <div className="game-on-quick-tracker__stat-card" key={item.id} data-testid={`card-inline-stat-${item.id}`}>
                  <button
                    type="button"
                    disabled={game.status !== 'live'}
                    onClick={() => updateGame((current) => addStatEvent(current, item.id, new Date(), 0, 'team'))}
                    aria-label={`Record ${item.label} for ${teamName || 'team'}`}
                    data-testid={`button-tap-stat-${eventId}-${item.id}-team`}
                  >
                    <span className="game-on-quick-tracker__stat-label">{item.shortLabel}</span>
                    <strong>{game.stats[item.id] ?? 0}</strong>
                    <span className="game-on-quick-tracker__stat-counts">Team {counts.team} · Athlete {counts.athlete}</span>
                  </button>
                  <button
                    type="button"
                    disabled={game.status !== 'live'}
                    onClick={() => updateGame((current) => addStatEvent(current, item.id, new Date(), 0, 'athlete'))}
                    aria-label={`Record ${item.label} for ${athleteName || 'athlete'}`}
                    data-testid={`button-tap-stat-${eventId}-${item.id}-athlete`}
                    className="game-on-quick-tracker__athlete-tap"
                  >
                    {initials(athleteName)}
                  </button>
                </div>
              );
            })}
          </div>
          <button
            type="button"
            className="game-on-quick-tracker__undo"
            disabled={game.status !== 'live' || game.events.length === 0}
            onClick={() => updateGame(undoLastStatEvent)}
            aria-label="Undo last stat"
            data-testid="button-inline-stat-undo"
          >
            <RotateCcw size={15} aria-hidden="true" /> Undo last stat
          </button>
          {error && <p className="game-on-quick-tracker__save-warning" role="alert">{error}</p>}
          {confirmEndGame ? (
            <div
              className="game-on-quick-tracker__game-confirmation"
              id={endConfirmationId}
              role="group"
              aria-labelledby={endConfirmationHeadingId}
              data-testid="confirm-inline-end-game"
            >
              <div role="alert">
                <p id={endConfirmationHeadingId} className="game-on-quick-tracker__confirmation-title">End this game?</p>
                <p className="game-on-quick-tracker__confirmation-copy">This saves the current stats as a completed game on this device.</p>
              </div>
              <label className="mt-3 flex items-start gap-2 text-sm">
                <input type="checkbox" checked={includeFinalScore} onChange={(event) => setIncludeFinalScore(event.currentTarget.checked)} data-testid="checkbox-inline-record-final-score" className="mt-1" />
                Include this score in the record (turn on for a real 0–0 game)
              </label>
              <GameOutcomePicker
                value={manualOutcome ?? (includeFinalScore ? outcomeFromScore(game.score, game.opponentScore) : null)}
                onChange={setManualOutcome}
              />
              <div className="game-on-quick-tracker__game-confirmation-actions">
                <button
                  type="button"
                  ref={cancelEndGameButtonRef}
                  onClick={() => setConfirmEndGame(false)}
                  data-testid="button-inline-cancel-end-game"
                >
                  {game.status === 'paused' ? 'Keep game paused' : 'Keep tracking'}
                </button>
                <button type="button" className="game-on-quick-tracker__confirm-end" onClick={finishGame} data-testid="button-inline-confirm-end-game">
                  <CircleStop size={15} aria-hidden="true" /> End &amp; save game
                </button>
              </div>
            </div>
          ) : (
            <div className="game-on-quick-tracker__game-actions" data-testid="inline-tracker-game-actions">
              <button
                type="button"
                className="game-on-quick-tracker__game-action"
                onClick={() => updateGame((current) => ({ ...current, status: current.status === 'paused' ? 'live' : 'paused' }))}
                aria-label={game.status === 'paused' ? 'Resume live tracking' : 'Pause this game'}
                data-testid="button-inline-toggle-game-pause"
              >
                {game.status === 'paused' ? <Play size={15} aria-hidden="true" /> : <Pause size={15} aria-hidden="true" />}
                {game.status === 'paused' ? 'Resume game' : 'Pause game'}
              </button>
              <button
                type="button"
                ref={endGameButtonRef}
                className="game-on-quick-tracker__game-action game-on-quick-tracker__game-action--end"
                 onClick={() => { setIncludeFinalScore(game.scoreRecorded === true || game.score > 0 || game.opponentScore > 0); setManualOutcome(null); setConfirmEndGame(true); }}
                aria-controls={endConfirmationId}
                data-testid="button-inline-end-game"
              >
                <CircleStop size={15} aria-hidden="true" /> End game
              </button>
            </div>
          )}
          <p className="game-on-quick-tracker__save-note" role="status">Stats save on this device and are ready when you open the full tracker.</p>
        </>
      ) : (
        <p className="game-on-quick-tracker__message game-on-quick-tracker__message--error" role="alert">The Stat Tracker could not start for this game.</p>
      )}
      <TrackerCompletionDialog
        game={completedGame}
        open={completionOpen}
        onOpenChange={(open) => { setCompletionOpen(open); if (!open) window.setTimeout(() => completedStatusRef.current?.focus(), 0); }}
        teamName={teamName}
        viewHref={trackerHref}
      />
    </section>
  );
}
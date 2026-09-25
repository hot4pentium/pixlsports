import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'wouter';
import { ExternalLink, Minus, Plus, RotateCcw } from 'lucide-react';
import {
  addStatEvent,
  adjustScore,
  countStatEventsByAttribution,
  createGameSession,
  getSportRule,
  getTrackerStorageKeys,
  getTrackerSportForProfile,
  readStoredActiveGame,
  readStoredTrackerData,
  saveStoredActiveGame,
  undoLastStatEvent,
  type GameSession,
  type Sport,
} from './stat-tracker';
import { buildWorkspaceToolHref } from './workspace-context';
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
};

function eventMatchesGame(game: GameSession, date: string, opponent: string) {
  return game.date === date
    && game.opponent.trim().toLowerCase() === opponent.trim().toLowerCase();
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
}: GameOnInlineStatTrackerProps) {
  const titleId = useId();
  const currentGameRef = useRef<GameSession | null>(null);
  const [game, setGame] = useState<GameSession | null>(null);
  const [otherActiveGame, setOtherActiveGame] = useState<GameSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [endedElsewhere, setEndedElsewhere] = useState(false);
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

  const createEventGame = () => {
    if (!userId) return;
    try {
      const storedData = readStoredTrackerData(window.localStorage, userId);
      const next = createGameSession(getTrackerSportForProfile(storedData, sport), { date, opponent });
      saveStoredActiveGame(window.localStorage, userId, next);
      setOtherActiveGame(null);
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
        createEventGame();
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
          setEndedElsewhere(true);
          return;
        }
        setEndedElsewhere(false);
        if (eventMatchesGame(activeGame, date, opponent)) {
          setOtherActiveGame(null);
          setCurrentGame(activeGame);
        } else {
          setCurrentGame(null);
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
      ) : error && !game ? (
        <p className="game-on-quick-tracker__message game-on-quick-tracker__message--error" role="alert">{error}</p>
      ) : game && rule ? (
        <>
          <div className="game-on-quick-tracker__scoreboard" data-testid="game-on-inline-scoreboard" aria-live="polite">
            <div className="game-on-quick-tracker__scoreboard-top">
              <span className={`game-on-quick-tracker__live${game.status === 'paused' ? ' game-on-quick-tracker__live--paused' : ''}`}>
                <span aria-hidden="true" /> {game.status === 'paused' ? 'Paused' : 'Live'}
              </span>
              <span className="game-on-quick-tracker__period">{rule.phaseLabel} {game.period}</span>
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
          </div>

          {game.status === 'paused' && (
            <button type="button" className="game-on-quick-tracker__resume" onClick={() => updateGame((current) => ({ ...current, status: 'live' }))}>
              Resume live tracking
            </button>
          )}

          <div className="game-on-quick-tracker__stats-heading">
            <div>
              <p className="game-on-quick-tracker__eyebrow">Tap a stat</p>
              <p className="game-on-quick-tracker__stats-summary">
                {Object.values(game.stats).reduce((sum, count) => sum + count, 0)} plays · {game.score} pts
              </p>
            </div>
            <button type="button" disabled={game.status !== 'live' || game.events.length === 0} onClick={() => updateGame(undoLastStatEvent)} aria-label="Undo last stat" data-testid="button-inline-stat-undo">
              <RotateCcw size={15} aria-hidden="true" /> Undo
            </button>
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
          {error && <p className="game-on-quick-tracker__save-warning" role="alert">{error}</p>}
          <p className="game-on-quick-tracker__save-note" role="status">Stats save on this device and are ready when you open the full tracker.</p>
        </>
      ) : (
        <p className="game-on-quick-tracker__message game-on-quick-tracker__message--error" role="alert">The Stat Tracker could not start for this game.</p>
      )}
    </section>
  );
}
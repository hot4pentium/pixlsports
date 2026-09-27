import { lazy, Suspense, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowLeft, ArrowUpRight, Pencil, X } from 'lucide-react';
import {
  buildGameReport,
  countStatEventsByAttribution,
  getGameOutcome,
  getSportRule,
  sports,
  type FinalGameCorrectionInput,
  type GameSession,
  type Sport,
} from './stat-tracker';
import { useSeasonStatsReviewScroll } from './season-stats-review-scroll';
import './season-stats-view.css';

const ReportCharts = lazy(() => import('./stat-tracker-report-charts'));

type Props = {
  games: GameSession[];
  athleteName: string;
  teamName: string;
  selectedGameId: string | null;
  onSelectGame: (id: string | null) => void;
  onSaveCorrection: (gameId: string, input: FinalGameCorrectionInput) => Promise<void>;
  saving: boolean;
  saveMessage: string;
  saveError: string;
};

type Draft = {
  gameId: string;
  scoreRecorded: boolean;
  outcome: 'win' | 'loss' | 'tie' | null;
  score: string;
  opponentScore: string;
  stats: Record<string, string>;
  athleteStats: Record<string, string>;
};

function calendarYear(game: GameSession): string {
  const year = game.date?.slice(0, 4);
  return year && /^\d{4}$/.test(year) ? year : 'Undated';
}

function dateParts(value: string) {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return { day: '—', month: 'DATE', full: value || 'Date not set' };
  return {
    day: String(date.getDate()).padStart(2, '0'),
    month: date.toLocaleDateString(undefined, { month: 'short' }).toUpperCase(),
    full: date.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }),
  };
}

function recordedScore(game: GameSession) {
  return game.scoreRecorded === true || (game.scoreRecorded === undefined && (game.score > 0 || game.opponentScore > 0));
}

function result(game: GameSession) {
  return getGameOutcome(game);
}

function nonnegativeInteger(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function SeasonStatsView({
  games, athleteName, teamName, selectedGameId, onSelectGame, onSaveCorrection, saving, saveMessage, saveError,
}: Props) {
  const finals = useMemo(() => games.filter((game) => game.status === 'final'), [games]);
  const availableSports = useMemo(() => sports.filter((sport) => finals.some((game) => game.sport === sport)), [finals]);
  const [sportChoice, setSportChoice] = useState<Sport | null>(null);
  const [yearChoice, setYearChoice] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [formError, setFormError] = useState('');

  const selectedSport = sportChoice && availableSports.includes(sportChoice) ? sportChoice : availableSports[0] ?? null;
  const availableYears = useMemo(() => [...new Set(finals.filter((game) => game.sport === selectedSport).map(calendarYear))]
    .sort((a, b) => b.localeCompare(a)), [finals, selectedSport]);
  const selectedYear = yearChoice && availableYears.includes(yearChoice) ? yearChoice : availableYears[0] ?? null;
  const scopedGames = useMemo(() => finals
    .filter((game) => game.sport === selectedSport && calendarYear(game) === selectedYear)
    .sort((a, b) => b.date.localeCompare(a.date) || b.startedAt.localeCompare(a.startedAt)), [finals, selectedSport, selectedYear]);
  const linkedGame = selectedGameId ? finals.find((game) => game.id === selectedGameId) : null;
  const selectedGame = linkedGame ?? scopedGames[0] ?? null;
  const { detailRef, showReview } = useSeasonStatsReviewScroll(selectedGameId, selectedGame?.id ?? null);
  const selectGameForReview = (id: string) => {
    setDraft(null);
    if (id === selectedGameId && selectedGame?.id === id) showReview();
    else onSelectGame(id);
  };
  const outsideFilter = !!selectedGame && !scopedGames.some((game) => game.id === selectedGame.id);
  const detailScope = useMemo(() => selectedGame
    ? finals.filter((game) => game.sport === selectedGame.sport && calendarYear(game) === calendarYear(selectedGame))
    : [], [finals, selectedGame]);
  const report = useMemo(() => selectedGame
    ? buildGameReport(detailScope, selectedGame.sport, selectedGame.id)
    : null, [detailScope, selectedGame]);
  const rule = selectedSport ? getSportRule(selectedSport) : null;
  const detailRule = selectedGame ? getSportRule(selectedGame.sport) : null;
  const summary = useMemo(() => rule?.stats.map((stat) => ({
    ...stat,
    total: scopedGames.reduce((sum, game) => sum + (game.stats[stat.id] ?? 0), 0),
    athlete: scopedGames.reduce((sum, game) => sum + countStatEventsByAttribution(game, stat.id).athlete, 0),
    legacy: scopedGames.reduce((sum, game) => {
      const attributed = countStatEventsByAttribution(game, stat.id);
      return sum + Math.max(0, (game.stats[stat.id] ?? 0) - attributed.athlete - attributed.team);
    }, 0),
  })) ?? [], [rule, scopedGames]);
  const totalEvents = summary.reduce((sum, stat) => sum + stat.total, 0);
  const athleteEvents = summary.reduce((sum, stat) => sum + stat.athlete, 0);
  const unassignedEvents = summary.reduce((sum, stat) => sum + stat.legacy, 0);
  const record = scopedGames.reduce((counts, game) => {
    const outcome = result(game);
    if (outcome) counts[outcome] += 1;
    return counts;
  }, { win: 0, loss: 0, tie: 0 });
  const trendStats = useMemo(() => detailRule && report ? detailRule.stats
    .map((stat) => ({ ...stat, total: report.games.reduce((sum, game) => sum + (game.stats[stat.id] ?? 0), 0) }))
    .filter((stat) => stat.total > 0).sort((a, b) => b.total - a.total).slice(0, 3) : [], [detailRule, report]);

  const startEditing = (game: GameSession) => {
    const gameRule = getSportRule(game.sport);
    setDraft({
      gameId: game.id,
      scoreRecorded: recordedScore(game),
      outcome: getGameOutcome(game),
      score: String(game.score),
      opponentScore: String(game.opponentScore),
      stats: Object.fromEntries(gameRule.stats.map((stat) => [stat.id, String(game.stats[stat.id] ?? 0)])),
      athleteStats: Object.fromEntries(gameRule.stats.map((stat) => [stat.id, String(countStatEventsByAttribution(game, stat.id).athlete)])),
    });
    setFormError('');
  };

  const saveCorrection = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft || !selectedGame || !detailRule || draft.gameId !== selectedGame.id || saving) return;
    const score = nonnegativeInteger(draft.score);
    const opponentScore = nonnegativeInteger(draft.opponentScore);
    if (draft.scoreRecorded && (score === null || opponentScore === null)) {
      setFormError('Enter a non-negative whole number for each score.');
      return;
    }
    const stats: Record<string, number> = {};
    const athleteStats: Record<string, number> = {};
    for (const stat of detailRule.stats) {
      const total = nonnegativeInteger(draft.stats[stat.id] ?? '');
      const athlete = nonnegativeInteger(draft.athleteStats[stat.id] ?? '');
      if (total === null || athlete === null || athlete > total) {
        setFormError(`Check ${stat.label}: both counts must be whole numbers, and athlete credit cannot exceed the total.`);
        return;
      }
      stats[stat.id] = total;
      athleteStats[stat.id] = athlete;
    }
    setFormError('');
    const finalScore = draft.scoreRecorded ? score! : 0;
    const finalOpponentScore = draft.scoreRecorded ? opponentScore! : 0;
    try {
      await onSaveCorrection(selectedGame.id, {
        score: finalScore,
        opponentScore: finalOpponentScore,
        scoreRecorded: draft.scoreRecorded,
        outcome: draft.scoreRecorded ? (finalScore > finalOpponentScore ? 'win' : finalScore < finalOpponentScore ? 'loss' : 'tie') : draft.outcome,
        stats,
        athleteStats,
      });
      setDraft(null);
    } catch {
      setFormError('Could not save the correction. Your changes are still here; please try again.');
    }
  };

  return (
    <main className="season-stats" data-testid="season-stats-view">
      <div className="season-stats__wrap">
        <header className="season-stats__masthead">
          <div>
            <p className="season-stats__eyebrow">Pixl Sports Studio / Season review</p>
            <h1 className="season-stats__title">The season<br />in numbers.</h1>
            <p className="season-stats__intro" data-testid="text-season-athlete">A clear view of {athleteName || 'your athlete'}’s finalized games.</p>
          </div>
          <div className="season-stats__team">Following<strong data-testid="text-season-team">{teamName || 'Team not set'}</strong></div>
        </header>

        <div className="season-stats__toolbar" aria-label="Season filters">
          <label className="season-stats__filter"><span>Sport</span>
            <select value={selectedSport ?? ''} onChange={(event) => { setSportChoice(event.target.value as Sport); setYearChoice(null); setDraft(null); onSelectGame(null); }} disabled={!availableSports.length} data-testid="select-season-sport">
              {!availableSports.length && <option value="">No sports yet</option>}
              {availableSports.map((sport) => <option key={sport} value={sport}>{getSportRule(sport).label}</option>)}
            </select>
          </label>
          <label className="season-stats__filter"><span>Calendar year</span>
            <select value={selectedYear ?? ''} onChange={(event) => { setYearChoice(event.target.value); setDraft(null); onSelectGame(null); }} disabled={!availableYears.length} data-testid="select-season-year">
              {!availableYears.length && <option value="">No years yet</option>}
              {availableYears.map((year) => <option key={year} value={year}>{year}</option>)}
            </select>
          </label>
          <span className="season-stats__scope">Finalized games only · Calendar year, January–December</span>
        </div>

        <section className="season-stats__hero" aria-label="Season overview">
          <div className="season-stats__hero-lead">
            <p className="season-stats__eyebrow">The record / {selectedYear ?? '—'}</p>
            <strong data-testid="text-season-record">{record.win}W – {record.loss}L{record.tie ? ` – ${record.tie}T` : ''}</strong>
            <small>Recorded final results, with or without a score</small>
          </div>
          <div className="season-stats__metric"><span>Games final</span><strong className="season-stats__number" data-testid="text-season-games">{scopedGames.length}</strong><small>in this calendar year</small></div>
          <div className="season-stats__metric"><span>Tracked stats</span><strong className="season-stats__number" data-testid="text-season-tracked-total">{totalEvents}</strong><small>combined team + athlete counts</small></div>
          <div className="season-stats__metric"><span>Athlete credited</span><strong className="season-stats__number" data-testid="text-season-athlete-total">{athleteEvents}</strong><small>of those tracked counts</small></div>
        </section>

        <section className="season-stats__section" aria-labelledby="season-stat-heading">
          <div className="season-stats__section-head">
            <h2 className="season-stats__heading" id="season-stat-heading">Across the games</h2>
            <p className="season-stats__section-note">Combined tracked totals, with athlete credit shown separately</p>
          </div>
          {rule && scopedGames.length ? (
            <div className="season-stats__stats">
              {summary.map((stat) => <div className="season-stats__stat" key={stat.id} data-testid={`card-season-stat-${stat.id}`}>
                <div className="season-stats__stat-name">{stat.label}</div>
                <div className="season-stats__stat-main"><strong data-testid={`text-season-total-${stat.id}`}>{stat.total}</strong><span>tracked total</span></div>
                <div className="season-stats__stat-credit" data-testid={`text-season-athlete-${stat.id}`}>{stat.athlete} credited to {athleteName || 'athlete'}</div>
              </div>)}
            </div>
          ) : <div className="season-stats__empty" data-testid="empty-season-stats">No finalized games in this view. Choose another sport or year to review.</div>}
          {!!scopedGames.length && <p className="season-stats__caveat" data-testid="text-season-attribution-note">
            Athlete credit only includes counts explicitly attributed to the athlete. Team counts are not athlete credit.
            {unassignedEvents > 0 ? ` ${unassignedEvents} tracked ${unassignedEvents === 1 ? 'count has' : 'counts have'} no event-level attribution (including older records); these remain in the combined totals, not in athlete credit.` : ' Counts without athlete attribution are not assigned to the athlete.'}
          </p>}
        </section>

        <section className="season-stats__section" aria-labelledby="season-games-heading">
          <div className="season-stats__section-head">
            <h2 className="season-stats__heading" id="season-games-heading">The game log</h2>
            <p className="season-stats__section-note">Select a final to read the full picture</p>
          </div>
          <div className="season-stats__layout">
            <div className="season-stats__log" data-testid="list-season-games">
              {scopedGames.length ? scopedGames.map((game) => {
                const date = dateParts(game.date);
                return <button className={`season-stats__game${selectedGame?.id === game.id ? ' is-selected' : ''}`} type="button" key={game.id}
                  onClick={() => selectGameForReview(game.id)} aria-pressed={selectedGame?.id === game.id} data-testid={`button-season-game-${game.id}`}>
                  <span className="season-stats__game-date">{date.day}<small>{date.month}</small></span>
                  <span className="season-stats__game-info"><strong>vs {game.opponent || 'Opponent not set'}</strong><small>{getSportRule(game.sport).label} · {result(game)?.toUpperCase() ?? 'SCORE NOT RECORDED'}</small></span>
                  <span className="season-stats__game-score">{recordedScore(game) ? `${game.score}–${game.opponentScore}` : '—'}</span>
                  <ArrowUpRight size={15} aria-hidden="true" />
                </button>;
              }) : <p className="season-stats__empty">No finalized games in this filter.</p>}
            </div>
            {selectedGame && detailRule && report ? (
              <article ref={detailRef} tabIndex={-1} className="season-stats__article" data-testid={`article-season-game-${selectedGame.id}`}>
                <div className="season-stats__article-top">
                  {outsideFilter && <div className="season-stats__caveat" data-testid="status-game-outside-filter">This linked game is outside the selected {selectedYear} {rule?.label ?? 'sport'} view. Its detail is shown here without changing the overview filters.</div>}
                  <div className="season-stats__article-heading">
                    <div><p className="season-stats__eyebrow">{detailRule.label} / {dateParts(selectedGame.date).full}</p><h3 className="season-stats__opponent">vs {selectedGame.opponent || 'Opponent not set'}</h3></div>
                    <span className="season-stats__result" data-testid="text-game-result">{result(selectedGame)?.toUpperCase() ?? 'FINAL'}</span>
                  </div>
                  <div className="season-stats__score" data-testid="text-game-score">{recordedScore(selectedGame) ? <>{selectedGame.score} <span aria-hidden="true">–</span> {selectedGame.opponentScore}</> : 'Score not recorded'} <small>{recordedScore(selectedGame) ? `${teamName || 'Team'} – Opponent` : ''}</small></div>
                </div>
                <div className="season-stats__article-body">
                  <div className="season-stats__section-head"><h4 className="season-stats__heading">Tracked box score</h4><span className="season-stats__section-note">This game · athlete credit is part of total</span></div>
                  <div className="season-stats__box">
                    {detailRule.stats.map((stat) => {
                      const total = selectedGame.stats[stat.id] ?? 0;
                      const attribution = countStatEventsByAttribution(selectedGame, stat.id);
                      const unassigned = Math.max(0, total - attribution.athlete - attribution.team);
                      return <div className="season-stats__box-item" key={stat.id} data-testid={`card-game-stat-${stat.id}`}>
                        <span>{stat.label}</span><strong>{total}</strong><small>{attribution.athlete} athlete credited{unassigned ? ` · ${unassigned} unassigned` : ''}</small>
                      </div>;
                    })}
                  </div>
                  <div className="season-stats__comparison">
                    <h4 className="season-stats__heading">In context</h4>
                    <p className="season-stats__section-note">Tracked totals compared with this calendar year’s earlier games.</p>
                    {detailRule.stats.filter((stat) => (selectedGame.stats[stat.id] ?? 0) > 0 || report.games.some((game) => (game.stats[stat.id] ?? 0) > 0)).slice(0, 5).map((stat) => {
                      const priorGames = report.games.slice(0, report.selectedIndex);
                      const priorAverage = priorGames.length ? priorGames.reduce((sum, game) => sum + (game.stats[stat.id] ?? 0), 0) / priorGames.length : null;
                      return <div className="season-stats__comparison-row" key={stat.id} data-testid={`row-game-comparison-${stat.id}`}>
                        <span>{stat.label}</span><strong>{selectedGame.stats[stat.id] ?? 0} this game</strong>
                        <span>{report.previousGame ? `${report.previousGame.stats[stat.id] ?? 0} previous · ` : ''}{priorAverage === null ? 'First game of year' : `${priorAverage.toFixed(1)} prior avg`}</span>
                      </div>;
                    })}
                    {report.selectedIndex === 0 && <p className="season-stats__section-note">This is the first finalized game in this sport and calendar year.</p>}
                  </div>
                  {selectedGame.notes && <p className="season-stats__caveat" data-testid="text-game-notes"><strong>Game notes</strong><br />{selectedGame.notes}</p>}
                  <div className="season-stats__actions">
                    <button type="button" className="season-stats__action" onClick={() => startEditing(selectedGame)} disabled={saving} data-testid="button-edit-final-stats"><Pencil size={14} aria-hidden="true" /> Edit final stats</button>
                    {selectedGameId && <button type="button" className="season-stats__action season-stats__action--quiet" onClick={() => { setDraft(null); onSelectGame(null); }} data-testid="button-back-season-overview"><ArrowLeft size={14} aria-hidden="true" /> Back to overview</button>}
                  </div>
                  {saveMessage && <p role="status" className="season-stats__message" data-testid="status-correction-success">{saveMessage}</p>}
                  {saveError && <p role="alert" className="season-stats__message season-stats__message--error" data-testid="status-correction-error">{saveError}</p>}
                  {draft?.gameId === selectedGame.id && <form className="season-stats__edit" onSubmit={saveCorrection} data-testid="form-final-stats">
                    <div className="season-stats__section-head"><h4 className="season-stats__heading">Correct the final</h4><button type="button" className="season-stats__action season-stats__action--quiet" onClick={() => { setDraft(null); setFormError(''); }} disabled={saving} data-testid="button-cancel-correction"><X size={14} aria-hidden="true" /> Cancel</button></div>
                    <p className="season-stats__edit-intro">Adjust the tracked total and how much of it belongs to {athleteName || 'the athlete'}. Athlete credit cannot exceed the total. Changes to older records may rebuild attribution from these counts.</p>
                    <label className="season-stats__check"><input type="checkbox" checked={draft.scoreRecorded} onChange={(event) => setDraft({ ...draft, scoreRecorded: event.target.checked })} data-testid="checkbox-score-recorded" /> Final score recorded</label>
                    {draft.scoreRecorded && <div className="season-stats__score-fields">
                      <label className="season-stats__field"><span>{teamName || 'Team'} score</span><input type="number" min="0" step="1" required value={draft.score} onChange={(event) => setDraft({ ...draft, score: event.target.value })} data-testid="input-team-score" /></label>
                      <label className="season-stats__field"><span>Opponent score</span><input type="number" min="0" step="1" required value={draft.opponentScore} onChange={(event) => setDraft({ ...draft, opponentScore: event.target.value })} data-testid="input-opponent-score" /></label>
                    </div>}
                    {!draft.scoreRecorded && <label className="season-stats__field"><span>Result without a score</span><select value={draft.outcome ?? ''} onChange={(event) => setDraft({ ...draft, outcome: event.target.value === '' ? null : event.target.value as 'win' | 'loss' | 'tie' })} data-testid="select-scoreless-result"><option value="">Not recorded</option><option value="win">Win</option><option value="loss">Loss</option><option value="tie">Tie</option></select></label>}
                    {detailRule.stats.map((stat) => <div className="season-stats__edit-row" key={stat.id}>
                      <strong>{stat.label}</strong>
                      <label className="season-stats__field"><span>Total tracked</span><input type="number" min="0" step="1" required value={draft.stats[stat.id] ?? ''} onChange={(event) => setDraft({ ...draft, stats: { ...draft.stats, [stat.id]: event.target.value } })} data-testid={`input-total-${stat.id}`} /></label>
                      <label className="season-stats__field"><span>Athlete credited</span><input type="number" min="0" step="1" required value={draft.athleteStats[stat.id] ?? ''} onChange={(event) => setDraft({ ...draft, athleteStats: { ...draft.athleteStats, [stat.id]: event.target.value } })} data-testid={`input-athlete-${stat.id}`} /></label>
                    </div>)}
                    {formError && <p className="season-stats__message season-stats__message--error" role="alert" data-testid="status-correction-validation">{formError}</p>}
                    <div className="season-stats__actions"><button type="submit" className="season-stats__action" disabled={saving} data-testid="button-save-correction">{saving ? 'Saving correction…' : 'Save corrected final'}</button></div>
                  </form>}
                  {report.games.length > 1 && <div className="season-stats__charts">
                    <Suspense fallback={<div className="season-stats__empty" role="status" data-testid="status-charts-loading">Loading season trends…</div>}>
                      <ReportCharts report={report} rule={detailRule} trendStats={trendStats} onSelectGame={selectGameForReview} />
                    </Suspense>
                  </div>}
                </div>
              </article>
            ) : <div className="season-stats__empty" data-testid="empty-season-detail">Select a finalized game to read its report.</div>}
          </div>
        </section>
      </div>
    </main>
  );
}
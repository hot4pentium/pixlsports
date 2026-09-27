import React, { useId } from 'react';
import { outcomeFromScore, type GameOutcome } from './stat-tracker';
import { GameOutcomePicker } from './tracker-completion-dialog';

const resultLabels: Record<GameOutcome, string> = { win: 'Win', loss: 'Loss', tie: 'Tie' };

export function TrackerEndGameChoices({
  score,
  opponentScore,
  includeFinalScore,
  onIncludeFinalScoreChange,
  manualOutcome,
  onManualOutcomeChange,
  disabled = false,
}: {
  score: number;
  opponentScore: number;
  includeFinalScore: boolean;
  onIncludeFinalScoreChange: (value: boolean) => void;
  manualOutcome: GameOutcome | null;
  onManualOutcomeChange: (value: GameOutcome | null) => void;
  disabled?: boolean;
}) {
  const choiceName = useId();
  const explanationId = useId();
  const scoreOutcome = outcomeFromScore(score, opponentScore);
  const selectedOutcome = manualOutcome ?? (includeFinalScore ? scoreOutcome : null);
  const resultDoesNotMatchScore = includeFinalScore && manualOutcome !== null && manualOutcome !== scoreOutcome;

  return (
    <>
      <fieldset className="mt-4 border border-border bg-background p-4" aria-describedby={explanationId} data-testid="tracker-final-score-choice">
        <legend className="px-1 text-sm font-bold">Is the scoreboard showing the final score?</legend>
        <p id={explanationId} className="mt-1 text-xs leading-relaxed text-muted-foreground">
          This only decides whether to save the score. Choose the game result separately below.
        </p>
        <div className="mt-3 grid gap-2">
          <label className="flex min-h-11 cursor-pointer items-center gap-3 border border-border px-3 py-3 text-sm font-medium text-foreground has-[:checked]:border-primary has-[:checked]:bg-primary/10">
            <input
              type="radio"
              name={choiceName}
              checked={!includeFinalScore}
              onChange={() => onIncludeFinalScoreChange(false)}
              disabled={disabled}
              data-testid="radio-final-score-no"
              className="h-4 w-4 shrink-0 accent-primary"
            />
            No — I didn't enter a final score
          </label>
          <label className="flex min-h-11 cursor-pointer items-center gap-3 border border-border px-3 py-3 text-sm font-medium text-foreground has-[:checked]:border-primary has-[:checked]:bg-primary/10">
            <input
              type="radio"
              name={choiceName}
              checked={includeFinalScore}
              onChange={() => onIncludeFinalScoreChange(true)}
              disabled={disabled}
              data-testid="radio-final-score-yes"
              className="h-4 w-4 shrink-0 accent-primary"
            />
            Yes — save {score}–{opponentScore} as the final score
          </label>
        </div>
      </fieldset>
      <GameOutcomePicker
        value={selectedOutcome}
        onChange={onManualOutcomeChange}
        disabled={disabled}
        clearLabel={includeFinalScore ? 'Clear selection / use score instead' : 'Clear selection'}
      />
      <p className="mt-4 border-l-2 border-primary bg-primary/5 px-3 py-2 text-sm font-medium text-foreground" role="status" aria-live="polite" data-testid="tracker-end-summary">
        Saving: {selectedOutcome ? `${resultLabels[selectedOutcome]} result` : 'no result selected'} · {includeFinalScore ? `final score ${score}–${opponentScore}` : 'no final score recorded'}.
      </p>
      {resultDoesNotMatchScore && (
        <p className="mt-2 border-l-2 border-amber-500 bg-amber-500/10 px-3 py-2 text-sm text-foreground" role="alert" data-testid="tracker-score-result-warning">
          The scoreboard says {resultLabels[scoreOutcome]}, but you selected {resultLabels[manualOutcome]}. Both will be saved as shown. If you didn't enter the final score, choose No above.
        </p>
      )}
    </>
  );
}
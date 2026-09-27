import React from 'react';
import type { SoccerPeriodFormat } from './stat-tracker';

export function SoccerPeriodChoice({
  value,
  onChange,
  className = '',
}: {
  value: SoccerPeriodFormat | null | undefined;
  onChange: (format: SoccerPeriodFormat) => void;
  className?: string;
}) {
  return (
    <fieldset className={`border border-border bg-background p-4 ${className}`} data-testid="soccer-period-choice">
      <legend className="px-1 text-xs font-bold uppercase tracking-widest text-foreground">Does this soccer game use halves or quarters?</legend>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {(['halves', 'quarters'] as const).map((format) => (
          <button
            key={format}
            type="button"
            aria-pressed={value === format}
            onClick={() => onChange(format)}
            data-testid={`button-soccer-period-${format}`}
            className="min-h-11 border border-border px-3 py-2 text-xs font-bold uppercase tracking-widest text-foreground hover:border-primary aria-pressed:border-primary aria-pressed:bg-primary/15 aria-pressed:text-primary-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          >
            {format === 'halves' ? 'Halves' : 'Quarters'}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
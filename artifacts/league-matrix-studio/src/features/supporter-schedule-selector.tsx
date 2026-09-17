import React, { type ChangeEvent } from 'react';

import type { SupporterScheduleOption } from './supporter-dashboard';

export interface SupporterScheduleSelectorProps {
  schedules: SupporterScheduleOption[];
  selectedScheduleId: string | null;
  connected: boolean;
  onSelect: (scheduleId: string) => void;
  compact?: boolean;
  onOpen?: (scheduleId: string) => void;
  onRename?: (scheduleId: string, name: string) => void | Promise<void>;
  onRemove?: (scheduleId: string) => void | Promise<void>;
  actionPending?: boolean;
  actionError?: string;
}

export function SupporterScheduleSelector({
  schedules,
  selectedScheduleId,
  connected,
  onSelect,
  compact = false,
}: SupporterScheduleSelectorProps) {
  if (schedules.length === 0) return null;

  const handleChange = (event: ChangeEvent<HTMLSelectElement>) => {
    onSelect(event.target.value);
  };

  return (
    <div className={compact ? 'mb-4 flex flex-col items-stretch gap-1.5 border border-border bg-card px-3 py-2 sm:flex-row sm:items-center sm:gap-3 clip-angled-sm' : 'mb-4 border border-border bg-muted/30 p-4 clip-angled-sm'} data-testid="saved-custom-schedules">
      <label htmlFor="supporter-schedule-selection" className={compact ? 'shrink-0 text-[9px] font-bold uppercase tracking-[0.16em] text-muted-foreground' : 'block text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground'}>
        Saved custom schedules
      </label>
      <select
        id="supporter-schedule-selection"
        value={selectedScheduleId ?? schedules[0].id}
        onChange={handleChange}
        className={compact ? 'h-8 min-w-0 flex-1 border border-border bg-background px-2 text-xs font-bold text-foreground outline-none transition-colors focus:border-primary' : 'mt-2 w-full border border-border bg-background px-3 py-2.5 text-sm font-bold text-foreground outline-none transition-colors focus:border-primary'}
        data-testid="select-saved-custom-schedule"
      >
        {schedules.map((schedule) => (
          <option key={schedule.id} value={schedule.id}>
            {schedule.label} · {schedule.eventCount} {schedule.eventCount === 1 ? 'event' : 'events'}
          </option>
        ))}
      </select>
      {!compact && (
        <p className="mt-2 text-xs text-muted-foreground">
          {connected
            ? 'Your connected team calendar is currently shown first.'
            : 'Choose which saved schedule to show on your dashboard.'}
        </p>
      )}

    </div>
  );
}
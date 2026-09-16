import React, { type ChangeEvent, type FormEvent, useState } from 'react';

import type { SupporterScheduleOption } from './supporter-dashboard';

export interface SupporterScheduleSelectorProps {
  schedules: SupporterScheduleOption[];
  selectedScheduleId: string | null;
  connected: boolean;
  onSelect: (scheduleId: string) => void;
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
  onOpen,
  onRename,
  onRemove,
  actionPending = false,
  actionError,
}: SupporterScheduleSelectorProps) {
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  if (schedules.length === 0) return null;

  const handleChange = (event: ChangeEvent<HTMLSelectElement>) => {
    onSelect(event.target.value);
  };

  const startRename = (schedule: SupporterScheduleOption) => {
    setEditingScheduleId(schedule.id);
    setEditingName(schedule.name?.trim() || schedule.label);
  };

  const cancelRename = () => {
    setEditingScheduleId(null);
    setEditingName('');
  };

  const submitRename = async (event: FormEvent<HTMLFormElement>, scheduleId: string) => {
    event.preventDefault();
    const name = editingName.trim();
    if (!name || !onRename) return;

    try {
      await onRename(scheduleId, name);
      cancelRename();
    } catch {
      // The parent surfaces the mutation error and keeps the form open.
    }
  };

  const removeSchedule = async (scheduleId: string) => {
    if (!onRemove || !window.confirm('Remove this saved schedule?')) return;
    try {
      await onRemove(scheduleId);
    } catch {
      // The parent surfaces the mutation error and leaves the row in place.
    }
  };

  return (
    <div className="mb-4 border border-border bg-muted/30 p-4 clip-angled-sm" data-testid="saved-custom-schedules">
      <label htmlFor="supporter-schedule-selection" className="block text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
        Saved custom schedules
      </label>
      <select
        id="supporter-schedule-selection"
        value={selectedScheduleId ?? schedules[0].id}
        onChange={handleChange}
        className="mt-2 w-full border border-border bg-background px-3 py-2.5 text-sm font-bold text-foreground outline-none transition-colors focus:border-primary"
        data-testid="select-saved-custom-schedule"
      >
        {schedules.map((schedule) => (
          <option key={schedule.id} value={schedule.id}>
            {schedule.label} · {schedule.eventCount} {schedule.eventCount === 1 ? 'event' : 'events'}
          </option>
        ))}
      </select>
      <p className="mt-2 text-xs text-muted-foreground">
        {connected
          ? 'Your connected team calendar is currently shown first.'
          : 'Choose which saved schedule to show on your dashboard.'}
      </p>

      {(onOpen || onRename || onRemove) && (
        <div className="mt-5 border-t border-border pt-4" data-testid="manage-saved-schedules">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Manage schedules</p>
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{schedules.length} saved</span>
          </div>
          <div className="space-y-2">
            {schedules.map((schedule) => {
              const isSelected = schedule.id === (selectedScheduleId ?? schedules[0].id);
              const isEditing = editingScheduleId === schedule.id;
              const displayName = schedule.name?.trim() || schedule.label;

              return (
                <div
                  key={schedule.id}
                  className={`border p-3 transition-colors ${isSelected ? 'border-primary/50 bg-primary/5' : 'border-border bg-background'}`}
                  data-testid={`saved-schedule-row-${schedule.id}`}
                >
                  {isEditing ? (
                    <form onSubmit={(event) => void submitRename(event, schedule.id)} className="space-y-2">
                      <label htmlFor={`rename-saved-schedule-${schedule.id}`} className="sr-only">Schedule name</label>
                      <input
                        id={`rename-saved-schedule-${schedule.id}`}
                        value={editingName}
                        onChange={(event) => setEditingName(event.target.value)}
                        autoFocus
                        className="w-full border border-border bg-background px-3 py-2 text-sm font-bold text-foreground outline-none focus:border-primary"
                        data-testid={`input-rename-saved-schedule-${schedule.id}`}
                      />
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="submit"
                          disabled={!editingName.trim() || actionPending}
                          className="bg-primary px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-wait disabled:opacity-60"
                          data-testid={`button-save-schedule-name-${schedule.id}`}
                        >
                          Save name
                        </button>
                        <button
                          type="button"
                          onClick={cancelRename}
                          disabled={actionPending}
                          className="border border-border px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"
                          data-testid={`button-cancel-schedule-name-${schedule.id}`}
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-sm font-bold text-foreground">{displayName}</p>
                          {isSelected && (
                            <span className="bg-primary/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-primary">Showing now</span>
                          )}
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {schedule.teamName}{schedule.season ? ` · ${schedule.season}` : ''} · {schedule.eventCount} {schedule.eventCount === 1 ? 'event' : 'events'}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-2">
                        {onOpen && (
                          <button
                            type="button"
                            onClick={() => onOpen(schedule.id)}
                            disabled={actionPending}
                            className="bg-foreground px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-background transition-colors hover:bg-primary hover:text-primary-foreground disabled:cursor-wait disabled:opacity-60"
                            data-testid={`button-open-saved-schedule-${schedule.id}`}
                          >
                            Open
                          </button>
                        )}
                        {onRename && (
                          <button
                            type="button"
                            onClick={() => startRename(schedule)}
                            disabled={actionPending}
                            className="border border-border px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground transition-colors hover:border-foreground hover:text-foreground disabled:opacity-60"
                            data-testid={`button-rename-saved-schedule-${schedule.id}`}
                          >
                            Rename
                          </button>
                        )}
                        {onRemove && (
                          <button
                            type="button"
                            onClick={() => void removeSchedule(schedule.id)}
                            disabled={actionPending}
                            className="border border-destructive/40 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-destructive transition-colors hover:bg-destructive hover:text-destructive-foreground disabled:cursor-wait disabled:opacity-60"
                            data-testid={`button-remove-saved-schedule-${schedule.id}`}
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {actionError && (
            <p className="mt-3 text-xs font-bold uppercase tracking-wider text-destructive" role="alert" data-testid="saved-schedule-action-error">
              {actionError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
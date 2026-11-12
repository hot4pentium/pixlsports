import { getSupporterEventStart } from './supporter-event-time';

type EventToolContext = {
  type: 'game' | 'practice';
  date: string;
  time: string;
  timezone?: string;
  status: string;
  completedAt?: string;
  recordedGameId?: string;
};

export function getEventCardToolGuidance(event: EventToolContext, now = Date.now(), localFinal = false) {
  const clock = /^(\d{1,2}):(\d{2})$/.exec(event.time.trim());
  const start = clock ? getSupporterEventStart(event.date, { hour: Number(clock[1]), minute: Number(clock[2]) }, event.timezone)?.getTime() : undefined;
  const complete = localFinal || event.status === 'Complete' || Boolean(event.completedAt || event.recordedGameId);
  const elapsed = start === undefined ? undefined : now - start;
  const recommended: 'prep' | 'tracker' | 'share' = event.type === 'game' && complete ? 'share'
    : elapsed === undefined ? 'prep'
      : event.type === 'practice' ? (elapsed < 2 * 60 * 60_000 ? 'prep' : 'share')
        : ((event.status === 'Live' || event.status === 'Sharing') && elapsed >= 0 && elapsed < 2 * 60 * 60_000)
          || (elapsed >= -10 * 60_000 && elapsed < 60 * 60_000) ? 'tracker'
          : elapsed < -10 * 60_000 ? 'prep' : 'share';
  const availability = event.type !== 'game' ? 'Game only'
    : complete ? 'Game complete'
      : start === undefined ? 'Add a game start time'
        : now < start - 10 * 60_000 ? 'Available within 10 minutes of start' : 'Available';
  return { recommended, availability, allowed: availability === 'Available', complete, opensAt: start === undefined ? undefined : start - 10 * 60_000 };
}

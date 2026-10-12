import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getGetSoccerGearQueryKey, recordSoccerGearWeeklyLogin } from '@workspace/api-client-react';
import { retrySoccerGearShare } from './soccer-gear-engagement';

export function SoccerGearActivity({ accountId }: { accountId: string }) {
  const queryClient = useQueryClient();
  const [failed, setFailed] = useState(false);
  const retryRef = useRef<() => void>(() => {});
  useEffect(() => {
    let alive = true;
    let busy = false;
    let recordedWeek = '';
    const record = async () => {
      if (busy || !navigator.onLine || document.visibilityState !== 'visible') return;
      const today = new Date();
      const monday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
      monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
      const week = monday.toISOString().slice(0, 10);
      busy = true;
      try {
        if (week !== recordedWeek) {
          await recordSoccerGearWeeklyLogin();
          recordedWeek = week;
        }
        const shared = await retrySoccerGearShare(accountId);
        if (alive) {
          setFailed(!shared);
          await queryClient.invalidateQueries({ queryKey: [...getGetSoccerGearQueryKey(), accountId] });
        }
      } catch { if (alive) setFailed(true); }
      finally { busy = false; }
    };
    retryRef.current = () => void record();
    void record();
    const visible = () => { if (document.visibilityState === 'visible') void record(); };
    window.addEventListener('online', retryRef.current);
    document.addEventListener('visibilitychange', visible);
    const timer = window.setInterval(() => void record(), 30 * 60 * 1000);
    return () => {
      alive = false;
      window.removeEventListener('online', retryRef.current);
      document.removeEventListener('visibilitychange', visible);
      window.clearInterval(timer);
    };
  }, [accountId, queryClient]);
  return failed ? (
    <p role="status" className="px-5 py-2 text-sm text-amber-950 bg-amber-50" data-testid="status-gear-progress-retry">
      Gear progress couldn’t sync. Your saved kit is unchanged.{' '}
      <button type="button" className="underline" onClick={() => retryRef.current()} data-testid="button-retry-gear-progress">Retry progress</button>
    </p>
  ) : null;
}

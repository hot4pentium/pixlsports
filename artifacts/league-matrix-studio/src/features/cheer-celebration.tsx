import { useEffect, useRef } from 'react';
import type { AthleteInviteLiveTapCheer, AthleteInviteLiveTaps, LiveTapCompletion } from '@workspace/api-client-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { lastCompletedSession, totalCheers, type PersonalTally } from './cheer-journal';
import './cheer-celebration.css';

function formatEnded(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function Breakdown({ cheers, testId }: { cheers: AthleteInviteLiveTapCheer[]; testId: string }) {
  const visible = cheers.filter((cheer) => cheer.count > 0);
  if (!visible.length) return null;
  return (
    <ul className="cheer-celebration__breakdown" data-testid={testId}>
      {visible.map((cheer) => (
        <li key={cheer.key}>
          <span aria-hidden="true">{cheer.emoji}</span>
          <span>{cheer.label}</span>
          <strong>{cheer.count}</strong>
        </li>
      ))}
    </ul>
  );
}

export function CheerCelebrationDialog({
  completion,
  personal,
  onClose,
}: {
  completion: LiveTapCompletion | null;
  personal: PersonalTally | null;
  onClose: () => void;
}) {
  const total = totalCheers(completion?.cheers);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const openId = completion?.id ?? null;
  useEffect(() => {
    if (!openId) return;
    const previous = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    returnFocusRef.current = previous;
    return () => {
      const target = returnFocusRef.current;
      returnFocusRef.current = null;
      window.setTimeout(() => {
        if (target?.isConnected) target.focus({ preventScroll: true });
      }, 0);
    };
  }, [openId]);
  const showPersonal = Boolean(personal && personal.contributed);
  return (
    <Dialog open={Boolean(completion)} onOpenChange={(open) => { if (!open) onClose(); }}>
      {completion && (
        <DialogContent
          className="cheer-celebration"
          data-testid="dialog-cheer-celebration"
          onCloseAutoFocus={(event) => { if (returnFocusRef.current?.isConnected) event.preventDefault(); }}
        >
          <div className="cheer-celebration__burst" aria-hidden="true"><span /><span /><span /><span /></div>
          <p className="cheer-celebration__kicker">{total > 0 ? 'Live Taps ended · Cheers completed' : 'Live Taps ended'}</p>
          <DialogTitle className="cheer-celebration__title" data-testid="text-cheer-celebration-athlete">
            {total > 0 ? `The stands showed up for ${completion.athleteName}.` : `Thanks for being here for ${completion.athleteName}.`}
          </DialogTitle>
          <DialogDescription className="cheer-celebration__event" data-testid="text-cheer-celebration-event">
            {completion.eventTitle || 'This game'}
            {formatEnded(completion.endedAt) ? ` · ${formatEnded(completion.endedAt)}` : ''}
          </DialogDescription>
          <div className="cheer-celebration__total">
            <strong data-testid="text-cheer-celebration-total">{total}</strong>
            <span>{total > 0 ? 'Live Taps cheers from family and fans' : 'Live Taps ended with 0 cheers'}</span>
          </div>
          <Breakdown cheers={completion.cheers} testId="list-cheer-celebration-breakdown" />
          {showPersonal && personal && (
            <div className="cheer-celebration__personal" data-testid="status-cheer-celebration-personal">
              {personal.reliable ? (
                <p><strong>{personal.confirmed}</strong> confirmed from this device.</p>
              ) : (
                <p>You cheered from this device. Some earlier taps could not be matched to a receipt, so your exact count is not shown.</p>
              )}
              {personal.pending > 0 && (
                <p className="cheer-celebration__pending" data-testid="text-cheer-celebration-pending">
                  {personal.pending} still being checked. They will count only if the card received them.
                </p>
              )}
            </div>
          )}
          <button type="button" className="cheer-celebration__done" onClick={onClose} data-testid="button-close-cheer-celebration">
            Back to the card
          </button>
        </DialogContent>
      )}
    </Dialog>
  );
}

export function FanCheersSummary({ liveTaps }: { liveTaps: AthleteInviteLiveTaps }) {
  const last = lastCompletedSession(liveTaps.completedSessions);
  return (
    <section className="fan-cheers-summary" aria-label="Fan Cheers" data-testid="fan-cheers-summary">
      <span className="fan-cheers-summary__label">Fan Cheers</span>
      <dl>
        {liveTaps.active && (
          <div className="fan-cheers-summary__live">
            <dt>This game</dt>
            <dd data-testid="text-fan-cheers-game">{totalCheers(liveTaps.cheers)}</dd>
          </div>
        )}
        <div>
          <dt>Season</dt>
          <dd data-testid="text-fan-cheers-season">{totalCheers(liveTaps.seasonCheers)}</dd>
        </div>
        {last && (
          <div>
            <dt>Last game{last.eventTitle ? ` · ${last.eventTitle}` : ''}</dt>
            <dd data-testid="text-fan-cheers-last">{totalCheers(last.cheers)}</dd>
          </div>
        )}
      </dl>
    </section>
  );
}

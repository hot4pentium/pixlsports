import { useLayoutEffect, useState, type ComponentProps } from 'react';
import { DialogContent } from '@/components/ui/dialog';

/** Safari's keyboard shrinks/pans the visual viewport, not the layout viewport. */
export function FanCardFollowDialog({ children, ...props }: ComponentProps<typeof DialogContent>) {
  // Radix mounts its portal after this component's first layout effect.
  const [dialog, setDialog] = useState<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const viewport = window.visualViewport;
    if (!dialog || !viewport) return;
    let frame = 0;
    const update = () => {
      dialog.style.setProperty('--follow-viewport-center', `${viewport.offsetTop + viewport.height / 2}px`);
      dialog.style.setProperty('--follow-viewport-height', `${viewport.height}px`);
    };
    const scheduleUpdate = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    update();
    viewport.addEventListener('resize', scheduleUpdate);
    viewport.addEventListener('scroll', scheduleUpdate);
    return () => {
      cancelAnimationFrame(frame);
      viewport.removeEventListener('resize', scheduleUpdate);
      viewport.removeEventListener('scroll', scheduleUpdate);
      dialog.style.removeProperty('--follow-viewport-center');
      dialog.style.removeProperty('--follow-viewport-height');
    };
  }, [dialog]);

  return (
    <DialogContent {...props} ref={setDialog}>
      <div className="living-card-dialog-body living-card-follow-dialog-scroll">{children}</div>
    </DialogContent>
  );
}

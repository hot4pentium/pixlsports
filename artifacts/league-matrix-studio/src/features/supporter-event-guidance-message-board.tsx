import { ArrowRight } from 'lucide-react';
import './supporter-event-guidance-message-board.css';

type SupporterEventGuidanceMessageBoardProps = {
  category: string;
  title: string;
  dateTime: string;
  actionLabel: string;
  onOpen: () => void;
  testId?: string;
  actionTestId?: string;
};

export function SupporterEventGuidanceMessageBoard({
  category,
  title,
  dateTime,
  actionLabel,
  onOpen,
  testId = 'upcoming-event-badge',
  actionTestId = 'button-guidance-event-card',
}: SupporterEventGuidanceMessageBoardProps) {
  return (
    <section
      className="supporter-event-guidance-board"
      data-testid={testId}
      aria-label="Event Card message board"
    >
      <article className="supporter-event-guidance-board__ticket">
        <header className="supporter-event-guidance-board__masthead">
          <span>PIXL SPORTS</span>
          <span>EVENT CARD</span>
        </header>
        <p className="supporter-event-guidance-board__category">{category}</p>
        <h3 className="supporter-event-guidance-board__title">{title}</h3>
        {dateTime && (
          <div className="supporter-event-guidance-board__date">
            <span>Date &amp; time</span>
            <strong>{dateTime}</strong>
          </div>
        )}
      </article>
      <div className="supporter-event-guidance-board__action">
        <button
          type="button"
          onClick={onOpen}
          data-testid={actionTestId}
          aria-label={`${actionLabel}: open Event Card for ${title}`}
        >
          <span>{actionLabel}</span>
          <ArrowRight size={13} aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}

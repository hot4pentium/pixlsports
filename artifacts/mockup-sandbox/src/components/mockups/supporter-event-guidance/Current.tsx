import { useEffect, useState } from "react";
import "./_group.css";
import { renderSupporterEventBadgeImage } from "./supporter-event-badge-image";

const eventBadge = {
  src: "/__mockup/images/supporter-event-badge.png",
  category: "Upcoming game",
  title: "Hornets vs Bears",
  dateTime: "Oct 24, 2026 · 9:00 AM",
};

export function Current() {
  const imageKey = JSON.stringify(eventBadge);
  const [preparedImage, setPreparedImage] = useState<{ key: string; src: string } | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    renderSupporterEventBadgeImage(eventBadge)
      .then((imageSrc) => {
        if (!cancelled) setPreparedImage({ key: imageKey, src: imageSrc });
      })
      .catch(() => {
        if (!cancelled) setFailedKey(imageKey);
      });
    return () => {
      cancelled = true;
    };
  }, [imageKey]);

  return (
    <main className="supporter-guidance-current">
      <div className="supporter-upcoming-event-badge" data-testid="upcoming-event-badge">
        {preparedImage?.key === imageKey ? (
          <img
            src={preparedImage.src}
            alt=""
            data-testid="img-upcoming-event-card-mobile"
            data-base-artwork={eventBadge.src}
            data-event-category={eventBadge.category}
            data-event-title={eventBadge.title}
            data-event-date-time={eventBadge.dateTime}
          />
        ) : (
          <span role="status">
            {failedKey === imageKey ? "Event badge could not load. Refresh to retry." : "Preparing event badge…"}
          </span>
        )}
      </div>
    </main>
  );
}

import { Fragment, useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { GAME_ON_COLLECTION_ID } from "./game-on-navigation";
import { supporterToolRoutes } from "./supporter-dashboard-model";
import "./supporter-dashboard-tour.css";

type DismissKind = "finish" | "skip";
type Phase = "prepare" | "capture" | "celebrate";

export type SupporterDashboardTourProps = {
  autoStart: boolean;
  onDismiss: (kind: DismissKind) => Promise<void>;
};

const steps: ReadonlyArray<{
  title: string;
  phase: Phase;
  description: string;
  linkLabel: string;
  href: string;
}> = [
  {
    title: "Game On cards",
    phase: "prepare",
    description: "Keep each game in one place. Pick a card to bring its plan, moments, and memories together.",
    linkLabel: "Explore Game On cards",
    href: `#${GAME_ON_COLLECTION_ID}`,
  },
  {
    title: "Calendar",
    phase: "prepare",
    description: "See what is coming up so your family knows where to be and when to show up.",
    linkLabel: "Open Calendar",
    href: supporterToolRoutes.schedule,
  },
  {
    title: "Checklist",
    phase: "prepare",
    description: "Get the little things ready before game day, from the bag to the last-minute details.",
    linkLabel: "Open Checklist",
    href: supporterToolRoutes.checklist,
  },
  {
    title: "Stat Tracker",
    phase: "capture",
    description: "Record the plays worth remembering while the game is happening, not hours later.",
    linkLabel: "Open Stat Tracker",
    href: supporterToolRoutes.statTracker,
  },
  {
    title: "Hype Cards",
    phase: "celebrate",
    description: "Turn a standout moment into something your athlete can see, share, and feel proud of.",
    linkLabel: "Make a Hype Card",
    href: supporterToolRoutes.hypeCard,
  },
];

export function SupporterDashboardTour({ autoStart, onDismiss }: SupporterDashboardTourProps) {
  const [open, setOpen] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const hasStartedRef = useRef(false);
  const pendingRef = useRef(false);
  const restoreFocusRef = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const replayRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (autoStart && !hasStartedRef.current) {
      hasStartedRef.current = true;
      setStepIndex(0);
      setError(false);
      setOpen(true);
    }
  }, [autoStart]);

  useEffect(() => {
    if (open) headingRef.current?.focus();
  }, [open, stepIndex]);

  useEffect(() => {
    if (open || !restoreFocusRef.current) return;
    restoreFocusRef.current = false;
    const frame = window.requestAnimationFrame(() => replayRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  const replay = () => {
    if (pendingRef.current) return;
    hasStartedRef.current = true;
    setError(false);
    setStepIndex(0);
    setOpen(true);
    // A replay while already on the first step has no state change to trigger the focus effect.
    if (open && stepIndex === 0) headingRef.current?.focus();
  };

  const dismiss = async (kind: DismissKind) => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setError(false);
    try {
      await onDismiss(kind);
      hasStartedRef.current = true;
      restoreFocusRef.current = true;
      setOpen(false);
    } catch {
      setError(true);
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };

  const step = steps[stepIndex];

  return (
    <div className="supporter-tour" data-testid="supporter-dashboard-tour">
      <button
        ref={replayRef}
        className="supporter-tour__replay"
        type="button"
        onClick={replay}
        disabled={pending}
        aria-expanded={open}
        aria-controls="supporter-dashboard-tour-panel"
        data-testid="supporter-dashboard-tour-replay"
      >
        <span className="supporter-tour__replay-mark" aria-hidden="true">↗</span>
        {open ? "Start tour over" : "Tour the dashboard"}
      </button>

      {open && (
        <section
          id="supporter-dashboard-tour-panel"
          className="supporter-tour__card"
          aria-labelledby="supporter-dashboard-tour-heading"
          aria-describedby="supporter-dashboard-tour-description"
          aria-busy={pending}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              event.preventDefault();
              void dismiss("skip");
            }
          }}
        >
          <div className="supporter-tour__inner">
            <div className="supporter-tour__topline">
              <span>Your game-day route</span>
              <span className="supporter-tour__count" aria-label={`Step ${stepIndex + 1} of ${steps.length}`}>
                {String(stepIndex + 1).padStart(2, "0")} / {String(steps.length).padStart(2, "0")}
              </span>
            </div>

            <div className="supporter-tour__path" role="group" aria-label="Prepare, then capture, then celebrate">
              {(["prepare", "capture", "celebrate"] as const).map((phase, index) => (
                <Fragment key={phase}>
                  {index > 0 && <span className="supporter-tour__path-arrow" aria-hidden="true">→</span>}
                  <span className="supporter-tour__phase" data-active={step.phase === phase}>{phase}</span>
                </Fragment>
              ))}
            </div>

            <div data-testid="supporter-dashboard-tour-step">
              <h2
                ref={headingRef}
                id="supporter-dashboard-tour-heading"
                className="supporter-tour__heading"
                tabIndex={-1}
              >
                {step.title}
              </h2>
              <p id="supporter-dashboard-tour-description" className="supporter-tour__description">
                {step.description}
              </p>
              {step.href.startsWith("#") ? (
                <a className="supporter-tour__visit" href={step.href} data-testid="supporter-dashboard-tour-link">
                  {step.linkLabel} <span className="supporter-tour__visit-arrow" aria-hidden="true">↗</span>
                </a>
              ) : (
                <Link className="supporter-tour__visit" href={step.href} data-testid="supporter-dashboard-tour-link">
                  {step.linkLabel} <span className="supporter-tour__visit-arrow" aria-hidden="true">↗</span>
                </Link>
              )}
            </div>

            <div className="supporter-tour__progress" aria-hidden="true">
              {steps.map((item, index) => (
                <span className="supporter-tour__progress-piece" data-complete={index <= stepIndex} key={item.title} />
              ))}
            </div>
            {error && (
              <p role="alert" className="supporter-tour__error" data-testid="supporter-dashboard-tour-error">
                Your choice could not be saved. Try Finish or Skip again.
              </p>
            )}
            {pending && <p role="status" className="supporter-tour__saving">Saving your choice…</p>}
            <div className="supporter-tour__controls">
              <button
                type="button"
                className="supporter-tour__control supporter-tour__control--skip"
                onClick={() => void dismiss("skip")}
                disabled={pending}
                data-testid="supporter-dashboard-tour-skip"
              >
                Skip
              </button>
              <button
                type="button"
                className="supporter-tour__control"
                onClick={() => { setError(false); setStepIndex((index) => Math.max(0, index - 1)); }}
                disabled={stepIndex === 0 || pending}
                data-testid="supporter-dashboard-tour-back"
              >
                Back
              </button>
              {stepIndex < steps.length - 1 ? (
                <button
                  type="button"
                  className="supporter-tour__control supporter-tour__control--primary"
                  onClick={() => { setError(false); setStepIndex((index) => index + 1); }}
                  disabled={pending}
                  data-testid="supporter-dashboard-tour-next"
                >
                  Next
                </button>
              ) : (
                <button
                  type="button"
                  className="supporter-tour__control supporter-tour__control--primary"
                  onClick={() => void dismiss("finish")}
                  disabled={pending}
                  data-testid="supporter-dashboard-tour-finish"
                >
                  Finish
                </button>
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
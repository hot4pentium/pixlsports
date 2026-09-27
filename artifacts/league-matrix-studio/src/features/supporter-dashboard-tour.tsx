import { Fragment, useEffect, useRef, useState } from "react";
import { GAME_ON_COLLECTION_ID } from "./game-on-navigation";
import { supporterToolRoutes } from "./supporter-dashboard-model";
import { clearDashboardTourProgress, readDashboardTourProgress, saveDashboardTourProgress } from "./supporter-dashboard-tour-state";
import "./supporter-dashboard-tour.css";

type DismissKind = "finish" | "skip";
type Phase = "prepare" | "capture" | "celebrate";

export type SupporterDashboardTourProps = {
  userId?: string | null;
  autoStart: boolean;
  onDismiss: (kind: DismissKind) => Promise<void>;
  canOpenPrep?: boolean;
  canOpenCompactTracker?: boolean;
  onOpenCardPanel?: (panel: "prep" | "tracker", trigger: HTMLButtonElement) => void;
};

const steps: ReadonlyArray<{
  title: string;
  phase: Phase;
  description: string;
  linkLabel: string;
  href: string;
  panel?: "prep" | "tracker";
}> = [
  {
    title: "Game On cards",
    phase: "prepare",
    description: "Create an event card for each game or practice to keep the details organized.",
    linkLabel: "Explore Game On cards",
    href: `#${GAME_ON_COLLECTION_ID}`,
  },
  {
    title: "Prep",
    phase: "prepare",
    description: "Use Prep on a Game On card to make your list, add notes, and create an edit link for the people helping.",
    linkLabel: "Show card Prep",
    href: `#${GAME_ON_COLLECTION_ID}`,
    panel: "prep",
  },
  {
    title: "Stat Tracker",
    phase: "capture",
    description: "Open the compact Stat Tracker on a game card to record plays without leaving your Game On card.",
    linkLabel: "Show compact tracker",
    href: `#${GAME_ON_COLLECTION_ID}`,
    panel: "tracker",
  },
  {
    title: "Athlete fan card",
    phase: "celebrate",
    description: "Create and manage one evolving card where fans can follow your athlete’s highlights and season.",
    linkLabel: "Manage athlete fan card",
    href: supporterToolRoutes.athletePage,
  },
];

function sessionStorageOrNull(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function SupporterDashboardTour({ userId, autoStart, onDismiss, canOpenPrep = false, canOpenCompactTracker = false, onOpenCardPanel }: SupporterDashboardTourProps) {
  const [resumedStep] = useState(() => readDashboardTourProgress(sessionStorageOrNull(), userId, steps.length));
  const [open, setOpen] = useState(resumedStep !== null);
  const [stepIndex, setStepIndex] = useState(resumedStep ?? 0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const hasStartedRef = useRef(resumedStep !== null);
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
    if (open) saveDashboardTourProgress(sessionStorageOrNull(), userId, stepIndex);
  }, [open, stepIndex, userId]);

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
      clearDashboardTourProgress(sessionStorageOrNull(), userId);
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
  const canOpenPanel = Boolean(onOpenCardPanel && (
    (step.panel === "prep" && canOpenPrep) || (step.panel === "tracker" && canOpenCompactTracker)
  ));

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
              {step.panel && canOpenPanel ? (
                <button
                  type="button"
                  className="supporter-tour__visit"
                  onClick={(event) => onOpenCardPanel?.(step.panel!, event.currentTarget)}
                  data-testid="supporter-dashboard-tour-link"
                >
                  {step.linkLabel} <span className="supporter-tour__visit-arrow" aria-hidden="true">↗</span>
                </button>
              ) : step.href.startsWith("#") ? (
                <a className="supporter-tour__visit" href={step.href} data-testid="supporter-dashboard-tour-link">
                  {step.panel ? step.panel === "prep" ? "Add a Game On card for Prep" : "Add a game card for tracking" : step.linkLabel} <span className="supporter-tour__visit-arrow" aria-hidden="true">↗</span>
                </a>
              ) : (
                <a className="supporter-tour__visit" href={step.href} target="_blank" rel="noopener noreferrer" data-testid="supporter-dashboard-tour-link">
                  {step.linkLabel} <span className="supporter-tour__visit-arrow" aria-hidden="true">↗</span>
                </a>
              )}
              {!step.panel && !step.href.startsWith("#") && (
                <p className="supporter-tour__example-hint">Opens in a new tab. Return here to finish the tour.</p>
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
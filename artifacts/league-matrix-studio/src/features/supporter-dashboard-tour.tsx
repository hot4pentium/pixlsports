import { Fragment, useEffect, useRef, useState } from "react";
import { clearDashboardTourProgress, readDashboardTourProgress, saveDashboardTourProgress } from "./supporter-dashboard-tour-state";
import "./supporter-dashboard-tour.css";

type DismissKind = "finish" | "skip";
type Phase = "prepare" | "capture" | "celebrate";

export type SupporterDashboardTourProps = {
  userId?: string | null;
  autoStart: boolean;
  onDismiss: (kind: DismissKind) => Promise<void>;
};

const steps: ReadonlyArray<{
  title: string;
  phase: Phase;
  description: string;
  homeScreenGuide?: boolean;
}> = [
  {
    title: "Game On cards",
    phase: "prepare",
    description: "Keep each game or practice’s time, place, and details together on a shareable card, so everyone knows what to expect.",
  },
  {
    title: "Prep",
    phase: "prepare",
    description: "Use Prep on a Game On card to make a checklist, add notes, and share an edit link with the people helping.",
  },
  {
    title: "Stat Tracker",
    phase: "capture",
    description: "Record plays from a game card while you watch. The compact tracker keeps each play connected to the right game.",
  },
  {
    title: "Athlete fan card",
    phase: "celebrate",
    description: "Create one evolving card where fans can follow your athlete’s highlights and season.",
  },
  {
    title: "Add Pixl Sports to your home screen",
    phase: "celebrate",
    description: "A home-screen shortcut makes it faster to get back to your athlete’s game-day details and fan card. This is optional; you can finish the tour without installing anything.",
    homeScreenGuide: true,
  },
];

function sessionStorageOrNull(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function SupporterDashboardTour({ userId, autoStart, onDismiss }: SupporterDashboardTourProps) {
  const [resumedStep] = useState(() => readDashboardTourProgress(sessionStorageOrNull(), userId, steps.length));
  const [open, setOpen] = useState(resumedStep !== null);
  const [stepIndex, setStepIndex] = useState(resumedStep ?? 0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const hasStartedRef = useRef(resumedStep !== null);
  const pendingRef = useRef(false);
  const restoreFocusRef = useRef(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
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
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      if (!dialog.open) dialog.showModal();
      headingRef.current?.focus();
    } else if (dialog.open) {
      dialog.close();
    }
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

      <dialog
        ref={dialogRef}
        className="supporter-tour__dialog"
        id="supporter-dashboard-tour-panel"
        aria-modal="true"
        aria-labelledby="supporter-dashboard-tour-heading"
        aria-describedby="supporter-dashboard-tour-description"
        aria-busy={pending}
        onCancel={(event) => {
          event.preventDefault();
          void dismiss("skip");
        }}
      >
        <div className="supporter-tour__inner">
          <div className="supporter-tour__topline">
            <span>{step.homeScreenGuide ? "Optional home-screen setup" : "Your game-day route"}</span>
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
            {step.homeScreenGuide && (
              <div className="supporter-tour__install-guidance" data-testid="supporter-dashboard-tour-install-guidance">
                <section aria-labelledby="supporter-tour-ios-heading">
                  <h3 id="supporter-tour-ios-heading">iPhone or iPad</h3>
                  <p>Open this page in Safari, tap Share, choose Add to Home Screen, then tap Add.</p>
                </section>
                <section aria-labelledby="supporter-tour-android-heading">
                  <h3 id="supporter-tour-android-heading">Android</h3>
                  <p>In Chrome, open the three-dot menu and choose Add to Home screen or Install app, then tap Add or Install.</p>
                </section>
                <p className="supporter-tour__desktop-note">
                  On desktop, you can use Chrome’s Install Pixl Sports option if it’s available, or bookmark this page. Both phone guides above stay visible so you can follow them later.
                </p>
              </div>
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
      </dialog>
    </div>
  );
}
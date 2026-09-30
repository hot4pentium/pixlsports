import { Fragment, useEffect, useRef, useState } from "react";
import { clearDashboardTourProgress, readDashboardTourProgress, saveDashboardTourProgress } from "./supporter-dashboard-tour-state";
import "./supporter-dashboard-tour.css";

type DismissKind = "finish" | "skip";
type Phase = "prepare" | "capture" | "celebrate";

export type SupporterDashboardTourProps = {
  userId?: string | null;
  autoStart: boolean;
  onDismiss: (kind: DismissKind) => Promise<void>;
  onCreateFirstEventCard: () => void;
};

const steps: ReadonlyArray<{
  title: string;
  phase: Phase;
  description: string;
  homeScreenGuide?: boolean;
}> = [
  {
    title: "Welcome to Pixl Sports",
    phase: "prepare",
    description: "Here's the gameplan... Keep game and practice details on Event Cards, use Prep to get ready, track the action, then celebrate your athlete on a HYPE Card.",
  },
  {
    title: "Event Cards",
    phase: "prepare",
    description: "Keep each game or practice’s time, place, and details together on a shareable Event Card, so everyone knows what to expect.",
  },
  {
    title: "Prep",
    phase: "prepare",
    description: "Use Prep on an Event Card to make a checklist, add notes, and share an edit link with the people helping.",
  },
  {
    title: "Stat Tracker",
    phase: "capture",
    description: "Record plays from an Event Card while you watch. The compact tracker keeps each play connected to the right game.",
  },
  {
    title: "HYPE Card",
    phase: "celebrate",
    description: "Create one evolving HYPE Card where fans can follow your athlete’s highlights and season.",
  },
  {
    title: "Add Pixl Sports to your home screen",
    phase: "celebrate",
    description: "A home-screen shortcut makes it faster to get back to your athlete’s game-day details and HYPE Card. This is optional; you can finish the tour without installing anything.",
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

export function SupporterDashboardTour({
  userId,
  autoStart,
  onDismiss,
  onCreateFirstEventCard,
}: SupporterDashboardTourProps) {
  const [resumedStep] = useState(() => readDashboardTourProgress(sessionStorageOrNull(), userId, steps.length));
  const [open, setOpen] = useState(resumedStep !== null);
  const [firstCardPromptOpen, setFirstCardPromptOpen] = useState(false);
  const [stepIndex, setStepIndex] = useState(resumedStep ?? 0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const hasStartedRef = useRef(resumedStep !== null);
  const pendingRef = useRef(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstCardDialogRef = useRef<HTMLDialogElement>(null);
  const firstCardHeadingRef = useRef<HTMLHeadingElement>(null);

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
    const dialog = firstCardDialogRef.current;
    if (!dialog) return;
    if (firstCardPromptOpen) {
      if (!dialog.open) dialog.showModal();
      firstCardHeadingRef.current?.focus();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [firstCardPromptOpen]);

  const dismiss = async (kind: DismissKind) => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setError(false);
    try {
      await onDismiss(kind);
      clearDashboardTourProgress(sessionStorageOrNull(), userId);
      hasStartedRef.current = true;
      setOpen(false);
      if (kind === "finish") setFirstCardPromptOpen(true);
    } catch {
      setError(true);
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };

  const step = steps[stepIndex];
  const createFirstEventCard = () => {
    setFirstCardPromptOpen(false);
    onCreateFirstEventCard();
  };

  return (
    <div className="supporter-tour" data-testid="supporter-dashboard-tour">
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
                  <h3 id="supporter-tour-ios-heading">iPhone or iPad · Safari</h3>
                  <p>
                    Open this page in Safari. <strong>iPhone:</strong> tap Share (or More → Share in some layouts) → Add to Home Screen.
                    If it’s missing, scroll down to Edit Actions → Add to Home Screen. Turn on Open as Web App if it appears, then tap Add.
                  </p>
                  <p>
                    <strong>iPad:</strong> tap Share → View More → Add to Home Screen. Turn on Open as Web App if it appears, then tap Add.
                  </p>
                </section>
                <section aria-labelledby="supporter-tour-android-heading">
                  <h3 id="supporter-tour-android-heading">Android</h3>
                  <p>
                    In Chrome, open the three-dot menu → Install and create shortcut. Choose Install, or Create shortcut → Add. Some versions say Add to Home screen;
                    follow its prompt. If no install or shortcut option appears, bookmark this page.
                  </p>
                </section>
                <p className="supporter-tour__desktop-note">
                  On desktop, use Chrome’s Install option if available, or bookmark this page. Both phone guides stay visible here so you can follow them later.
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
      <dialog
        ref={firstCardDialogRef}
        className="supporter-tour__dialog supporter-tour__dialog--first-card"
        aria-modal="true"
        aria-labelledby="supporter-dashboard-first-card-heading"
        aria-describedby="supporter-dashboard-first-card-description"
        onCancel={(event) => {
          event.preventDefault();
          setFirstCardPromptOpen(false);
        }}
        data-testid="supporter-dashboard-first-card-prompt"
      >
        <div className="supporter-tour__inner supporter-tour__first-card-inner">
          <div className="supporter-tour__topline">
            <span>Your first step</span>
          </div>
          <h2
            ref={firstCardHeadingRef}
            id="supporter-dashboard-first-card-heading"
            className="supporter-tour__heading"
            tabIndex={-1}
          >
            Create your first Event Card
          </h2>
          <p id="supporter-dashboard-first-card-description" className="supporter-tour__description">
            Add your next game or practice so the details, Prep, and game-day tools are ready when you need them.
          </p>
          <div className="supporter-tour__controls supporter-tour__first-card-controls">
            <button
              type="button"
              className="supporter-tour__control"
              onClick={() => setFirstCardPromptOpen(false)}
              data-testid="supporter-dashboard-first-card-later"
            >
              Maybe later
            </button>
            <button
              type="button"
              className="supporter-tour__control supporter-tour__control--primary"
              onClick={createFirstEventCard}
              data-testid="supporter-dashboard-first-card-create"
            >
              Create your first Event Card
            </button>
          </div>
        </div>
      </dialog>
    </div>
  );
}
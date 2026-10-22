import { useEffect, useRef, useState } from "react";
import "./_group.css";

export function MessageBoard() {
  const [cardOpen, setCardOpen] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const openButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (cardOpen) closeButtonRef.current?.focus();
  }, [cardOpen]);

  useEffect(() => {
    if (!cardOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setCardOpen(false);
        openButtonRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cardOpen]);

  return (
    <main className="prep-board">
      <style>{`
        .prep-board {
          --board-blue: #1766ce;
          --board-deep: #0c3b78;
          --paper-ink: #12233d;
          min-height: 100vh;
          display: grid;
          place-items: center;
          overflow: hidden;
          padding: clamp(20px, 5vw, 64px);
          color: #fff;
          background:
            radial-gradient(ellipse at 82% 8%, rgb(72 157 255 / 42%), transparent 33%),
            radial-gradient(ellipse at 8% 100%, rgb(3 28 70 / 72%), transparent 44%),
            linear-gradient(132deg, #2378e5 0%, #1155ae 48%, #0b3470 100%);
          font-family: var(--app-font-sans, "DM Sans", sans-serif);
          position: relative;
          isolation: isolate;
        }
        .prep-board::before {
          content: "";
          position: absolute;
          inset: 0;
          z-index: -1;
          pointer-events: none;
          opacity: .18;
          background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 180 180' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.88' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.22'/%3E%3C/svg%3E");
        }
        .prep-board__frame {
          width: min(100%, 1010px);
          position: relative;
          animation: prep-board-arrive 700ms cubic-bezier(.2,.75,.25,1) both;
        }
        .prep-board__eyebrow {
          display: flex;
          align-items: center;
          gap: 11px;
          margin: 0 0 14px 3px;
          color: #d8eaff;
          font-size: 11px;
          font-weight: 800;
          letter-spacing: .2em;
          text-transform: uppercase;
        }
        .prep-board__eyebrow::before {
          content: "";
          width: 24px;
          height: 2px;
          background: #ffb056;
        }
        .prep-board__title {
          margin: 0 0 clamp(24px, 4vw, 40px);
          font-family: var(--app-font-serif, "Barlow Condensed", sans-serif);
          font-size: clamp(34px, 6vw, 62px);
          font-weight: 900;
          line-height: .95;
          letter-spacing: -.035em;
          text-transform: uppercase;
          text-shadow: 0 2px 0 rgb(2 24 57 / 18%);
        }
        .prep-board__title span {
          color: #ffbe70;
        }
        .prep-board__composition {
          display: grid;
          grid-template-columns: minmax(270px, 1fr) minmax(210px, .73fr);
          align-items: stretch;
          gap: clamp(16px, 3vw, 34px);
        }
        .event-paper {
          position: relative;
          min-height: 380px;
          overflow: hidden;
          padding: 31px clamp(24px, 4vw, 46px) 30px;
          color: var(--paper-ink);
          background:
            linear-gradient(90deg, rgb(19 43 79 / 3%) 1px, transparent 1px) 0 0 / 20px 100%,
            #fffefa;
          border-radius: 14px 14px 20px 20px;
          box-shadow: 0 22px 48px rgb(3 24 57 / 30%), 0 3px 0 rgb(255 255 255 / 45%) inset;
          transform: rotate(-1deg);
        }
        .event-paper::before {
          content: "";
          position: absolute;
          top: 15px;
          left: 50%;
          width: 62px;
          height: 13px;
          border-radius: 99px;
          transform: translateX(-50%);
          background: linear-gradient(#e3e5e8, #fff 65%);
          box-shadow: inset 0 1px 3px rgb(20 35 56 / 28%);
        }
        .event-paper__masthead {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-top: 18px;
          padding-bottom: 13px;
          border-bottom: 1px solid #d7dce4;
          color: #12233d;
          font-family: var(--app-font-serif, "Barlow Condensed", sans-serif);
          font-size: 15px;
          font-weight: 900;
          letter-spacing: .01em;
        }
        .event-paper__edition {
          color: #3474d3;
          font-family: var(--app-font-sans, "DM Sans", sans-serif);
          font-size: 8px;
          font-weight: 800;
          letter-spacing: .16em;
        }
        .event-paper__category {
          margin: 29px 0 7px;
          color: #3474d3;
          font-size: 11px;
          font-weight: 900;
          letter-spacing: .12em;
          text-transform: uppercase;
        }
        .event-paper__teams {
          margin: 0;
          color: #12233d;
          font-family: var(--app-font-serif, "Barlow Condensed", sans-serif);
          font-size: clamp(33px, 4.2vw, 48px);
          font-weight: 900;
          line-height: .98;
          letter-spacing: -.025em;
        }
        .event-paper__rule {
          height: 1px;
          margin: 24px 0 17px;
          background: #27384d;
        }
        .event-paper__date-label {
          margin: 0 0 7px;
          color: #3474d3;
          font-size: 9px;
          font-weight: 900;
          letter-spacing: .13em;
          text-transform: uppercase;
        }
        .event-paper__date {
          margin: 0;
          color: #16263b;
          font-size: clamp(15px, 2vw, 18px);
          font-weight: 800;
          letter-spacing: -.02em;
        }
        .event-paper__stamp {
          position: absolute;
          right: 23px;
          bottom: 18px;
          color: #9aa6b6;
          font-size: 8px;
          font-weight: 800;
          letter-spacing: .16em;
          text-transform: uppercase;
        }
        .board-side {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .athlete-moment {
          flex: 1;
          min-height: 230px;
          overflow: hidden;
          position: relative;
          border: 1px solid rgb(255 255 255 / 42%);
          border-radius: 14px;
          background: #173752;
          box-shadow: 0 18px 32px rgb(3 24 57 / 27%);
        }
        .athlete-moment__scene {
          display: block;
          width: 100%;
          height: 100%;
          min-height: 230px;
        }
        .athlete-moment__caption {
          position: absolute;
          inset: auto 0 0;
          padding: 35px 18px 16px;
          background: linear-gradient(transparent, rgb(6 22 37 / 86%));
          color: #fff4d7;
          font-family: var(--app-font-serif, "Barlow Condensed", sans-serif);
          font-size: 17px;
          font-weight: 800;
          letter-spacing: .07em;
          text-transform: uppercase;
        }
        .prep-note {
          padding: 17px 18px 17px 20px;
          color: #fff;
          border: 1px solid rgb(255 255 255 / 22%);
          border-radius: 12px;
          background: rgb(4 31 70 / 38%);
          box-shadow: 0 12px 26px rgb(3 24 57 / 17%);
        }
        .prep-note__label {
          margin: 0 0 7px;
          color: #ffbe70;
          font-size: 9px;
          font-weight: 900;
          letter-spacing: .16em;
          text-transform: uppercase;
        }
        .prep-note__copy {
          margin: 0;
          font-size: 14px;
          font-weight: 650;
          line-height: 1.5;
        }
        .prep-board__actions {
          display: flex;
          justify-content: flex-end;
          margin-top: 22px;
        }
        .event-open-button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 15px;
          min-height: 50px;
          padding: 0 22px;
          border: 0;
          border-radius: 5px;
          color: #163456;
          background: #ffbe70;
          box-shadow: 0 4px 0 #cf7e34, 0 12px 24px rgb(6 27 60 / 24%);
          font-family: var(--app-font-sans, "DM Sans", sans-serif);
          font-size: 12px;
          font-weight: 900;
          letter-spacing: .09em;
          text-transform: uppercase;
          cursor: pointer;
          transition: transform 160ms ease, background-color 160ms ease;
        }
        .event-open-button:hover {
          background: #ffca87;
          transform: translateY(-2px);
        }
        .event-open-button:active {
          transform: translateY(1px);
        }
        .event-open-button:focus-visible,
        .event-dialog__close:focus-visible {
          outline: 3px solid #fff;
          outline-offset: 4px;
        }
        .event-open-button__arrow {
          font-size: 19px;
          line-height: 1;
        }
        .event-dialog-backdrop {
          position: fixed;
          z-index: 10;
          inset: 0;
          display: grid;
          place-items: center;
          padding: 20px;
          background: rgb(3 18 39 / 76%);
          backdrop-filter: blur(6px);
        }
        .event-dialog {
          width: min(100%, 440px);
          position: relative;
          padding: 34px;
          border-radius: 16px;
          color: var(--paper-ink);
          background: #fffefa;
          box-shadow: 0 24px 80px rgb(0 0 0 / 35%);
          animation: prep-board-arrive 220ms ease both;
        }
        .event-dialog__close {
          position: absolute;
          top: 14px;
          right: 14px;
          display: grid;
          place-items: center;
          width: 36px;
          height: 36px;
          border: 1px solid #dce2eb;
          border-radius: 50%;
          color: #24364d;
          background: transparent;
          font-size: 20px;
          cursor: pointer;
        }
        .event-dialog__label {
          margin: 0 0 10px;
          color: #3474d3;
          font-size: 11px;
          font-weight: 900;
          letter-spacing: .14em;
          text-transform: uppercase;
        }
        .event-dialog__title {
          margin: 0;
          font-family: var(--app-font-serif, "Barlow Condensed", sans-serif);
          font-size: 42px;
          font-weight: 900;
          line-height: 1;
        }
        .event-dialog__date {
          margin: 13px 0 0;
          color: #47566b;
          font-weight: 700;
        }
        .event-dialog__divider {
          height: 1px;
          margin: 23px 0;
          background: #d9dee5;
        }
        .event-dialog__prep {
          margin: 0;
          color: #283b54;
          font-size: 14px;
          line-height: 1.6;
        }
        @keyframes prep-board-arrive {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @media (max-width: 650px) {
          .prep-board { padding: 24px 18px 32px; }
          .prep-board__composition { grid-template-columns: 1fr; }
          .event-paper { min-height: 330px; transform: none; }
          .board-side { display: grid; grid-template-columns: 1fr; }
          .athlete-moment, .athlete-moment__scene { min-height: 215px; }
          .prep-board__actions { justify-content: stretch; }
          .event-open-button { width: 100%; }
        }
        @media (prefers-reduced-motion: reduce) {
          .prep-board__frame, .event-dialog { animation: none; }
          .event-open-button { transition: none; }
        }
      `}</style>

      <section className="prep-board__frame" aria-labelledby="prep-board-title">
        <p className="prep-board__eyebrow">Pixl Sports · Supporter Hub</p>
        <h1 className="prep-board__title" id="prep-board-title">
          Game day, <span>in sight.</span>
        </h1>

        <div className="prep-board__composition">
          <article className="event-paper" aria-label="Upcoming event card">
            <header className="event-paper__masthead">
              <span>PIXL SPORTS</span>
              <span className="event-paper__edition">EVENT CARD</span>
            </header>
            <p className="event-paper__category">Upcoming game</p>
            <h2 className="event-paper__teams">Hornets vs Bears</h2>
            <div className="event-paper__rule" />
            <p className="event-paper__date-label">Date &amp; time</p>
            <p className="event-paper__date">Oct 24, 2026 · 9:00 AM</p>
            <span className="event-paper__stamp">A moment worth showing up for</span>
          </article>

          <div className="board-side">
            <figure className="athlete-moment" aria-label="A young athlete ready for game day">
              <svg
                className="athlete-moment__scene"
                viewBox="0 0 420 310"
                role="img"
                aria-labelledby="athlete-scene-title"
                preserveAspectRatio="xMidYMid slice"
              >
                <title id="athlete-scene-title">A young baseball player on a sunlit field</title>
                <defs>
                  <linearGradient id="field-sky" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0" stopColor="#f3bd68" />
                    <stop offset=".42" stopColor="#8eb8a2" />
                    <stop offset="1" stopColor="#315e5d" />
                  </linearGradient>
                  <linearGradient id="field-grass" x1="0" y1="0" x2="0" y2="1">
                    <stop stopColor="#7da16a" />
                    <stop offset="1" stopColor="#274d49" />
                  </linearGradient>
                  <linearGradient id="uniform" x1="0" y1="0" x2="1" y2="1">
                    <stop stopColor="#f5f1df" />
                    <stop offset="1" stopColor="#b6c6cf" />
                  </linearGradient>
                  <filter id="soft-photo">
                    <feGaussianBlur stdDeviation="1.5" />
                  </filter>
                </defs>
                <rect width="420" height="310" fill="url(#field-sky)" />
                <g opacity=".55" filter="url(#soft-photo)">
                  <circle cx="39" cy="48" r="44" fill="#f3d289" />
                  <path d="M0 130 56 88l43 25 45-44 73 69 54-55 62 38 48-41 39 25v89H0Z" fill="#617f69" />
                  <path d="M0 164h420v146H0z" fill="url(#field-grass)" />
                </g>
                <path d="M0 195c84-19 171-22 254-8 68 12 117 7 166-11v134H0Z" fill="url(#field-grass)" />
                <path d="M40 310c74-50 155-79 240-87 42-4 84-4 140 2" fill="none" stroke="#d5c795" strokeWidth="3" opacity=".7" />
                <path d="M254 220 330 310" fill="none" stroke="#e3d7a4" strokeWidth="2" opacity=".65" />
                <g opacity=".8" fill="#d8e1d0">
                  <path d="M0 145h420" stroke="#d8e1d0" strokeWidth="2" opacity=".45" />
                  <path d="M28 128v50m62-50v50m62-50v50m62-50v50m62-50v50m62-50v50m62-50v50" stroke="#d8e1d0" strokeWidth="1" opacity=".42" />
                </g>
                <g transform="translate(218 35)">
                  <ellipse cx="87" cy="246" rx="74" ry="13" fill="#173d3c" opacity=".35" />
                  <path d="m51 137-23 71 22 9 35-58 20 63 26-4-9-83Z" fill="#233b48" />
                  <path d="m52 197-19 50 12 5 34-42m29-9 3 46 15 2 14-51" fill="#e1d8c5" />
                  <path d="m46 244-14 8 3 7 26 3 4-6-9-12m68-1-1 12 5 7 24 1 2-7-15-12Z" fill="#202f39" />
                  <path d="m44 78 18-17 37 6 19 19-10 57-58-5-17-23Z" fill="url(#uniform)" stroke="#e8e9dd" strokeWidth="3" />
                  <path d="m50 82-20 9-22 48 14 8 34-35m66-16 24 9 19 41-15 7-29-29" fill="#d8dfd6" stroke="#f0eee2" strokeWidth="5" strokeLinejoin="round" />
                  <path d="m63 63 2-22 33-4 7 28-16 16Z" fill="#be8059" />
                  <path d="M57 42c-1-22 13-36 31-37 22-1 34 14 30 39l-8 21-18 9-25-12Z" fill="#d69a69" />
                  <path d="M57 42c-4-20 7-40 29-42 22-3 41 11 37 37l-13-8-8-11-14 13-26 3Z" fill="#182b39" />
                  <path d="M55 33c-6-5-12-3-13 4-1 9 5 16 13 15m69-17c8-4 13 0 12 8-1 8-6 12-13 12" fill="#c9875f" />
                  <path d="m61 97 18 4 7-4 9 6 18-5" fill="none" stroke="#48657a" strokeWidth="4" opacity=".7" />
                  <path d="m52 100 1 22 14 9 14-8-2-20m34-2-2 24-13 9-14-8 1-21" fill="#dce4de" />
                  <path d="m81 95 4 28m12-29-3 30" stroke="#456072" strokeWidth="2" opacity=".7" />
                  <path d="M108 90 138 60" stroke="#82562e" strokeWidth="7" strokeLinecap="round" />
                  <path d="m138 59 11-18" stroke="#dfaa57" strokeWidth="4" strokeLinecap="round" />
                  <circle cx="18" cy="139" r="8" fill="#f5e9c7" />
                </g>
                <g fill="#f4d58f" opacity=".8">
                  <circle cx="362" cy="91" r="2" /><circle cx="381" cy="117" r="1.5" />
                  <circle cx="202" cy="58" r="1.5" /><circle cx="171" cy="184" r="2" />
                </g>
              </svg>
              <figcaption className="athlete-moment__caption">The next big moment</figcaption>
            </figure>
            <aside className="prep-note" aria-label="Game-day preparation suggestion">
              <p className="prep-note__label">A little prep goes a long way</p>
              <p className="prep-note__copy">Pack the glove tonight, then arrive 20 minutes early to warm up.</p>
            </aside>
          </div>
        </div>

        <div className="prep-board__actions">
          <button
            className="event-open-button"
            type="button"
            onClick={() => setCardOpen(true)}
            ref={openButtonRef}
          >
            Open Event Card <span className="event-open-button__arrow" aria-hidden="true">↗</span>
          </button>
        </div>
      </section>

      {cardOpen && (
        <div
          className="event-dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setCardOpen(false);
              openButtonRef.current?.focus();
            }
          }}
        >
          <section className="event-dialog" role="dialog" aria-modal="true" aria-labelledby="event-dialog-title">
            <button
              className="event-dialog__close"
              type="button"
              ref={closeButtonRef}
              onClick={() => {
                setCardOpen(false);
                openButtonRef.current?.focus();
              }}
              aria-label="Close Event Card"
            >
              ×
            </button>
            <p className="event-dialog__label">Upcoming game · Event Card</p>
            <h2 className="event-dialog__title" id="event-dialog-title">Hornets vs Bears</h2>
            <p className="event-dialog__date">Oct 24, 2026 · 9:00 AM</p>
            <div className="event-dialog__divider" />
            <p className="event-dialog__prep">
              Pack the glove tonight, then arrive 20 minutes early to warm up.
            </p>
          </section>
        </div>
      )}
    </main>
  );
}

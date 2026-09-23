import { motion } from 'framer-motion';
import { Phone, TopBar, TapCue, DotField, MiniHeader } from './shared';

export function Scene3() {
  return (
    <motion.div className="grain absolute inset-0 overflow-hidden bg-bg-muted" initial={{ opacity: 0, clipPath: 'polygon(0 100%, 100% 100%, 100% 100%, 0 100%)' }} animate={{ opacity: 1, clipPath: 'polygon(0 0, 100% 0, 100% 100%, 0 100%)' }} exit={{ opacity: 0, scale: .96, clipPath: 'circle(0% at 50% 45%)' }} transition={{ duration: .7, ease: [0.16, 1, .3, 1] }}>
      <DotField />
      <TopBar label="SCHEDULE / GAME" step="03 / 05" />
      <div className="absolute left-[7vw] top-[13vh] z-10">
        <div className="font-mono text-[1.35vh] font-bold uppercase tracking-[.24em] text-accent">KEEP SUPPORTERS CONNECTED</div>
        <h2 className="mt-[1vh] max-w-[76vw] font-display text-[7.3vh] uppercase leading-[.86] text-text-inverse">Share your<br /><span className="text-primary">event card.</span></h2>
      </div>
      <motion.div className="absolute left-[15vw] top-[28vh] z-10" initial={{ y: 90, opacity: 0, rotate: -3 }} animate={{ y: 0, opacity: 1, rotate: 0 }} transition={{ delay: .18, duration: .82, ease: [0.16, 1, .3, 1] }}>
        <Phone accent="var(--color-primary)">
          <div className="h-full bg-bg-light text-text-primary">
            <MiniHeader title="New game" eyebrow="EVENT CARD" />
            <div className="space-y-[1.15vh] px-[4vw] pt-[2vh]">
              {[
                ['DATE', 'Saturday, October 12'],
                ['TIME', '4:30 PM'],
                ['LOCATION', 'Central Field'],
                ['OPPONENT', 'Northside'],
              ].map(([label, value], index) => (
                <motion.div key={label} initial={{ x: -24, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: .3 + index * .12, duration: .35 }}>
                  <div className="mb-[.45vh] font-mono text-[1.1vh] font-bold uppercase tracking-[.16em] text-text-secondary">{label}</div>
                  <div className={`flex items-center justify-between rounded-[1.2vw] border px-[2vw] py-[1.15vh] text-[1.6vh] font-semibold ${index === 3 ? 'border-primary bg-primary/10 text-primary' : 'border-secondary/20 bg-white/70'}`}>{value}<span className="text-[1.7vh] text-text-secondary">⌄</span></div>
                </motion.div>
              ))}
              <div className="rounded-[1.2vw] bg-bg-dark px-[2vw] py-[1.35vh] text-center font-mono text-[1.3vh] font-bold uppercase tracking-[.15em] text-primary">Save game</div>
              <div className="pt-[.8vh] text-center font-mono text-[1.15vh] uppercase tracking-[.12em] text-text-secondary">snacks: Maya family · drinks: Jordan family</div>
            </div>
          </div>
        </Phone>
      </motion.div>
      <TapCue x="60vw" y="68vh" label="SAVE" />
    </motion.div>
  );
}
import { motion } from 'framer-motion';
import { Phone, TopBar, TapCue, DotField, MiniHeader } from './shared';

export function Scene2() {
  return (
    <motion.div className="grain absolute inset-0 overflow-hidden bg-bg-muted" initial={{ opacity: 0, x: '12%' }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, scale: 1.04, clipPath: 'polygon(0 0, 100% 0, 100% 0, 0 0)' }} transition={{ duration: .65, ease: [0.22, 1, .36, 1] }}>
      <DotField />
      <TopBar label="PLAN THE WEEK" step="02 / 05" />
      <div className="absolute left-[7vw] top-[13vh] z-10">
        <div className="font-mono text-[1.35vh] font-bold uppercase tracking-[.24em] text-primary">PLAN THE WEEK</div>
        <h2 className="mt-[1vh] max-w-[65vw] font-display text-[7.7vh] uppercase leading-[.88] text-bg-light">Plan the<br /><span className="text-accent">week.</span></h2>
      </div>
      <motion.div className="absolute left-[15vw] top-[28vh] z-10" initial={{ y: 80, rotate: 4, opacity: 0 }} animate={{ y: 0, rotate: 0, opacity: 1 }} transition={{ delay: .25, duration: .8, ease: [0.16, 1, .3, 1] }}>
        <Phone>
          <div className="h-full bg-bg-light text-text-primary">
            <MiniHeader title="Weekly Plan" />
            <div className="px-[4vw] pt-[2.3vh]">
              <div className="mb-[1.3vh] font-mono text-[1.2vh] font-bold uppercase tracking-[.14em] text-text-secondary">THIS WEEK</div>
              <div className="rounded-[1.5vw] border border-secondary/20 bg-white p-[2.2vw] shadow-[0_1vh_2vh_rgba(11,31,58,.08)]">
                <div className="flex items-start justify-between"><div><div className="font-mono text-[1.25vh] font-bold uppercase tracking-[.12em] text-accent">SAT · OCT 12</div><div className="mt-[.8vh] font-display text-[3.2vh] tracking-wide text-text-primary">Practice</div></div><span className="rounded-full bg-bg-light px-[1.5vw] py-[.6vh] font-mono text-[1.1vh] font-bold text-text-primary">10:00 AM</span></div>
                <div className="mt-[1.8vh] border-t border-secondary/10 pt-[1.5vh] text-[1.5vh] text-text-secondary">Eastside Field</div>
              </div>
              <motion.div className="mt-[1.5vh] rounded-[1.5vw] bg-bg-dark p-[2.2vw] text-text-inverse" initial={{ y: 16, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: .65, duration: .45 }}>
                <div className="flex items-center justify-between"><div className="font-mono text-[1.2vh] font-bold uppercase tracking-[.1em] text-primary">NEXT UP</div><span className="font-mono text-[1.1vh] text-text-secondary">SHARE</span></div>
                <div className="mt-[.6vh] font-display text-[3.5vh] tracking-wide text-text-inverse">Falcons vs Northside</div>
                <div className="mt-[1vh] text-[1.45vh] text-text-inverse/80">Central Field · 4:30 PM</div>
              </motion.div>
            </div>
          </div>
        </Phone>
      </motion.div>
      <TapCue x="64vw" y="56vh" label="OPEN" />
    </motion.div>
  );
}
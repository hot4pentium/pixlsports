import { motion } from 'framer-motion';
import { DotField, Logo, Phone, TopBar, TapCue } from './shared';

export function Scene5() {
  return (
    <motion.div className="grain absolute inset-0 overflow-hidden bg-[#0d1718] text-[#f5f4ee]" initial={{ opacity: 0, scale: 1.12, clipPath: 'circle(0% at 50% 50%)' }} animate={{ opacity: 1, scale: 1, clipPath: 'circle(100% at 50% 50%)' }} exit={{ opacity: 0, scale: 1.08, clipPath: 'circle(0% at 50% 50%)' }} transition={{ duration: .85, ease: [0.16, 1, .3, 1] }}>
      <DotField />
      <TopBar label="GAME DAY HUB" step="05 / 05" />
      <motion.div className="absolute left-[7vw] top-[15vh] z-10" initial={{ y: 35, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: .22, duration: .65 }}>
        <div className="font-mono text-[1.35vh] font-bold uppercase tracking-[.25em] text-[#44f18a]">EVERY DETAIL. ONE PLACE.</div>
        <h2 className="mt-[1.4vh] max-w-[80vw] font-display text-[9.2vh] uppercase leading-[.84]">Game day<br /><span className="text-[#44f18a]">ready.</span></h2>
      </motion.div>
      <motion.div className="absolute left-[16vw] top-[39vh] z-10" initial={{ y: 80, rotate: 5, opacity: 0 }} animate={{ y: 0, rotate: -2, opacity: 1 }} transition={{ delay: .35, duration: .9, ease: [0.16, 1, .3, 1] }}>
        <Phone accent="#44f18a">
          <div className="flex h-full flex-col items-center justify-center bg-[#f5f4ee] px-[4vw] text-center text-[#102021]">
            <div className="grid h-[10vh] w-[10vh] place-items-center rounded-full border-[.8vw] border-[#44f18a] bg-[#e7ffe9] text-[5vh] text-[#239a5e]">✓</div>
            <div className="mt-[2.3vh] font-mono text-[1.25vh] font-bold uppercase tracking-[.18em] text-[#46a96e]">GAME DAY CHECKLIST</div>
            <div className="mt-[.7vh] font-display text-[4.4vh] uppercase tracking-wide">6 of 6 ready</div>
            <div className="mt-[1.2vh] max-w-[45vw] text-[1.45vh] leading-[1.3] text-[#60746b]">Game day ready — every task is complete.</div>
            <div className="mt-[3vh] w-full rounded-[1vw] bg-[#102021] px-[2vw] py-[1.25vh] font-mono text-[1.2vh] font-bold uppercase tracking-[.14em] text-[#44f18a]">Falcons vs Northside</div>
          </div>
        </Phone>
      </motion.div>
      <motion.div className="absolute bottom-[11vh] left-[7vw] z-10 flex items-center gap-[2vw]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.05 }}>
        <Logo small />
        <div className="h-[3vh] w-[.25vw] bg-[#44f18a]/50" />
        <span className="font-mono text-[1.3vh] font-bold uppercase tracking-[.19em] text-[#b8ffcd]/65">Show up ready.</span>
      </motion.div>
      <TapCue x="64vw" y="54vh" label="DONE" />
    </motion.div>
  );
}
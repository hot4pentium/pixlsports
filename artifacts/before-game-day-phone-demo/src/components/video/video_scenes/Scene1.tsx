import { motion } from 'framer-motion';
import { DotField, Logo, TapCue } from './shared';

export function Scene1() {
  return (
    <motion.div
      className="grain absolute inset-0 overflow-hidden bg-[#0d1718] text-[#f5f4ee]"
      initial={{ opacity: 0, clipPath: 'circle(0% at 50% 55%)' }}
      animate={{ opacity: 1, clipPath: 'circle(100% at 50% 55%)' }}
      exit={{ opacity: 0, clipPath: 'circle(0% at 50% 55%)' }}
      transition={{ duration: .85, ease: [0.16, 1, .3, 1] }}
    >
      <DotField />
      <motion.div className="scanline pointer-events-none absolute inset-x-0 top-0 opacity-30" />
      <div className="absolute left-[7vw] top-[7vh]"><Logo /></div>
      <motion.div className="absolute left-[7vw] top-[29vh] w-[83vw]" initial={{ x: -35, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: .2, duration: .7 }}>
        <div className="font-mono text-[1.55vh] font-bold uppercase tracking-[.3em] text-[#44f18a]">BEFORE GAME DAY / 01</div>
        <h1 className="mt-[2.5vh] max-w-[80vw] font-display text-[12vh] uppercase leading-[.82] tracking-wide">
          Make the<br /><span className="text-[#44f18a]">next move.</span>
        </h1>
        <p className="mt-[3.2vh] max-w-[64vw] text-[2.2vh] leading-[1.3] text-[#b8ffcd]/70">A faster way to get every detail out of your head and onto the team’s game day.</p>
      </motion.div>
      <motion.div className="absolute bottom-[12vh] left-[7vw] flex items-center gap-[3vw] font-mono text-[1.35vh] uppercase tracking-[.18em] text-[#f5f4ee]/55" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: .9 }}>
        <span className="h-[.25vh] w-[14vw] bg-[#44f18a]" /> Create → Confirm → Ready
      </motion.div>
      <TapCue x="63vw" y="18vh" label="WATCH" />
    </motion.div>
  );
}
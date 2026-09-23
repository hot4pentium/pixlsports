import { motion } from 'framer-motion';
import { DotField, Logo, TapCue } from './shared';

export function Scene1() {
  return (
    <motion.div
      className="grain absolute inset-0 overflow-hidden bg-bg-dark text-text-inverse"
      initial={{ opacity: 0, clipPath: 'circle(0% at 50% 55%)' }}
      animate={{ opacity: 1, clipPath: 'circle(100% at 50% 55%)' }}
      exit={{ opacity: 0, clipPath: 'circle(0% at 50% 55%)' }}
      transition={{ duration: .85, ease: [0.16, 1, .3, 1] }}
    >
      <DotField />
      <motion.div className="scanline pointer-events-none absolute inset-x-0 top-0 opacity-30" />
      <div className="absolute left-[7vw] top-[7vh]"><Logo /></div>
      <motion.div className="absolute left-[7vw] top-[29vh] w-[83vw]" initial={{ x: -35, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: .2, duration: .7 }}>
        <div className="font-mono text-[1.55vh] font-bold uppercase tracking-[.25em] text-accent">YOUR SEASON, GUIDED</div>
        <h1 className="mt-[2.5vh] max-w-[80vw] font-display text-[10vh] uppercase leading-[.82] tracking-wide">
          One place for<br /><span className="text-primary">the whole season.</span>
        </h1>
        <p className="mt-[3.2vh] max-w-[70vw] text-[2.2vh] leading-[1.3] text-text-muted">Plan each week, follow game day, and keep the moments worth sharing.</p>
      </motion.div>
      <motion.div className="absolute bottom-[12vh] left-[7vw] flex items-center gap-[3vw] font-mono text-[1.35vh] uppercase tracking-[.18em] text-text-inverse/55" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: .9 }}>
        <span className="h-[.25vh] w-[14vw] bg-primary" /> Plan → Follow → Share
      </motion.div>
      <TapCue x="63vw" y="18vh" label="WATCH" />
    </motion.div>
  );
}
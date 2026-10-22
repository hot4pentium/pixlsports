import { motion } from 'framer-motion';
import { Phone, TopBar, DotField } from './shared';

export function Scene3() {
  return (
    <motion.div className="grain absolute inset-0 overflow-hidden bg-bg-muted" initial={{ opacity: 0, clipPath: 'polygon(0 100%, 100% 100%, 100% 100%, 0 100%)' }} animate={{ opacity: 1, clipPath: 'polygon(0 0, 100% 0, 100% 100%, 0 100%)' }} exit={{ opacity: 0, scale: .96, clipPath: 'circle(0% at 50% 45%)' }} transition={{ duration: .7, ease: [0.16, 1, .3, 1] }}>
      <DotField />
      <TopBar label="EVENT CARD" step="03 / 05" />
      <motion.div className="absolute left-1/2 top-[21vh] z-10 -translate-x-1/2" initial={{ y: 90, opacity: 0, rotate: -3 }} animate={{ y: 0, opacity: 1, rotate: 0 }} transition={{ delay: .18, duration: .82, ease: [0.16, 1, .3, 1] }}>
        <Phone accent="var(--color-primary)" className="!h-[58vh]">
          <div className="flex h-full flex-col items-center bg-primary px-[2.6vw] pb-[4vh] pt-[5.3vh] text-text-primary">
            <motion.div
              className="h-[34vh] w-full shrink-0 rounded-[2.2vw] border border-secondary/15 bg-white px-[3.4vw] pb-[2.3vh] pt-[2.5vh] shadow-[0_1.2vh_2.2vh_rgba(11,31,58,.16)]"
              initial={{ scaleY: .72, opacity: 0 }}
              animate={{ scaleY: 1, opacity: 1 }}
              transition={{ delay: .42, duration: .58, ease: [0.16, 1, .3, 1] }}
              style={{ transformOrigin: 'top center' }}
            >
              <div className="flex items-center justify-between">
                <span className="font-display text-[1.65vh] font-extrabold uppercase tracking-[.03em]">PIXL SPORTS</span>
                <span className="font-mono text-[1.2vh] font-bold uppercase tracking-[.12em] text-primary">EVENT CARD</span>
              </div>
              <div className="mt-[1.7vh] h-px w-full bg-secondary/20" />
              <motion.div className="mt-[2.8vh]" initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: .78, duration: .4 }}>
                <div className="font-mono text-[1.3vh] font-bold uppercase tracking-[.14em] text-primary">UPCOMING GAME</div>
                <div className="mt-[.65vh] font-display text-[4.2vh] font-bold leading-[.9] tracking-[-.02em]">Hornets vs Bears</div>
                <div className="mt-[1vh] h-[.22vh] w-full bg-secondary" />
              </motion.div>
              <motion.div className="mt-[1.4vh]" initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 1.05, duration: .38 }}>
                <div className="font-mono text-[1.25vh] font-bold uppercase tracking-[.14em] text-primary">DATE &amp; TIME</div>
                <div className="mt-[.6vh] text-[1.9vh] font-bold leading-[1.1]">Oct 24, 2026 · 9:00 AM</div>
              </motion.div>
            </motion.div>
            <motion.div
              className="mt-[1.8vh] flex w-full items-center justify-between rounded-[1.8vw] bg-accent px-[3.2vw] py-[2.15vh] font-mono text-[1.35vh] font-bold uppercase tracking-[.12em] text-text-inverse shadow-[0_.7vh_1.2vh_rgba(11,31,58,.16)]"
              initial={{ y: 15, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 1.35, duration: .4 }}
              aria-label="Open event card"
            >
              <span>OPEN EVENT CARD</span>
              <motion.span
                className="text-[2.7vh] leading-none"
                animate={{ x: [0, 5, 0] }}
                transition={{ duration: 1.2, repeat: Infinity, repeatDelay: .8 }}
              >
                →
              </motion.span>
            </motion.div>
          </div>
        </Phone>
      </motion.div>
    </motion.div>
  );
}
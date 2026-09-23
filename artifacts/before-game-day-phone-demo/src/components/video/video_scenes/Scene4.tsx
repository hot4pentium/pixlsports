import { motion } from 'framer-motion';
import { Phone, TopBar, TapCue, DotField } from './shared';

const items = ['Pack the uniform and game shoes', 'Pack equipment and team bag', 'Bring water and a quick snack', 'Confirm arrival time and location', 'Check the lineup and player availability', 'Review the game schedule and field or court'];

export function Scene4() {
  return (
    <motion.div className="grain absolute inset-0 overflow-hidden bg-bg-dark" initial={{ opacity: 0, x: '-10%', clipPath: 'inset(0 100% 0 0)' }} animate={{ opacity: 1, x: 0, clipPath: 'inset(0 0% 0 0)' }} exit={{ opacity: 0, x: '8%', clipPath: 'inset(0 0 0 100%)' }} transition={{ duration: .72, ease: [0.16, 1, .3, 1] }}>
      <DotField />
      <TopBar label="GAME DAY HUB" step="04 / 05" />
      <div className="absolute left-[7vw] top-[13vh] z-10">
        <div className="font-mono text-[1.35vh] font-bold uppercase tracking-[.24em] text-primary">GAME DAY HUB</div>
        <h2 className="mt-[1vh] max-w-[82vw] font-display text-[7.2vh] uppercase leading-[.86] text-text-inverse">Prepare with<br /><span className="text-accent">the checklist.</span></h2>
      </div>
      <motion.div
        className="absolute right-[-14vw] top-[24vh] z-0 h-[30vh] w-[47vw] rotate-[8deg] overflow-hidden rounded-[1.5vw] border border-primary/20 bg-bg-light/10 opacity-45 shadow-2xl"
        initial={{ x: 50, opacity: 0 }}
        animate={{ x: 0, opacity: .45 }}
        transition={{ delay: .1, duration: .9 }}
      >
        <img
          src={`${import.meta.env.BASE_URL}assets/game-day-checklist.webp`}
          alt="Pixl Sports gameday checklist reference"
          className="h-full w-full object-cover object-top"
        />
      </motion.div>
      <motion.div className="absolute left-[15vw] top-[28vh] z-10" initial={{ y: 110, opacity: 0, scale: .96 }} animate={{ y: 0, opacity: 1, scale: 1 }} transition={{ delay: .12, duration: .82, ease: [0.16, 1, .3, 1] }}>
        <Phone>
          <div className="h-full bg-bg-light text-text-primary">
            <div className="border-b border-secondary/20 px-[4vw] pb-[1.5vh] pt-[6.5vh]">
              <div className="flex items-center justify-between"><div><div className="font-mono text-[1.1vh] font-bold uppercase tracking-[.15em] text-primary">GAME DAY</div><div className="font-display text-[3.7vh] tracking-wide">Checklist</div></div><div className="rounded-[1vw] bg-accent px-[1.8vw] py-[.8vh] font-mono text-[1.1vh] font-bold uppercase text-text-inverse">Reset</div></div>
              <div className="mt-[1.3vh] rounded-[1vw] border border-secondary/20 bg-white px-[2vw] py-[.8vh] text-[1.25vh] font-semibold">Falcons vs Northside <span className="float-right text-text-secondary">⌄</span></div>
            </div>
            <div className="px-[3vw] pt-[1.8vh]">
              <div className="mb-[1vh] font-mono text-[1.1vh] font-bold uppercase tracking-[.16em] text-text-secondary">BEFORE LEAVING</div>
              {items.slice(0, 3).map((item, index) => (
                <motion.div key={item} className="mb-[.8vh] flex items-center gap-[1.7vw] rounded-[1vw] border border-secondary/10 bg-white px-[1.4vw] py-[1.2vh] shadow-[0_.5vh_1vh_rgba(11,31,58,.06)]" initial={{ x: 35, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: .28 + index * .12, duration: .35 }}>
                  <div className="relative h-[3.7vh] w-[3.7vh] shrink-0 rounded-[.6vw] border border-secondary/20 bg-bg-light overflow-hidden">
                    <motion.div className="absolute inset-0 flex items-center justify-center bg-accent text-[2vh] text-text-inverse" initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: .8 + index * .15, type: 'spring', stiffness: 400, damping: 25 }}>✓</motion.div>
                  </div>
                  <span className="text-[1.3vh] font-bold leading-[1.1]">{item}</span>
                </motion.div>
              ))}
              <div className="mb-[1vh] mt-[1.5vh] font-mono text-[1.1vh] font-bold uppercase tracking-[.16em] text-text-secondary">TEAM DETAILS</div>
              {items.slice(3, 6).map((item, index) => (
                <motion.div key={item} className="mb-[.8vh] flex items-center gap-[1.7vw] rounded-[1vw] border border-secondary/10 bg-white px-[1.4vw] py-[1.2vh] shadow-[0_.5vh_1vh_rgba(11,31,58,.06)]" initial={{ x: 35, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: .68 + index * .12, duration: .35 }}>
                  <div className="relative h-[3.7vh] w-[3.7vh] shrink-0 rounded-[.6vw] border border-secondary/20 bg-bg-light overflow-hidden">
                    <motion.div className="absolute inset-0 flex items-center justify-center bg-accent text-[2vh] text-text-inverse" initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 1.2 + index * .15, type: 'spring', stiffness: 400, damping: 25 }}>✓</motion.div>
                  </div>
                  <span className="text-[1.3vh] font-bold leading-[1.1]">{item}</span>
                </motion.div>
              ))}
            </div>
          </div>
        </Phone>
      </motion.div>
      <TapCue x="31vw" y="49vh" label="CHECK" />
      <TapCue x="54vw" y="74vh" label="CHECK" />
    </motion.div>
  );
}
import { motion } from 'framer-motion';
import { Phone, TopBar, TapCue, DotField, MiniHeader } from './shared';

export function Scene2() {
  return (
    <motion.div className="grain absolute inset-0 overflow-hidden bg-[#132326]" initial={{ opacity: 0, x: '12%' }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, scale: 1.04, clipPath: 'polygon(0 0, 100% 0, 100% 0, 0 0)' }} transition={{ duration: .65, ease: [0.22, 1, .36, 1] }}>
      <DotField />
      <TopBar label="TEAM COMMAND" step="02 / 05" />
      <div className="absolute left-[7vw] top-[13vh] z-10">
        <div className="font-mono text-[1.35vh] font-bold uppercase tracking-[.24em] text-[#44f18a]">SET THE WEEK</div>
        <h2 className="mt-[1vh] max-w-[57vw] font-display text-[7.7vh] uppercase leading-[.88] text-[#f5f4ee]">Start with<br /><span className="text-[#44f18a]">the event.</span></h2>
      </div>
      <motion.div className="absolute left-[15vw] top-[28vh] z-10" initial={{ y: 80, rotate: 4, opacity: 0 }} animate={{ y: 0, rotate: 0, opacity: 1 }} transition={{ delay: .25, duration: .8, ease: [0.16, 1, .3, 1] }}>
        <Phone>
          <div className="h-full bg-[#f5f4ee] text-[#102021]">
            <MiniHeader title="Schedule" />
            <div className="px-[4vw] pt-[2.3vh]">
              <div className="mb-[1.3vh] font-mono text-[1.2vh] font-bold uppercase tracking-[.14em] text-[#6a7f78]">THIS WEEK</div>
              <div className="rounded-[1.5vw] border border-[#d6ded6] bg-[#fffef8] p-[2.2vw] shadow-[0_1vh_2vh_rgba(16,32,33,.08)]">
                <div className="flex items-start justify-between"><div><div className="font-mono text-[1.25vh] font-bold uppercase tracking-[.12em] text-[#46a96e]">SAT · OCT 12</div><div className="mt-[.8vh] font-display text-[3.2vh] tracking-wide">Practice</div></div><span className="rounded-full bg-[#e9eee8] px-[1.5vw] py-[.6vh] font-mono text-[1.1vh] font-bold text-[#567168]">10:00 AM</span></div>
                <div className="mt-[1.8vh] border-t border-[#e5ebe3] pt-[1.5vh] text-[1.5vh] text-[#61746c]">Eastside Field</div>
              </div>
              <motion.div className="mt-[1.5vh] rounded-[1.5vw] bg-[#102021] p-[2.2vw] text-[#f5f4ee]" initial={{ y: 16, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: .65, duration: .45 }}>
                <div className="flex items-center justify-between"><div className="font-mono text-[1.2vh] font-bold uppercase tracking-[.1em] text-[#44f18a]">NEXT UP</div><span className="font-mono text-[1.1vh] text-[#b8ffcd]/60">EDIT</span></div>
                <div className="mt-[.6vh] font-display text-[3.5vh] tracking-wide">Falcons vs Northside</div>
                <div className="mt-[1vh] text-[1.45vh] text-[#b8ffcd]/65">Central Field · 4:30 PM</div>
              </motion.div>
            </div>
          </div>
        </Phone>
      </motion.div>
      <TapCue x="64vw" y="56vh" label="OPEN" />
    </motion.div>
  );
}
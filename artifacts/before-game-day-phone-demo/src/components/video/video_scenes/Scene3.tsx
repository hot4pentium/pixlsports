import { motion } from 'framer-motion';
import { Phone, TopBar, TapCue, DotField, MiniHeader } from './shared';

export function Scene3() {
  return (
    <motion.div className="grain absolute inset-0 overflow-hidden bg-[#132326]" initial={{ opacity: 0, clipPath: 'polygon(0 100%, 100% 100%, 100% 100%, 0 100%)' }} animate={{ opacity: 1, clipPath: 'polygon(0 0, 100% 0, 100% 100%, 0 100%)' }} exit={{ opacity: 0, scale: .96, clipPath: 'circle(0% at 50% 45%)' }} transition={{ duration: .7, ease: [0.16, 1, .3, 1] }}>
      <DotField />
      <TopBar label="SCHEDULE / GAME" step="03 / 05" />
      <div className="absolute left-[7vw] top-[13vh] z-10">
        <div className="font-mono text-[1.35vh] font-bold uppercase tracking-[.24em] text-[#ffce62]">IMPORTANT DETAILS</div>
        <h2 className="mt-[1vh] max-w-[76vw] font-display text-[7.3vh] uppercase leading-[.86] text-[#f5f4ee]">Make it<br /><span className="text-[#ffce62]">specific.</span></h2>
      </div>
      <motion.div className="absolute left-[15vw] top-[28vh] z-10" initial={{ y: 90, opacity: 0, rotate: -3 }} animate={{ y: 0, opacity: 1, rotate: 0 }} transition={{ delay: .18, duration: .82, ease: [0.16, 1, .3, 1] }}>
        <Phone accent="#ffce62">
          <div className="h-full bg-[#f5f4ee] text-[#102021]">
            <MiniHeader title="New game" eyebrow="SCHEDULE / CREATE" />
            <div className="space-y-[1.15vh] px-[4vw] pt-[2vh]">
              {[
                ['DATE', 'Saturday, October 12'],
                ['TIME', '4:30 PM'],
                ['LOCATION', 'Central Field'],
                ['OPPONENT', 'Northside'],
              ].map(([label, value], index) => (
                <motion.div key={label} initial={{ x: -24, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: .3 + index * .12, duration: .35 }}>
                  <div className="mb-[.45vh] font-mono text-[1.1vh] font-bold uppercase tracking-[.16em] text-[#6b8378]">{label}</div>
                  <div className={`flex items-center justify-between rounded-[1.2vw] border px-[2vw] py-[1.15vh] text-[1.6vh] font-semibold ${index === 3 ? 'border-[#44f18a] bg-[#edfff1]' : 'border-[#d5ded6] bg-white/70'}`}>{value}<span className="text-[1.7vh] text-[#6b7f77]">⌄</span></div>
                </motion.div>
              ))}
              <div className="rounded-[1.2vw] bg-[#102021] px-[2vw] py-[1.35vh] text-center font-mono text-[1.3vh] font-bold uppercase tracking-[.15em] text-[#44f18a]">Save game</div>
              <div className="pt-[.8vh] text-center font-mono text-[1.15vh] uppercase tracking-[.12em] text-[#80928b]">snacks: Maya family · drinks: Jordan family</div>
            </div>
          </div>
        </Phone>
      </motion.div>
      <TapCue x="60vw" y="68vh" label="SAVE" />
    </motion.div>
  );
}
import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { SafeFrame, VideoText } from '@/lib/video/layout';
import { CheckSquare, Square } from 'lucide-react';

export const Scene1: React.FC = () => {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 1000),
      setTimeout(() => setPhase(2), 2000),
      setTimeout(() => setPhase(3), 3000),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.8 }}
      className="absolute inset-0 flex items-center z-10 pl-[30vw]"
    >
      <SafeFrame className="flex items-center w-full justify-center">
        
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 50, rotateX: -20 }}
          animate={{ opacity: 1, scale: 1, y: 0, rotateX: 0 }}
          exit={{ opacity: 0, scale: 1.1, y: -50, filter: 'blur(10px)' }}
          transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
          className="w-[45vw] bg-bg-muted/80 backdrop-blur-xl border border-amber-300/30 rounded-2xl shadow-[0_0_40px_rgba(252,211,77,0.15)] p-8 flex flex-col relative overflow-hidden"
        >
          <div className="flex flex-col mb-8">
            <span className="text-amber-300 font-bold uppercase tracking-widest text-sm mb-1">Preparation</span>
            <VideoText scale="heading" className="font-extrabold text-white">Game Day Checklist</VideoText>
          </div>

          <div className="space-y-4">
            <ChecklistItem text="Pack the uniform and game shoes" checked={phase >= 1} delay={0.2} />
            <ChecklistItem text="Pack equipment and team bag" checked={phase >= 2} delay={0.4} />
            <ChecklistItem text="Bring water and a quick snack" checked={phase >= 3} delay={0.6} />
          </div>

        </motion.div>

      </SafeFrame>
    </motion.div>
  );
};

const ChecklistItem = ({ text, checked, delay }: { text: string, checked: boolean, delay: number }) => (
  <motion.div 
    initial={{ opacity: 0, x: 20 }}
    animate={{ opacity: 1, x: 0 }}
    transition={{ duration: 0.6, delay, ease: [0.16, 1, 0.3, 1] }}
    className={`flex items-center gap-4 p-4 rounded-xl border transition-colors duration-500 ${checked ? 'bg-amber-300/10 border-amber-300/40' : 'bg-white/5 border-white/10'}`}
  >
    <div className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors duration-500 ${checked ? 'bg-amber-300 text-bg-dark' : 'bg-white/10 text-white/40'}`}>
      {checked ? <CheckSquare size={20} strokeWidth={3} /> : <Square size={20} strokeWidth={2} />}
    </div>
    <VideoText scale="body" className={`font-bold transition-colors duration-500 ${checked ? 'text-white' : 'text-white/60'}`}>
      {text}
    </VideoText>
  </motion.div>
);

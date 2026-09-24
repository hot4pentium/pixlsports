import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { SafeFrame, VideoText } from '@/lib/video/layout';
import { Camera, Video } from 'lucide-react';

export const Scene2: React.FC = () => {
  const [score, setScore] = useState(1);

  useEffect(() => {
    const timer = setTimeout(() => {
      setScore(2);
    }, 2000);
    return () => clearTimeout(timer);
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
          initial={{ opacity: 0, scale: 0.9, y: 50, rotateX: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0, rotateX: 0 }}
          exit={{ opacity: 0, scale: 1.1, y: -50, filter: 'blur(10px)' }}
          transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
          className="w-[50vw] bg-[#0B1F3A] border border-primary/40 border-t-2 border-t-emerald-400 rounded-lg shadow-[0_0_50px_rgba(110,231,183,0.15)] p-6 relative overflow-hidden"
          style={{ clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%)' }}
        >
          {/* Header Row */}
          <div className="flex items-center justify-between pr-40">
            <span className="inline-flex items-center gap-2 bg-emerald-500 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-white">
              <span className="h-2 w-2 animate-pulse bg-white rounded-full" /> Live
            </span>
            <span className="text-right text-xs font-bold uppercase tracking-widest text-white/60">Oct 14, 2023</span>
          </div>

          <p className="mt-6 text-xs font-bold uppercase tracking-widest text-white/60">
            Athlete vs Tigers
          </p>

          {/* Scores Row */}
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="border border-white/10 bg-white/5 p-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-white/60">Athlete</p>
              <motion.p 
                key={score}
                initial={{ opacity: 0, y: -10, scale: 1.2 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                className="mt-1 font-display text-5xl leading-none text-emerald-400"
              >
                {score}
              </motion.p>
            </div>

            <div className="border border-white/10 bg-white/5 p-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-white/60">Tigers</p>
              <p className="mt-1 font-display text-5xl leading-none text-white">0</p>
            </div>
          </div>

          {/* Footer Row */}
          <div className="mt-4 flex items-center justify-between gap-4">
            <span className="text-[10px] font-bold uppercase tracking-widest text-white/45">Manual score adjustment</span>
            <span className="font-display text-xl uppercase tracking-wide text-white/80">2nd Half</span>
          </div>

          {/* Actions */}
          <div className="mt-6 flex gap-2">
            <div className="border border-white/20 px-4 py-3 text-xs font-bold uppercase tracking-widest text-white">Pause</div>
            <div className="border border-white/20 px-4 py-3 text-xs font-bold uppercase tracking-widest text-white">Next Half</div>
          </div>

          {/* Floating Capture Controls */}
          <div className="absolute right-5 top-5 flex items-center gap-1.5">
            <div className="inline-flex min-h-10 items-center gap-1.5 border border-white/20 bg-white/5 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-white/75">
              <Camera className="h-3.5 w-3.5" /> <span>Photo</span>
            </div>
            <div className="inline-flex min-h-10 items-center gap-1.5 border border-white/20 bg-white/5 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-white/75">
              <Video className="h-3.5 w-3.5" /> <span>Video</span>
            </div>
          </div>

        </motion.div>
      </SafeFrame>
    </motion.div>
  );
};

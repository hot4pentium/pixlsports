import React from 'react';
import { motion } from 'framer-motion';
import { SafeFrame, VideoText } from '@/lib/video/layout';
import { Star, Share2, Play } from 'lucide-react';

export const Scene3: React.FC = () => {
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
          initial={{ opacity: 0, scale: 0.9, y: 50, rotateY: -10 }}
          animate={{ opacity: 1, scale: 1, y: 0, rotateY: 0 }}
          exit={{ opacity: 0, scale: 1.1, y: -50, filter: 'blur(10px)' }}
          transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
          className="w-[58vw] bg-white rounded-2xl shadow-[0_0_50px_rgba(240,171,252,0.2)] overflow-hidden flex flex-col relative text-bg-dark border border-gray-200"
        >
          {/* Header */}
          <div className="h-14 border-b border-gray-100 flex items-center px-6 justify-between bg-white z-10 relative">
             <img src={`${import.meta.env.BASE_URL}images/pixlsports-logo.png`} alt="Logo" className="h-5 object-contain filter invert" />
             <div className="w-8 h-8 rounded-full bg-gray-100 border border-gray-200" />
          </div>

          {/* Content */}
          <div className="p-8 flex gap-8 bg-slate-50 flex-1">
            {/* Left col: Title and Stats */}
            <div className="flex-1 flex flex-col justify-center">
               <span className="text-fuchsia-600 font-bold uppercase tracking-widest text-xs mb-2">Athlete Hype Page</span>
               <VideoText scale="heading" className="font-extrabold text-bg-dark mb-6 leading-[0.9]">
                 ALEX<br/>JOHNSON
               </VideoText>
               
               <div className="space-y-4 mb-8">
                  <div className="flex items-end justify-between border-b border-gray-200 pb-2">
                     <span className="text-gray-500 font-bold text-[10px] uppercase tracking-widest">Goals</span>
                     <span className="font-display font-bold text-3xl leading-none">1</span>
                  </div>
                  <div className="flex items-end justify-between border-b border-gray-200 pb-2">
                     <span className="text-gray-500 font-bold text-[10px] uppercase tracking-widest">Assists</span>
                     <span className="font-display font-bold text-3xl leading-none">1</span>
                  </div>
               </div>
               
               <motion.div 
                 initial={{ scale: 0.95 }}
                 animate={{ scale: 1 }}
                 transition={{ duration: 1, repeat: Infinity, repeatType: "reverse" }}
                 className="bg-fuchsia-600 text-white rounded-lg py-3 px-4 flex items-center justify-center gap-2 font-bold uppercase tracking-widest text-xs shadow-lg shadow-fuchsia-500/30"
               >
                  <Share2 size={16} /> Share Hype Page
               </motion.div>
            </div>
            
            {/* Right col: Media */}
            <motion.div 
               initial={{ opacity: 0, x: 20 }}
               animate={{ opacity: 1, x: 0 }}
               transition={{ duration: 0.8, delay: 0.5 }}
               className="w-[24vw] h-[28vw] rounded-xl overflow-hidden relative shadow-xl border-4 border-white"
            >
               <div className="absolute inset-0 bg-player-hype bg-cover bg-center scale-105"></div>
               <div className="absolute inset-0 bg-gradient-to-t from-bg-dark/80 via-transparent to-transparent flex items-end p-5">
                 <div className="w-12 h-12 bg-fuchsia-500 rounded-full flex items-center justify-center border-2 border-white shadow-lg">
                    <Play className="text-white fill-white w-5 h-5 ml-1" />
                 </div>
               </div>
            </motion.div>
          </div>

        </motion.div>

      </SafeFrame>
    </motion.div>
  );
};

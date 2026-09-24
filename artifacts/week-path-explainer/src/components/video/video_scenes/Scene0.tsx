import React from 'react';
import { motion } from 'framer-motion';
import { SafeFrame, VideoText } from '@/lib/video/layout';
import { Calendar, MapPin, Clock } from 'lucide-react';

export const Scene0: React.FC = () => {
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
          initial={{ opacity: 0, scale: 0.9, y: 50, rotateX: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0, rotateX: 0 }}
          exit={{ opacity: 0, scale: 1.1, y: -50, filter: 'blur(10px)' }}
          transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
          className="w-[45vw] bg-bg-muted/80 backdrop-blur-xl border border-sky-300/30 rounded-2xl shadow-[0_0_40px_rgba(125,211,252,0.15)] p-8 flex flex-col relative overflow-hidden transform perspective-[1000px]"
        >
          {/* Calendar Card Mockup */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex flex-col">
              <span className="text-sky-300 font-bold uppercase tracking-widest text-sm mb-1">Upcoming Event</span>
              <VideoText scale="heading" className="font-extrabold text-white">Championship Final</VideoText>
            </div>
            <div className="w-16 h-16 bg-sky-300/20 rounded-xl flex items-center justify-center border border-sky-300/40">
              <Calendar className="text-sky-300 w-8 h-8" />
            </div>
          </div>
          
          <div className="space-y-4">
            <div className="flex items-center gap-4 bg-white/5 p-4 rounded-xl border border-white/10">
              <Clock className="text-white/50 w-6 h-6" />
              <VideoText scale="body" className="font-bold text-white/80">Saturday, 7:00 PM</VideoText>
            </div>
            <div className="flex items-center gap-4 bg-white/5 p-4 rounded-xl border border-white/10">
              <MapPin className="text-white/50 w-6 h-6" />
              <VideoText scale="body" className="font-bold text-white/80">Memorial Stadium</VideoText>
            </div>
          </div>
          
          <motion.div 
            initial={{ width: 0 }}
            animate={{ width: "100%" }}
            transition={{ duration: 1.5, delay: 0.5, ease: "easeOut" }}
            className="h-1 bg-sky-300 mt-8 rounded-full shadow-[0_0_10px_rgba(125,211,252,0.8)]"
          />
        </motion.div>

      </SafeFrame>
    </motion.div>
  );
};

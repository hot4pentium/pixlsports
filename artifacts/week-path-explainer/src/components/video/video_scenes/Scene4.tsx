import React from 'react';
import { motion } from 'framer-motion';
import { SafeFrame, VideoText } from '@/lib/video/layout';

export const Scene4: React.FC = () => {
  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.8 }}
      className="absolute inset-0 flex items-center justify-center z-10 bg-bg-dark"
    >
      <SafeFrame className="flex flex-col items-center justify-center">
        
        {/* Logo Reveal */}
        <motion.div
          initial={{ opacity: 0, scale: 0.8, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 1.1, filter: 'blur(10px)' }}
          transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
          className="mb-8"
        >
          <img 
            src={`${import.meta.env.BASE_URL}images/pixlsports-logo.png`} 
            alt="Pixl Sports" 
            className="w-[25vw] h-auto object-contain drop-shadow-2xl"
          />
        </motion.div>

        {/* CTA Reveal */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.8, delay: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="mt-4 text-center"
        >
          <VideoText scale="heading" className="font-bold text-white tracking-wide">
            START YOUR SEASON
          </VideoText>
          <div className="w-12 h-1 bg-primary mx-auto mt-4 rounded-full"></div>
        </motion.div>

      </SafeFrame>
    </motion.div>
  );
};

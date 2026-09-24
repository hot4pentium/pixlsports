import React from 'react';
import { motion } from 'framer-motion';

export const PersistentBackground: React.FC<{ currentScene: number }> = ({ currentScene }) => {
  // Background logic:
  // Scene 0 (Plan): Dark stadium bg + sky overlay
  // Scene 1 (Prep): Abstract nodes + amber overlay
  // Scene 2 (Capture): Stadium bg + emerald overlay
  // Scene 3 (Send): Hype bg + fuchsia overlay
  // Scene 4 (Outro): Deep navy

  const bgVariants = {
    scene0: { opacity: 0.8, scale: 1.0, filter: 'blur(0px)' },
    scene1: { opacity: 0.3, scale: 1.05, filter: 'blur(10px)' },
    scene2: { opacity: 0.8, scale: 1.0, filter: 'blur(5px)' },
    scene3: { opacity: 0, scale: 1.1, filter: 'blur(10px)' },
    scene4: { opacity: 0.5, scale: 1.05, filter: 'blur(10px)' },
  };

  const abstractVariants = {
    scene0: { opacity: 0, scale: 1.1 },
    scene1: { opacity: 0.7, scale: 1.0 },
    scene2: { opacity: 0, scale: 1.05 },
    scene3: { opacity: 0, scale: 1.1 },
    scene4: { opacity: 0, scale: 1.1 },
  };

  const hypeVariants = {
    scene0: { opacity: 0, scale: 1.1 },
    scene1: { opacity: 0, scale: 1.1 },
    scene2: { opacity: 0, scale: 1.1 },
    scene3: { opacity: 0.6, scale: 1.0 },
    scene4: { opacity: 0, scale: 1.1 },
  };

  const overlayColor = {
    scene0: 'rgba(14, 165, 233, 0.15)', // sky
    scene1: 'rgba(245, 158, 11, 0.1)',  // amber
    scene2: 'rgba(16, 185, 129, 0.15)', // emerald
    scene3: 'rgba(217, 70, 239, 0.15)', // fuchsia
    scene4: 'rgba(10, 20, 40, 0.9)',    // navy
  };

  const orbColor = {
    scene0: '#7dd3fc',
    scene1: '#fcd34d',
    scene2: '#6ee7b7',
    scene3: '#f0abfc',
    scene4: '#2878F5',
  };

  return (
    <div className="absolute inset-0 overflow-hidden bg-bg-dark z-0">
      {/* Stadium Layer */}
      <motion.img
        src={`${import.meta.env.BASE_URL}images/stadium_lights.jpg`}
        className="absolute inset-0 w-full h-full object-cover"
        initial="scene0"
        animate={`scene${currentScene}`}
        variants={bgVariants}
        transition={{ duration: 2, ease: [0.16, 1, 0.3, 1] }}
      />

      {/* Abstract Data Layer */}
      <motion.img
        src={`${import.meta.env.BASE_URL}images/abstract_data.jpg`}
        className="absolute inset-0 w-full h-full object-cover mix-blend-screen"
        initial="scene0"
        animate={`scene${currentScene}`}
        variants={abstractVariants}
        transition={{ duration: 1.5, ease: 'easeInOut' }}
      />

      {/* Hype Layer */}
      <motion.img
        src={`${import.meta.env.BASE_URL}images/player_hype.jpg`}
        className="absolute inset-0 w-full h-full object-cover mix-blend-screen"
        initial="scene0"
        animate={`scene${currentScene}`}
        variants={hypeVariants}
        transition={{ duration: 1.5, ease: 'easeInOut' }}
      />

      {/* Color Tint Overlay */}
      <motion.div
        className="absolute inset-0"
        initial={false}
        animate={{ backgroundColor: overlayColor[`scene${currentScene}` as keyof typeof overlayColor] }}
        transition={{ duration: 1.2, ease: 'easeInOut' }}
      />

      {/* Persistent Grid Pattern */}
      <motion.div
        className="absolute inset-0 bg-grid-pattern opacity-[0.07]"
        animate={{
          backgroundPosition: [`0px 0px`, `40px 40px`],
        }}
        transition={{ duration: 8, ease: "linear", repeat: Infinity }}
      />

      {/* Accent Glowing Orb */}
      <motion.div
        className="absolute w-[80vw] h-[80vw] rounded-full blur-[100px] pointer-events-none mix-blend-screen"
        animate={{
          x: currentScene === 4 ? '10vw' : '40vw',
          y: currentScene === 4 ? '-40vh' : '0vh',
          backgroundColor: orbColor[`scene${currentScene}` as keyof typeof orbColor],
          opacity: currentScene === 4 ? 0.3 : 0.4,
          scale: 1,
        }}
        transition={{ duration: 2.5, ease: [0.16, 1, 0.3, 1] }}
        style={{ top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }}
      />
    </div>
  );
};

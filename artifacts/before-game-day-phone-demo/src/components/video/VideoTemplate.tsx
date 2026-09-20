// Video Template - Replace ReplitLoadingScene with your scenes

import { VideoCanvas, type VideoAspectRatio, useVideoPlayer } from '@/lib/video';
import { AnimatePresence } from 'framer-motion';
import { motion } from 'framer-motion';
import { Scene1 } from './video_scenes/Scene1';
import { Scene2 } from './video_scenes/Scene2';
import { Scene3 } from './video_scenes/Scene3';
import { Scene4 } from './video_scenes/Scene4';
import { Scene5 } from './video_scenes/Scene5';

const SCENE_DURATIONS = {
  intro: 3200,
  schedule: 4300,
  details: 4300,
  checklist: 5000,
  ready: 4200,
};

const VIDEO_ASPECT_RATIO: VideoAspectRatio = '9:16';

export default function VideoTemplate() {
  const { currentScene } = useVideoPlayer({
    durations: SCENE_DURATIONS,
  });

  return (
    <VideoCanvas
      aspectRatio={VIDEO_ASPECT_RATIO}
      className="relative h-screen w-full overflow-hidden"
      style={{ backgroundColor: 'var(--color-bg-dark)' }}
    >
      <div className="pointer-events-none absolute inset-0 z-0 bg-[radial-gradient(circle_at_20%_20%,rgba(68,241,138,.12),transparent_28%),radial-gradient(circle_at_80%_78%,rgba(255,206,98,.08),transparent_25%)]" />
      <motion.div
        className="pointer-events-none absolute left-[-20vw] top-[15vh] z-0 h-[38vw] w-[38vw] rounded-full border border-[#44f18a]/15"
        animate={{ rotate: [0, 180, 360], scale: [1, 1.16, 1], x: ['0vw', '18vw', '0vw'] }}
        transition={{ duration: 18, repeat: Infinity, ease: 'linear' }}
      />
      <AnimatePresence mode="sync" initial={false}>
        {currentScene === 0 && <Scene1 key="intro" />}
        {currentScene === 1 && <Scene2 key="schedule" />}
        {currentScene === 2 && <Scene3 key="details" />}
        {currentScene === 3 && <Scene4 key="checklist" />}
        {currentScene === 4 && <Scene5 key="ready" />}
      </AnimatePresence>
    </VideoCanvas>
  );
}

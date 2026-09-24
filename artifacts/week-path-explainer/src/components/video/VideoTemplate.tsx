import { useEffect, useRef } from 'react';
import { AnimatePresence } from 'framer-motion';
import { VideoCanvas } from '@/lib/video/layout';
import { useVideoPlayer, VideoPausedContext } from '@/lib/video/hooks';

import { SCENE_DURATIONS } from './sceneMeta';
import { Scene0 } from './video_scenes/Scene0';
import { Scene1 } from './video_scenes/Scene1';
import { Scene2 } from './video_scenes/Scene2';
import { Scene3 } from './video_scenes/Scene3';
import { Scene4 } from './video_scenes/Scene4';
import { PersistentBackground } from './video_scenes/PersistentBackground';
import { WeekPathSpine } from './video_scenes/WeekPathSpine';

export const VIDEO_ASPECT_RATIO = "16:9";
export { SCENE_DURATIONS } from './sceneMeta';

const SCENES = [Scene0, Scene1, Scene2, Scene3, Scene4];
const SCENE_START_SEC = Object.fromEntries(
  Object.keys(SCENE_DURATIONS).map((key, index, keys) => [
    key, keys.slice(0, index).reduce((sum, previous) => sum + SCENE_DURATIONS[previous], 0) / 1000,
  ]),
);

export default function VideoTemplate({
  durations = SCENE_DURATIONS,
  loop = true,
  paused = false,
  muted = false,
  onSceneChange,
}: {
  durations?: Record<string, number>;
  loop?: boolean;
  paused?: boolean;
  muted?: boolean;
  onSceneChange?: (key: string) => void;
} = {}) {
  const { currentSceneKey } = useVideoPlayer({ durations, loop, paused });
  const audioRef = useRef<HTMLAudioElement>(null);
  const lastSceneRef = useRef<string | null>(null);
  const baseKey = currentSceneKey.replace(/_r[12]$/, '');
  const sceneIndex = Object.keys(SCENE_DURATIONS).indexOf(baseKey);
  const Scene = SCENES[sceneIndex];
  useEffect(() => { onSceneChange?.(currentSceneKey); }, [currentSceneKey, onSceneChange]);
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = 0.45;
    if (paused) { audio.pause(); return; }
    if (lastSceneRef.current !== currentSceneKey) {
      lastSceneRef.current = currentSceneKey;
      const start = SCENE_START_SEC[baseKey] ?? 0;
      if (Math.abs(audio.currentTime - start) > 0.18) audio.currentTime = start;
    }
    audio.play().catch(() => {});
  }, [currentSceneKey, baseKey, paused, muted]);

  return (
    <VideoPausedContext.Provider value={paused}>
    <VideoCanvas aspectRatio={VIDEO_ASPECT_RATIO}>
      {/* 1. Persistent Background Layer (Cross-scene continuity) */}
      <PersistentBackground currentScene={sceneIndex} />
      
      {/* Persistent Week Path Spine */}
      <WeekPathSpine currentScene={sceneIndex} />

      {/* 2. Scene-specific Foreground Layer */}
      <AnimatePresence mode="popLayout">
        {Scene && <Scene key={currentSceneKey} />}
      </AnimatePresence>
      <audio ref={audioRef} src={`${import.meta.env.BASE_URL}audio/bg_music.mp3`} preload="auto" autoPlay muted={muted} />
    </VideoCanvas>
    </VideoPausedContext.Provider>
  );
}
export const SCENE_DURATIONS: Record<string, number> = {
  scene0: 5000, // Plan
  scene1: 5000, // Prep
  scene2: 5000, // Capture
  scene3: 5000, // Send
  scene4: 4000  // Outro
};

export interface SceneDetails {
  title: string;
  filePath: string;
}

export const SCENE_DETAILS: Record<string, SceneDetails> = {
  scene0: { title: 'Plan', filePath: 'src/components/video/video_scenes/Scene0.tsx' },
  scene1: { title: 'Prep', filePath: 'src/components/video/video_scenes/Scene1.tsx' },
  scene2: { title: 'Capture', filePath: 'src/components/video/video_scenes/Scene2.tsx' },
  scene3: { title: 'Send', filePath: 'src/components/video/video_scenes/Scene3.tsx' },
  scene4: { title: 'Outro', filePath: 'src/components/video/video_scenes/Scene4.tsx' },
};
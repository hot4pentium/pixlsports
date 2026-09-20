// Optional scene metadata for Replit workspace integrations. When the
// workspace's scene controls are enabled for this project, a viewer's click on
// a scene segment scopes their next chat request to that scene's source file.
// Fill one entry per SCENE_DURATIONS key in VideoTemplate.tsx only when a
// skill reference asks for it; otherwise leave the map empty. Scenes missing
// from the map still play and can be jumped to.
//
// Example:
//   export const SCENE_DETAILS: Record<string, SceneDetails> = {
//     open: { title: 'Intro', filePath: 'src/components/video/video_scenes/Scene1.tsx' },
//   };

export interface SceneDetails {
  title: string;
  filePath: string;
}

export const SCENE_DETAILS: Record<string, SceneDetails> = {
  intro: { title: 'Make the next move', filePath: 'src/components/video/video_scenes/Scene1.tsx' },
  schedule: { title: 'Start with the event', filePath: 'src/components/video/video_scenes/Scene2.tsx' },
  details: { title: 'Important details', filePath: 'src/components/video/video_scenes/Scene3.tsx' },
  checklist: { title: 'Game-day checklist', filePath: 'src/components/video/video_scenes/Scene4.tsx' },
  ready: { title: 'Game day ready', filePath: 'src/components/video/video_scenes/Scene5.tsx' },
};

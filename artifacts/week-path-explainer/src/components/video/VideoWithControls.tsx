import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import { ChevronDown, ChevronUp, Pause, Play, Repeat, Volume2, VolumeX } from 'lucide-react';
import VideoTemplate from './VideoTemplate';
import { SCENE_DETAILS, SCENE_DURATIONS } from './sceneMeta';
import { useSceneControls } from './useSceneControls';

const time = (ms: number) => {
  const seconds = Math.floor(Math.max(0, ms) / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

function PlaybackStatus({
  sceneKeys, activeIndex, activeDuration, activeStartTime, totalDuration, tick, paused, onJumpTo,
}: {
  sceneKeys: string[]; activeIndex: number; activeDuration: number; activeStartTime: number;
  totalDuration: number; tick: number; paused: boolean; onJumpTo: (index: number) => void;
}) {
  const [elapsed, setElapsed] = useState(0);
  const elapsedBase = useRef(0);
  useEffect(() => { elapsedBase.current = 0; setElapsed(0); }, [tick]);
  useEffect(() => {
    if (paused) return;
    const start = performance.now();
    const id = window.setInterval(() => setElapsed(elapsedBase.current + performance.now() - start), 60);
    return () => { window.clearInterval(id); elapsedBase.current += performance.now() - start; };
  }, [tick, paused]);
  return (
    <>
      <div className="flex flex-1 items-center gap-1.5">
        {sceneKeys.map((key, index) => (
          <button
            key={key} type="button" onClick={() => onJumpTo(index)}
            className="relative h-3 min-w-3 flex-1 overflow-hidden rounded-full bg-white/25 hover:h-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
            title={SCENE_DETAILS[key]?.title ?? key}
            aria-label={`Jump to scene ${index + 1}: ${SCENE_DETAILS[key]?.title ?? key}`}
            aria-current={index === activeIndex ? 'true' : undefined}
          >
            <span className="absolute inset-y-0 left-0 rounded-full bg-white/90" style={{ width: index === activeIndex ? `${Math.min(100, (elapsed / activeDuration) * 100)}%` : '0%' }} />
          </button>
        ))}
      </div>
      <span className="shrink-0 font-mono text-sm tabular-nums text-white/80">{activeIndex + 1}/{sceneKeys.length}</span>
      <span role="timer" className="min-w-[10ch] shrink-0 text-right font-mono text-sm tabular-nums text-white/80" aria-label={`Playback time ${time(activeStartTime + Math.min(elapsed, activeDuration))} of ${time(totalDuration)}`}>
        {time(activeStartTime + Math.min(elapsed, activeDuration))} / {time(totalDuration)}
      </span>
    </>
  );
}

export default function VideoWithControls() {
  const isIframed = typeof window !== 'undefined' && window.self !== window.top;
  const controls = useSceneControls(SCENE_DURATIONS);
  const [muted, setMuted] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [tapPinned, setTapPinned] = useState(false);
  const sensor = useRef<HTMLDivElement>(null);
  const handleJump = useCallback((index: number) => {
    controls.jumpTo(index);
    const key = controls.sceneKeys[index];
    const details = SCENE_DETAILS[key];
    if (!details?.filePath) return;
    window.parent.postMessage({
      type: 'REPLIT_VIDEO_SCENE_SELECTED',
      payload: { sceneIndex: index, sceneCount: controls.sceneKeys.length, sceneTitle: details.title, filePath: details.filePath, lineNumber: 1 },
    }, '*');
  }, [controls.jumpTo, controls.sceneKeys]);
  useEffect(() => {
    if (!controls.paused) return;
    const frozen = document.getAnimations().filter((animation) => animation.playState === 'running');
    frozen.forEach((animation) => animation.pause());
    return () => frozen.forEach((animation) => animation.play());
  }, [controls.paused]);
  useEffect(() => {
    if (!(collapsed && tapPinned)) return;
    const dismiss = (event: globalThis.PointerEvent) => {
      if (event.pointerType !== 'mouse' && sensor.current && !sensor.current.contains(event.target as Node)) setTapPinned(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [collapsed, tapPinned]);
  const pointerEnter = (event: PointerEvent<HTMLDivElement>) => { if (event.pointerType === 'mouse') setHovering(true); };
  const pointerLeave = (event: PointerEvent<HTMLDivElement>) => { if (event.pointerType === 'mouse') setHovering(false); };
  const pointerDown = (event: PointerEvent<HTMLDivElement>) => { if (event.pointerType !== 'mouse' && collapsed) setTapPinned(true); };
  const toggleCollapsed = () => {
    if (!collapsed) { setHovering(false); setTapPinned(false); }
    setCollapsed(!collapsed);
  };
  if (!isIframed) return <VideoTemplate />;

  const visible = !collapsed || hovering || tapPinned;
  const buttonClass = 'flex h-12 w-12 shrink-0 items-center justify-center rounded-lg text-white/80 hover:bg-white/15 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white';
  return (
    <div className="relative h-screen w-full">
      <VideoTemplate
        key={controls.mountKey} durations={controls.durations} loop paused={controls.paused}
        muted={muted} onSceneChange={controls.onSceneChange}
      />
      <div
        ref={sensor} className="absolute inset-x-0 bottom-0 z-50 flex h-1/4 flex-col justify-end"
        onPointerEnter={pointerEnter} onPointerLeave={pointerLeave} onPointerDown={pointerDown}
      >
        <div className="w-full flex-1" aria-hidden="true" />
        <div className={`flex items-center gap-2 bg-black/65 px-3 py-2 backdrop-blur-sm transition-all duration-200 sm:gap-3 sm:px-5 sm:py-3 ${visible ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-full opacity-0'}`} aria-hidden={!visible}>
          <button type="button" className={buttonClass} onClick={controls.togglePause} aria-label={controls.paused ? 'Play' : 'Pause'}>
            {controls.paused ? <Play className="h-7 w-7" /> : <Pause className="h-7 w-7" />}
          </button>
          <button type="button" className={buttonClass} onClick={controls.toggleLock} aria-label={controls.locked ? 'Loop current scene: on' : 'Loop current scene: off'} aria-pressed={controls.locked}>
            <Repeat className="h-7 w-7" />
          </button>
          <button type="button" className={buttonClass} onClick={() => setMuted((value) => !value)} aria-label={muted ? 'Unmute' : 'Mute'}>
            {muted ? <VolumeX className="h-7 w-7" /> : <Volume2 className="h-7 w-7" />}
          </button>
          <div className="h-9 w-px shrink-0 bg-white/20" aria-hidden="true" />
          <PlaybackStatus
            sceneKeys={controls.sceneKeys} activeIndex={controls.activeIndex} activeDuration={controls.activeDuration}
            activeStartTime={controls.activeStartTime} totalDuration={controls.totalDuration} tick={controls.tick}
            paused={controls.paused} onJumpTo={handleJump}
          />
          <button type="button" className={buttonClass} onClick={toggleCollapsed} aria-label={collapsed ? 'Show controls' : 'Hide controls'} aria-expanded={!collapsed}>
            {collapsed ? <ChevronUp className="h-8 w-8" /> : <ChevronDown className="h-8 w-8" />}
          </button>
        </div>
      </div>
    </div>
  );
}
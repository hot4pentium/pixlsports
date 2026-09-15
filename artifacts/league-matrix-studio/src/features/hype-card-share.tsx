import { useEffect, useRef, useState } from 'react';
import { Maximize2, Pause, Play, Volume2, VolumeX, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { HypeCardProject } from './hype-card-types';
import { exportVideoCanvas } from './hype-card-export';

function seekVideo(video: HTMLVideoElement, time: number) {
  if (Math.abs(video.currentTime - time) < 0.02) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    video.addEventListener('seeked', () => resolve(), { once: true });
    video.addEventListener('error', () => reject(new Error('The video could not be prepared.')), { once: true });
    video.currentTime = time;
  });
}

function drawContained(context: CanvasRenderingContext2D, video: HTMLVideoElement, width: number, height: number) {
  const scale = Math.min(width / video.videoWidth, height / video.videoHeight);
  const drawWidth = video.videoWidth * scale;
  const drawHeight = video.videoHeight * scale;
  context.fillStyle = '#05070a';
  context.fillRect(0, 0, width, height);
  context.drawImage(video, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
}

export async function prepareHypeCardShareMedia(
  video: HTMLVideoElement,
  project: Pick<HypeCardProject, 'trimStart' | 'trimEnd'>,
  onProgress: (progress: number) => void,
) {
  if (!video.videoWidth || !video.videoHeight) throw new Error('The video is still loading. Try again in a moment.');
  const originalTime = video.currentTime;
  const wasPaused = video.paused;
  const longEdge = 960;
  const scale = Math.min(1, longEdge / Math.max(video.videoWidth, video.videoHeight));
  const width = Math.max(2, Math.round(video.videoWidth * scale / 2) * 2);
  const height = Math.max(2, Math.round(video.videoHeight * scale / 2) * 2);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser could not prepare the share video.');

  try {
    await seekVideo(video, project.trimStart);
    drawContained(context, video, width, height);
    const poster = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Could not create the poster image.')), 'image/jpeg', 0.88);
    });
    const clip = await exportVideoCanvas(
      canvas,
      video,
      24,
      onProgress,
      new AbortController().signal,
      true,
      project.trimStart,
      project.trimEnd,
      (ctx, frame) => drawContained(ctx, frame, width, height),
    );
    return { video: clip.blob, videoContentType: clip.mimeType, poster };
  } finally {
    video.currentTime = originalTime;
    if (wasPaused) video.pause();
    else void video.play().catch(() => undefined);
  }
}

export function FullSizeVideoDialog({
  open,
  onOpenChange,
  src,
  poster,
  title,
  trimStart = 0,
  trimEnd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  src?: string;
  poster?: string;
  title: string;
  trimStart?: number;
  trimEnd?: number;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onOpenChange(false);
    };
    window.addEventListener('keydown', keydown);
    return () => {
      videoRef.current?.pause();
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', keydown);
      previousFocus?.focus();
    };
  }, [onOpenChange, open]);

  useEffect(() => {
    const video = videoRef.current;
    if (!open || !video || trimEnd === undefined) return;
    const keepInRange = () => {
      if (video.currentTime >= trimEnd - 0.05 || video.currentTime < trimStart - 0.05) {
        video.currentTime = trimStart;
        video.pause();
        setPlaying(false);
      }
    };
    video.currentTime = trimStart;
    video.addEventListener('timeupdate', keepInRange);
    return () => video.removeEventListener('timeupdate', keepInRange);
  }, [open, trimEnd, trimStart]);

  if (!open || !src) return null;
  return (
    <div className="fixed inset-0 z-[90] grid place-items-center p-3 sm:p-8">
      <button type="button" className="absolute inset-0 bg-black/95 backdrop-blur" aria-label="Close full-size video" onClick={() => onOpenChange(false)} />
      <section role="dialog" aria-modal="true" aria-label={`${title} full-size video`} className="relative z-10 flex max-h-[96dvh] w-full max-w-6xl flex-col overflow-hidden border border-white/15 bg-[#080a0f] shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 text-white">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[.2em] text-primary">Pixl Sports full-size viewer</p>
            <h2 className="mt-1 font-display text-xl uppercase tracking-wide">{title}</h2>
          </div>
          <button ref={closeRef} type="button" onClick={() => onOpenChange(false)} className="grid h-11 w-11 place-items-center bg-white/10 hover:bg-primary hover:text-primary-foreground" aria-label="Close full-size video"><X className="h-5 w-5" /></button>
        </div>
        <div className="relative flex min-h-0 flex-1 items-center justify-center bg-black">
          <video
            ref={videoRef}
            src={src}
            poster={poster}
            className="max-h-[calc(96dvh-132px)] w-full object-contain"
            playsInline
            controls
            muted={muted}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
          />
        </div>
        <div className="flex items-center justify-center gap-2 border-t border-white/10 p-3 text-white sm:hidden">
          <Button type="button" variant="outline" className="border-white/20 bg-white/10 text-white" onClick={() => {
            const video = videoRef.current;
            if (!video) return;
            if (video.paused) void video.play();
            else video.pause();
          }}>{playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}<span className="ml-2">{playing ? 'Pause' : 'Play'}</span></Button>
          <Button type="button" variant="outline" className="border-white/20 bg-white/10 text-white" onClick={() => {
            const video = videoRef.current;
            if (!video) return;
            video.muted = !video.muted;
            setMuted(video.muted);
          }}>{muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}<span className="ml-2">{muted ? 'Unmute' : 'Mute'}</span></Button>
        </div>
      </section>
    </div>
  );
}

export function OpenFullSizeButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="absolute right-3 top-3 z-20 flex items-center gap-2 bg-black/75 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-white backdrop-blur hover:bg-primary hover:text-primary-foreground" aria-label="Watch video full size">
      <Maximize2 className="h-4 w-4" /> Watch full size
    </button>
  );
}
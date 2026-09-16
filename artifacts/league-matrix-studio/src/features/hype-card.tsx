type SaveStatus = 'Saved locally' | 'Saving' | 'Saved design' | 'Offline' | 'Save failed' | 'Conflict';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import {
  ArrowLeft, Check, Download, Eye, FileImage, FlipHorizontal2, FolderOpen, ImagePlus,
  LayoutGrid, Lightbulb, Move, Palette, RotateCw, Save, SlidersHorizontal, Upload, X, ZoomIn, Play, Pause, Volume2, VolumeX, RotateCcw, Share2, Link2Off, Clipboard
} from 'lucide-react';
import { Link } from 'wouter';
import { useParams, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { useUser } from '@clerk/react';
import { 
  useCreateProject, 
  useUpdateProject, 
  useGetProject, 
  getGetProjectQueryKey,
  getListProjectsQueryKey,
  useGetAccountAccess,
  getGetAccountAccessQueryKey,
  serveProjectMedia,
  useCreateHypeCardShare,
  useDeleteHypeCardShare,
  useListHypeCardShares,
  getListHypeCardSharesQueryKey,
  requestHypeCardShareUploadUrl,
  type HypeCardShare,
  type Project
} from '@workspace/api-client-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';

import {
  HypeCardProject, HypeFormat, TemplateId, CardLayoutId, PaletteId,
  HEADLINES, templates, cardLayouts, palettes, defaultProject, getDimensions, cardFinishes,
  normalizeHypeCardProject, readHypeCardProject, saveHypeCardProject, isSafeRasterDataUrl, designOnlyProject,
  serializeHypeCardTemplate, parseHypeCardTemplate, PORTABLE_TEMPLATE_MEDIA_NOTE
} from './hype-card-types';
import { buildHypeCardSvg, getPhotoClipInfo, SvgLayer, getPhotoFrame, STADIUM_MEDIA_FRAME } from './hype-card-svg';
import { saveMediaBlob, loadMediaBlob, deleteMediaBlob, checkExportSupport } from './hype-card-media';
import { exportVideoCanvas, rasterizeSvgForDownload, svgToImage } from './hype-card-export';
import { transcodeVideoToMp4 } from './hype-card-transcode';
import { getGuestUsageKey } from './guest-access';
import { prepareHypeCardShareMedia } from './hype-card-share';


function drawVideoContain(
  context: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const sourceWidth = video.videoWidth;
  const sourceHeight = video.videoHeight;
  if (!sourceWidth || !sourceHeight) return;
  const sourceRatio = sourceWidth / sourceHeight;
  const targetRatio = width / height;
  let drawX = x;
  let drawY = y;
  let drawWidth = width;
  let drawHeight = height;
  if (sourceRatio > targetRatio) {
    drawHeight = width / sourceRatio;
    drawY += (height - drawHeight) / 2;
  } else {
    drawWidth = height * sourceRatio;
    drawX += (width - drawWidth) / 2;
  }
  context.drawImage(video, 0, 0, sourceWidth, sourceHeight, drawX, drawY, drawWidth, drawHeight);
}

function slugify(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'hype-card';
}

function formatVideoTime(seconds: number) {
  const safeSeconds = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const minutes = Math.floor(safeSeconds / 60);
  return `${minutes}:${String(Math.floor(safeSeconds % 60)).padStart(2, '0')}`;
}

function readProjectFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read that project file.'));
    reader.readAsText(file);
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read the attached image.'));
    reader.readAsDataURL(blob);
  });
}
function assetUpload(
  event: ChangeEvent<HTMLInputElement>,
  onLoad: (dataUrl: string) => void,
  onError: (message: string) => void,
) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    onError('Please choose an image file.');
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const res = String(reader.result);
    if (!isSafeRasterDataUrl(res)) {
      onError('Please choose a valid PNG, JPG, WEBP, or GIF.');
      return;
    }
    onLoad(res);
  };
  reader.onerror = () => onError('That image could not be loaded. Try another file.');
  reader.readAsDataURL(file);
}
function LayoutOption({
  layout,
  project,
  selected,
  onSelect,
}: {
  layout: (typeof cardLayouts)[number];
  project: HypeCardProject;
  selected: boolean;
  onSelect: () => void;
}) {
  const ns = 'preview-' + layout.id;
  const svg = useMemo(
    () => buildHypeCardSvg({ ...project, format: 'card', layout: layout.id }, 'all', ns),
    [
      layout.id,
      project.headline,
      project.mediaType,
      project.photo,
      project.palette,
      project.overlay,
      project.branding,
      project.playerName,
      project.jerseyNumber,
      project.teamName,
      project.position,
      project.stat,
      project.achievement,
      project.coachMessage,
      project.logo,
      project.visibility.stat,
      project.visibility.achievement,
      project.visibility.coachMessage,
    ],
  );
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`group flex min-h-40 gap-4 overflow-hidden border p-3 text-left transition-all clip-angled-sm ${selected ? 'border-primary bg-primary/10 ring-2 ring-primary ring-offset-2 ring-offset-background' : 'border-border bg-background hover:border-foreground'}`}
      aria-pressed={selected}
      data-testid={`button-card-layout-${layout.id}`}
    >
      <div className="relative aspect-[5/7] w-24 shrink-0 overflow-hidden bg-muted clip-angled-sm">
        <div className="absolute inset-0 bg-tech-grid opacity-30 pointer-events-none" />
        <div className="hype-svg-preview absolute inset-0 [&>svg]:w-full [&>svg]:h-full" dangerouslySetInnerHTML={{ __html: svg }} />
        {selected && <span className="absolute right-2 top-2 grid h-7 w-7 place-items-center bg-primary text-primary-foreground shadow-md clip-angled-sm"><Check className="h-4 w-4" /></span>}
      </div>
      <span className="flex min-w-0 flex-1 flex-col justify-center py-2">
        <span className="flex items-center justify-between gap-2">
          <span className="text-sm font-bold uppercase tracking-wider">{layout.name}</span>
          <span className="h-3 w-3 shrink-0 clip-angled-sm" style={{ backgroundColor: layout.tone }} />
        </span>
        <span className="mt-2 block text-xs font-medium leading-relaxed text-muted-foreground">{layout.summary}</span>
        <span className={`mt-4 text-[10px] font-bold uppercase tracking-widest ${selected ? 'text-primary' : 'text-muted-foreground'}`}>{selected ? 'Selected' : 'Choose layout'}</span>
      </span>
    </button>
  );
}

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof Palette;
  children: ReactNode;
}) {
  return (
    <section className="border-t border-border pt-6">
      <div className="mb-5 flex items-center gap-2">
        <Icon className="h-5 w-5 text-primary" />
        <h2 className="text-sm font-bold uppercase tracking-widest text-foreground">{title}</h2>
      </div>
      {children}
    </section>
  );
}

const hypeWalkthroughSteps = [
  { label: 'Moment', hint: 'Choose the headline' },
  { label: 'Media', hint: 'Add player media' },
  { label: 'Details', hint: 'Add player info' },
  { label: 'Format', hint: 'Choose the output' },
  { label: 'Layout', hint: 'Choose the scene' },
  { label: 'Palette', hint: 'Choose the colors' },
  { label: 'Review', hint: 'Preview and export' },
] as const;

function HypeField({
  label,
  value,
  onChange,
  placeholder,
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-foreground">
        {label}
        {required && <span className="text-primary">*</span>}
      </span>
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-12 border-border bg-background focus:border-primary font-medium clip-angled-sm transition-colors rounded-none"
      />
    </label>
  );
}

function AssetButton({
  label,
  hasAsset,
  onChange,
  onRemove,
}: {
  label: string;
  hasAsset: boolean;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <label className="flex min-h-12 flex-1 cursor-pointer items-center justify-center gap-3 border-2 border-dashed border-border bg-background px-4 text-sm font-bold uppercase tracking-widest transition-colors hover:border-primary hover:text-primary clip-angled-sm">
        {hasAsset ? <Check className="h-5 w-5 text-primary" /> : <Upload className="h-5 w-5 text-muted-foreground" />}
        {hasAsset ? `${label} added` : `Add ${label}`}
        <input type="file" accept="image/*,video/*" className="sr-only" onChange={onChange} />
      </label>
      {hasAsset && (
        <button type="button" onClick={onRemove} className="grid h-12 w-12 shrink-0 place-items-center bg-muted border border-border text-foreground hover:bg-destructive hover:text-destructive-foreground transition-colors clip-angled-sm" aria-label={`Remove ${label}`}>
          <X className="h-5 w-5" />
        </button>
      )}
    </div>
  );
}

export function PreviewArtwork({
  project,
  videoUrl,
  videoRef,
  ns,
  testId,
  poster,
  muted = true,
}: {
  project: HypeCardProject;
  videoUrl?: string;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
  ns: string;
  testId: string;
  poster?: string;
  muted?: boolean;
}) {
  const dimensions = getDimensions(project.format);
  const clipInfo = getPhotoClipInfo(project, ns);
  const frame = project.format === 'card' ? STADIUM_MEDIA_FRAME : getPhotoFrame(project.format);
  const hasVideo = project.mediaType === 'video' && Boolean(videoUrl);
  const hasImage = project.mediaType !== 'video' && Boolean(project.photo);

  if (!hasVideo && !hasImage) {
    return (
      <div
        className="h-full w-full [&>svg]:h-full [&>svg]:w-full"
        data-testid={testId}
        dangerouslySetInnerHTML={{ __html: buildHypeCardSvg(project, 'all', ns) }}
      />
    );
  }

  const mediaStyle = {
    left: `${(clipInfo.x - frame.x) / frame.width * 100}%`,
    top: `${(clipInfo.y - frame.y) / frame.height * 100}%`,
    width: `${clipInfo.w / frame.width * 100}%`,
    height: `${clipInfo.h / frame.height * 100}%`,
    filter: `brightness(${project.adjustments.brightness}) contrast(${project.adjustments.contrast}) saturate(${project.adjustments.saturation})`,
    transformOrigin: 'center',
    transform: `rotate(${project.photoTransform.rotation}deg) scaleX(${project.photoTransform.flip ? -1 : 1})`,
  };

  return (
    <div className="relative h-full w-full overflow-hidden" data-testid={testId}>
      <div className="absolute inset-0 pointer-events-none [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: buildHypeCardSvg(project, 'bg', ns) }} />
      <div
        className="absolute overflow-hidden"
        style={{
          left: `${frame.x / dimensions.width * 100}%`,
          top: `${frame.y / dimensions.height * 100}%`,
          width: `${frame.width / dimensions.width * 100}%`,
          height: `${frame.height / dimensions.height * 100}%`,
          borderRadius: `${frame.radius / frame.width * 100}%`,
        }}
      >
        {hasVideo ? (
          <video
            ref={videoRef}
            src={videoUrl}
            poster={poster}
            className="absolute max-w-none object-contain"
            autoPlay
            muted={muted}
            playsInline
            style={mediaStyle}
          />
        ) : (
          <img
            src={project.photo ?? ''}
            alt=""
            className="absolute max-w-none object-contain"
            draggable={false}
            style={mediaStyle}
          />
        )}
      </div>
      <div className="absolute inset-0 pointer-events-none [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: buildHypeCardSvg(project, 'fg', ns) }} />
    </div>
  );
}

export function PreviewCanvas({
  project,
  videoUrl,
  videoRef,
}: {
  project: HypeCardProject;
  videoUrl?: string;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
}) {
  const dimensions = getDimensions(project.format);
  const ns = useMemo(() => Math.random().toString(36).substring(2, 9), [project.layout, project.format, project.template]);
  const stageRef = useRef<HTMLDivElement>(null);
  const [stageBounds, setStageBounds] = useState({ width: 0, height: 0 });

  const [isPlaying, setIsPlaying] = useState(true);
  const [isMuted, setIsMuted] = useState(true);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => {
      const { width, height } = stage.getBoundingClientRect();
      setStageBounds((current) => (
        current.width === width && current.height === height ? current : { width, height }
      ));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (videoRef?.current) {
      videoRef.current.loop = false;
      if (isPlaying) videoRef.current.play().catch(() => setIsPlaying(false));
      else videoRef.current.pause();
    }
  }, [isPlaying, videoUrl, videoRef]);

  useEffect(() => {
    const video = videoRef?.current;
    if (!video || !videoUrl || project.mediaType !== 'video') return;
    const start = Math.max(0, project.trimStart);
    const keepInRange = () => {
      const sourceEnd = Number.isFinite(video.duration) ? video.duration : project.trimEnd;
      const end = Math.min(project.trimEnd, sourceEnd);
      if (video.currentTime >= end - 0.05 || video.currentTime < start - 0.05) {
        const wasPlaying = !video.paused;
        video.currentTime = start;
        if (wasPlaying) video.play().catch(() => setIsPlaying(false));
      }
    };
    video.currentTime = start;
    video.addEventListener('timeupdate', keepInRange);
    return () => video.removeEventListener('timeupdate', keepInRange);
  }, [project.mediaType, project.trimEnd, project.trimStart, videoRef, videoUrl]);

  useEffect(() => {
    if (videoRef?.current) {
      videoRef.current.muted = isMuted;
    }
  }, [isMuted, videoUrl, videoRef]);

  const outputRatio = dimensions.width / dimensions.height;
  const previewWidth = stageBounds.width && stageBounds.height
    ? Math.min(stageBounds.width, 760, stageBounds.height * outputRatio)
    : 0;
  const previewHeight = previewWidth ? previewWidth / outputRatio : 0;

  return (
    <div className="relative h-full min-h-0 overflow-hidden border border-border bg-muted group clip-angled-sm">
      <div className="absolute inset-0 bg-tech-grid opacity-40 pointer-events-none" />
      <div ref={stageRef} className="absolute inset-4 flex items-center justify-center sm:inset-8">
        <div
          className="relative z-10 overflow-hidden rounded-[22px] shadow-2xl"
          style={{
            aspectRatio: `${dimensions.width}/${dimensions.height}`,
            width: previewWidth || '100%',
            height: previewHeight || 'auto',
            maxWidth: 760,
          }}
        >
          <PreviewArtwork project={project} videoUrl={videoUrl} videoRef={videoRef} ns={ns} testId="hype-preview-canvas" muted={isMuted} />
        </div>
      </div>
      
      {project.mediaType === 'video' && videoUrl && (
        <div className="absolute bottom-6 left-1/2 z-20 -translate-x-1/2 flex items-center gap-2 bg-foreground/90 p-2 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 clip-angled-sm shadow-xl border border-white/10">
          <button type="button" data-testid="button-play-pause" onClick={() => setIsPlaying(!isPlaying)} className="grid h-10 w-10 place-items-center bg-white/10 text-white hover:bg-primary hover:text-primary-foreground clip-angled-sm transition-colors" aria-label={isPlaying ? 'Pause' : 'Play'}>
            {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
          </button>
          <button type="button" data-testid="button-restart" onClick={() => { if (videoRef?.current) { videoRef.current.currentTime = project.trimStart; videoRef.current.play().catch(()=>setIsPlaying(false)); setIsPlaying(true); } }} className="grid h-10 w-10 place-items-center bg-white/10 text-white hover:bg-primary hover:text-primary-foreground clip-angled-sm transition-colors" aria-label="Restart">
            <RotateCcw className="h-5 w-5" />
          </button>
           <button type="button" data-testid="button-mute-unmute" onClick={() => {
             setIsMuted((muted) => !muted);
             if (isMuted) videoRef?.current?.play().catch(() => setIsPlaying(false));
           }} className="grid h-10 w-10 place-items-center bg-white/10 text-white hover:bg-primary hover:text-primary-foreground clip-angled-sm transition-colors" aria-label={isMuted ? 'Enable audio' : 'Mute'} title={isMuted ? 'Enable audio' : 'Mute'}>
            {isMuted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
          </button>
        </div>
      )}
    </div>
  );
}
export function MobilePreviewDialog({
  project,
  open,
  onOpenChange,
  title,
  videoUrl,
}: {
  project: HypeCardProject;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  videoUrl?: string;
}) {
  const dimensions = getDimensions(project.format);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const mobileVideoRef = useRef<HTMLVideoElement>(null);
  const previewStageRef = useRef<HTMLDivElement>(null);
  const ns = useMemo(() => Math.random().toString(36).substring(2, 9), [project.layout, project.format, project.template]);
  const [isPlaying, setIsPlaying] = useState(true);
  const [isMuted, setIsMuted] = useState(true);
  const [previewBounds, setPreviewBounds] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onOpenChange(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
      previousFocus?.focus();
    };
  }, [open, onOpenChange]);

  useEffect(() => {
    const video = mobileVideoRef.current;
    if (!open || !video) return;
    video.loop = false;
    video.muted = isMuted;
    if (isPlaying) {
      video.play().catch(() => setIsPlaying(false));
    } else {
      video.pause();
    }
  }, [isMuted, isPlaying, open, videoUrl]);

  useEffect(() => {
    const video = mobileVideoRef.current;
    if (!open || !video || !videoUrl || project.mediaType !== 'video') return;
    const start = Math.max(0, project.trimStart);
    const keepInRange = () => {
      const sourceEnd = Number.isFinite(video.duration) ? video.duration : project.trimEnd;
      const end = Math.min(project.trimEnd, sourceEnd);
      if (video.currentTime >= end - 0.05 || video.currentTime < start - 0.05) {
        const wasPlaying = !video.paused;
        video.currentTime = start;
        if (wasPlaying) video.play().catch(() => setIsPlaying(false));
      }
    };
    video.currentTime = start;
    video.addEventListener('timeupdate', keepInRange);
    return () => video.removeEventListener('timeupdate', keepInRange);
  }, [open, project.mediaType, project.trimEnd, project.trimStart, videoUrl]);

  useEffect(() => {
    if (!open) return;
    const stage = previewStageRef.current;
    if (!stage) return;

    const measure = () => {
      const styles = window.getComputedStyle(stage);
      const horizontalPadding = parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight);
      const verticalPadding = parseFloat(styles.paddingTop) + parseFloat(styles.paddingBottom);
      const width = Math.max(0, stage.clientWidth - horizontalPadding);
      const height = Math.max(0, stage.clientHeight - verticalPadding);
      setPreviewBounds((current) => (
        current.width === width && current.height === height ? current : { width, height }
      ));
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [open]);

  if (!open) return null;

  const outputRatio = dimensions.width / dimensions.height;
  const stageRatio = previewBounds.height > 0 ? previewBounds.width / previewBounds.height : outputRatio;
  const fittedHeight = stageRatio > outputRatio
    ? previewBounds.height
    : previewBounds.width / outputRatio;
  const fittedWidth = stageRatio > outputRatio
    ? previewBounds.height * outputRatio
    : previewBounds.width;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-foreground/90 backdrop-blur-sm" onClick={() => onOpenChange(false)} aria-label="Close card preview" />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="mobile-preview-title"
        aria-describedby="mobile-preview-description"
        className="relative z-10 flex h-[96dvh] w-full max-w-6xl flex-col overflow-hidden border border-border bg-card p-4 shadow-2xl clip-angled-sm sm:p-6"
      >
        <button ref={closeButtonRef} type="button" onClick={() => onOpenChange(false)} className="absolute right-4 top-4 grid h-10 w-10 place-items-center bg-muted hover:bg-destructive hover:text-destructive-foreground transition-colors clip-angled-sm" aria-label="Close card preview">
          <X className="h-5 w-5" />
        </button>
        <div className="mb-3 pr-12 text-left">
          <div className="inline-flex items-center gap-2 bg-primary/10 text-primary px-3 py-1 text-xs font-bold uppercase tracking-widest clip-angled-sm mb-3">
            <span className="h-2 w-2 bg-primary animate-pulse" /> Live Monitor
          </div>
          <h2 id="mobile-preview-title" className="font-display text-2xl uppercase tracking-wide leading-none sm:text-3xl">{title}</h2>
          <p id="mobile-preview-description" className="mt-2 text-sm font-medium text-muted-foreground">{dimensions.width} × {dimensions.height}. Output updates instantly.</p>
        </div>
        <div ref={previewStageRef} className="relative flex min-h-0 flex-1 items-center justify-center border border-border bg-muted p-3 clip-angled-sm sm:p-5">
          <div className="absolute inset-0 bg-tech-grid opacity-30" />
          <div
            className="relative z-10 overflow-hidden rounded-[22px] shadow-xl"
            style={{
              aspectRatio: `${dimensions.width}/${dimensions.height}`,
              width: `${fittedWidth}px`,
              height: `${fittedHeight}px`,
            }}
            data-testid="mobile-hype-preview-canvas"
          >
            <PreviewArtwork project={project} videoUrl={videoUrl} videoRef={mobileVideoRef} ns={ns} testId="mobile-hype-preview-canvas" muted={isMuted} />
             {project.mediaType === 'video' && videoUrl && (
               <div className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 bg-foreground/90 p-2 clip-angled-sm border border-white/10 shadow-lg">
                 <button type="button" data-testid="button-play-pause" onClick={() => setIsPlaying((playing) => !playing)} className="grid h-10 w-10 place-items-center bg-white/10 text-white hover:bg-primary hover:text-primary-foreground clip-angled-sm transition-colors" aria-label={isPlaying ? 'Pause' : 'Play'}>
                   {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
                 </button>
                 <button type="button" data-testid="button-restart" onClick={() => {
                   const video = mobileVideoRef.current;
                   if (!video) return;
                    video.currentTime = project.trimStart;
                   video.play().catch(() => setIsPlaying(false));
                   setIsPlaying(true);
                 }} className="grid h-10 w-10 place-items-center bg-white/10 text-white hover:bg-primary hover:text-primary-foreground clip-angled-sm transition-colors" aria-label="Restart">
                   <RotateCcw className="h-5 w-5" />
                 </button>
                  <button type="button" data-testid="button-mute-unmute" onClick={() => {
                    setIsMuted((muted) => !muted);
                    if (isMuted) mobileVideoRef.current?.play().catch(() => setIsPlaying(false));
                  }} className="grid h-10 w-10 place-items-center bg-white/10 text-white hover:bg-primary hover:text-primary-foreground clip-angled-sm transition-colors" aria-label={isMuted ? 'Enable audio' : 'Mute'} title={isMuted ? 'Enable audio' : 'Mute'}>
                   {isMuted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
                 </button>
               </div>
             )}
          </div>
        </div>
        <Button type="button" onClick={() => onOpenChange(false)} className="w-full mt-6 bg-foreground hover:bg-foreground/90 text-background font-bold uppercase tracking-widest clip-angled-sm h-12 rounded-none">
          Back to editing
        </Button>
      </section>
    </div>
  );
}


export function HypeCardEditor() {
  const params = useParams();
  const [, setLocation] = useLocation();
  const cloudProjectId = params.id;
  const { user, isSignedIn, isLoaded } = useUser();
  const queryClient = useQueryClient();

  const [project, setProject] = useState<HypeCardProject>(() => {
    try {
      if (cloudProjectId) return defaultProject(); 
      return readHypeCardProject() ?? defaultProject();
    } catch {
      return defaultProject();
    }
  });

  const [notice, setNotice] = useState('');
  const [templateMediaNotice, setTemplateMediaNotice] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>(cloudProjectId ? 'Saving' : 'Saved locally');
  const [conflictData, setConflictData] = useState<Project | null>(null);
  
  const [autosaveWarning, setAutosaveWarning] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [mobilePreviewOpen, setMobilePreviewOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [validation, setValidation] = useState('');
  const [videoUrl, setVideoUrl] = useState<string | undefined>(undefined);
  const [exportSupport, setExportSupport] = useState(() => checkExportSupport());
  const [includeAudio, setIncludeAudio] = useState(true);
  const [imageFormat, setImageFormat] = useState<'png' | 'jpeg'>('png');
  const [walkthroughStep, setWalkthroughStep] = useState(0);
  const [sharing, setSharing] = useState(false);
  const [shareProgress, setShareProgress] = useState(0);
  const [publishedShare, setPublishedShare] = useState<HypeCardShare | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const exportAbortRef = useRef<AbortController | null>(null);

  const initializedForId = useRef<string | null>(null);
  const lastSaved = useRef<HypeCardProject>(project);
  const currentRevision = useRef<number>(1);
  const guestUsageKey = useRef(getGuestUsageKey('hype_card', 'hype-editor', false)).current;
  const shareKey = cloudProjectId || guestUsageKey;
  const mutateFnRef = useRef<any>(null);
  const isSavingRef = useRef(false);
  const nextSaveDataRef = useRef<HypeCardProject | null>(null);

  useEffect(() => {
    if (isLoaded && !isSignedIn && cloudProjectId) {
      setLocation('/sign-in');
    }
  }, [isLoaded, isSignedIn, cloudProjectId, setLocation]);

  if (isLoaded && !isSignedIn && cloudProjectId) {
    return (
      <div className="flex h-[100dvh] items-center justify-center bg-muted">
        <p className="font-bold uppercase tracking-wider text-muted-foreground">Redirecting to sign in...</p>
      </div>
    );
  }

  const { data: cloudProjectData } = useGetProject(cloudProjectId || '', {
    query: { enabled: !!cloudProjectId && !!isSignedIn, queryKey: getGetProjectQueryKey(cloudProjectId || '') }
  });
  const { data: accountAccess } = useGetAccountAccess({
    query: {
      enabled: Boolean(isSignedIn),
      staleTime: 15000,
      queryKey: getGetAccountAccessQueryKey(),
    },
  });

  const updateProjectMutation = useUpdateProject({
    mutation: {
      onSuccess: (data) => {
        currentRevision.current = data.revision;
        setSaveStatus('Saved design');
        queryClient.setQueryData(getGetProjectQueryKey(cloudProjectId || ''), data);
      },
      onError: (err: any) => {
        if (err?.status === 409 || err?.message?.includes('409') || err?.error?.includes('conflict')) {
          setSaveStatus('Conflict');
          if (err?.data?.current) {
            setConflictData(err.data.current);
          }
          setNotice('Conflict detected! Review changes before saving.');
        } else {
          setSaveStatus('Save failed');
        }
      }
    }
  });
  
  const createProject = useCreateProject();
  const createHypeShare = useCreateHypeCardShare();
  const deleteHypeShare = useDeleteHypeCardShare();
  const { data: hypeShares } = useListHypeCardShares({
    query: {
      enabled: Boolean(isSignedIn),
      queryKey: getListHypeCardSharesQueryKey(),
      staleTime: 10_000,
    },
  });
  const existingShare = publishedShare ?? hypeShares?.find((share) => share.manifest.shareKey === shareKey) ?? null;
  mutateFnRef.current = updateProjectMutation.mutateAsync;

  useEffect(() => {
    if (cloudProjectId && cloudProjectData && initializedForId.current !== cloudProjectId) {
      initializedForId.current = cloudProjectId;
      const p = normalizeHypeCardProject(cloudProjectData.project);
      setProject(p);
      lastSaved.current = p;
      currentRevision.current = cloudProjectData.revision;
      setSaveStatus('Saved design');
    }
  }, [cloudProjectData, cloudProjectId]);

  useEffect(() => {
    const previousBodyOverflow = document.body.style.overflow;
    const previousRootOverflow = document.documentElement.style.overflow;
    const desktopEditor = window.matchMedia('(min-width: 640px)');
    const syncPageOverflow = () => {
      document.body.style.overflow = desktopEditor.matches ? 'hidden' : previousBodyOverflow;
      document.documentElement.style.overflow = desktopEditor.matches ? 'hidden' : previousRootOverflow;
    };

    syncPageOverflow();
    desktopEditor.addEventListener('change', syncPageOverflow);

    return () => {
      desktopEditor.removeEventListener('change', syncPageOverflow);
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousRootOverflow;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    
    const loadMedia = async () => {
      if (!project.mediaId || !project.mediaType) {
        if (project.mediaType !== 'image') setVideoUrl(undefined);
        return;
      }

      let blob = await loadMediaBlob(project.mediaId);
      
      if (!blob && cloudProjectId) {
        try {
          blob = await serveProjectMedia(project.mediaId);
          if (blob) {
            await saveMediaBlob(project.mediaId, blob);
          }
        } catch (e) {
          console.error("Failed to load cloud media", e);
        }
      }

      if (!blob) {
        if (!cancelled) {
          if (project.mediaType === 'video') setVideoUrl(undefined);
          setNotice('The attached media is no longer available on this device. Please add it again.');
        }
        return;
      }

      if (project.mediaType === 'video') {
        const url = URL.createObjectURL(blob);
        if (cancelled) {
          URL.revokeObjectURL(url);
        } else {
          setVideoUrl(url);
        }
      } else if (project.mediaType === 'image') {
        if (project.photo) return;
        const photo = await blobToDataUrl(blob);
        if (!cancelled) {
          setProject((current) => (
            current.mediaType === 'image' && current.mediaId === project.mediaId
              ? { ...current, photo }
              : current
          ));
        }
      }
    };

    loadMedia();

    return () => { cancelled = true; };
  }, [project.mediaId, project.mediaType, cloudProjectId, project.photo]);

  useEffect(() => {
    if (project.mediaType !== 'image' || !project.photo || project.mediaId) return;
    let cancelled = false;

    const migrateImage = async () => {
      try {
        const blob = await fetch(project.photo!).then((response) => response.blob());
        const id = `image-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        await saveMediaBlob(id, blob);
        if (!cancelled) {
          setProject((current) => (
            current.mediaType === 'image' && current.photo === project.photo && !current.mediaId
              ? { ...current, mediaId: id }
              : current
          ));
        }
      } catch (err) {
        console.error('Failed to migrate image to DB', err);
      }
    };

    void migrateImage();
    return () => { cancelled = true; };
  }, [project.mediaId, project.mediaType, project.photo]);

  useEffect(() => {
    setExportSupport(checkExportSupport());
  }, [project.mediaType]);

  useEffect(() => {
    return () => {
      if (videoUrl) URL.revokeObjectURL(videoUrl);
    };
  }, [videoUrl]);

  const processNextSave = async () => {
    if (isSavingRef.current || !nextSaveDataRef.current || !cloudProjectId || saveStatus === 'Conflict') return;

    const dataToSave = nextSaveDataRef.current;
    nextSaveDataRef.current = null;
    isSavingRef.current = true;
    setSaveStatus('Saving');

    try {
      const savedProject = designOnlyProject(dataToSave);

      await mutateFnRef.current({
        projectId: cloudProjectId,
        data: {
          project: savedProject,
          expectedRevision: currentRevision.current
        }
      });
      lastSaved.current = dataToSave;
    } catch (e: any) {
      if (e?.status !== 409 && !e?.message?.includes('409') && !e?.error?.includes('conflict')) {
         setSaveStatus('Save failed');
      }
    } finally {
      isSavingRef.current = false;
      if (nextSaveDataRef.current) {
        processNextSave();
      }
    }
  };

  const processNextSaveRef = useRef(processNextSave);
  processNextSaveRef.current = processNextSave;

  useEffect(() => {
    if (cloudProjectId && initializedForId.current !== cloudProjectId) return;
    if (saveStatus === 'Conflict') return;

    const isSameAsLastSaved = JSON.stringify(project) === JSON.stringify(lastSaved.current);
    if (isSameAsLastSaved) return;

    const timeout = window.setTimeout(async () => {
      if (!cloudProjectId) {
        try {
          const savedProject = project.mediaType === 'image' && project.mediaId
            ? { ...project, photo: null }
            : project;
           saveHypeCardProject(window.localStorage, savedProject);
          window.localStorage.setItem('leaguematrix-project', 'true');
          setAutosaveWarning('');
          setSaveStatus('Saved locally');
          lastSaved.current = project;
        } catch {
          setAutosaveWarning('Autosave is unavailable in this browser. Download the project file to keep a backup.');
        }
      } else {
        nextSaveDataRef.current = project;
        processNextSaveRef.current();
      }
    }, 400);

    return () => window.clearTimeout(timeout);
  }, [project, cloudProjectId, saveStatus]);

  const saveToCloud = async () => {
    if (!isSignedIn) {
      setLocation('/sign-in');
      return;
    }
    setSaveStatus('Saving');
    try {
      const created = await createProject.mutateAsync({
        data: {
          name: `${project.teamName || 'Untitled'} - ${project.headline || 'Project'}`,
          project: designOnlyProject(project),
          ...(accountAccess?.accessMode === 'guest' ? { guestUsageKey } : {}),
        }
      });
      queryClient.invalidateQueries({ queryKey: getGetAccountAccessQueryKey() });
      lastSaved.current = project;
      setNotice('Design saved. Add media anytime to create a new export.');
      setLocation(`/studio/hype-card/${created.id}`);
    } catch (e: any) {
      setSaveStatus('Save failed');
      setNotice(e?.status === 409 ? 'Guest Hype Card limit reached. Choose Full Account to create more.' : 'Failed to migrate project to cloud.');
    }
  };

  const resolveConflict = async (action: 'server' | 'new') => {
    if (action === 'server') {
       if (conflictData) {
          setProject(normalizeHypeCardProject(conflictData.project));
         currentRevision.current = conflictData.revision;
          lastSaved.current = normalizeHypeCardProject(conflictData.project);
         setConflictData(null);
         setSaveStatus('Saved design');
       } else if (cloudProjectData) {
          setProject(normalizeHypeCardProject(cloudProjectData.project));
         currentRevision.current = cloudProjectData.revision;
          lastSaved.current = normalizeHypeCardProject(cloudProjectData.project);
         setSaveStatus('Saved design');
       }
    } else {
       setSaveStatus('Saving');
       try {
         const p = { ...project };
         const created = await createProject.mutateAsync({
           data: {
             name: `${p.teamName || 'Untitled'} - ${p.headline || 'Project'} (Copy)`,
              project: designOnlyProject(p),
               ...(accountAccess?.accessMode === 'guest' ? { guestUsageKey: `${guestUsageKey}-copy` } : {}),
           }
         });
          queryClient.invalidateQueries({ queryKey: getGetAccountAccessQueryKey() });
          lastSaved.current = p;
         
         setConflictData(null);
         queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
         setLocation(`/studio/hype-card/${created.id}`);
        } catch (e: any) {
         setSaveStatus('Conflict');
          setNotice(e?.status === 409 ? 'Guest Hype Card limit reached. Choose Full Account to create more.' : 'Failed to save as new project. Please try again.');
       }
    }
  };

  const updateProject = <K extends keyof HypeCardProject>(key: K, value: HypeCardProject[K]) => {
    setProject((current) => ({ ...current, [key]: value }));
    setValidation('');
  };

  const updateTransform = (key: keyof HypeCardProject['photoTransform'], value: number | boolean) => {
    setProject((current) => ({ ...current, photoTransform: { ...current.photoTransform, [key]: value } }));
  };

  const updateAdjustment = (key: keyof HypeCardProject['adjustments'], value: number) => {
    setProject((current) => ({ ...current, adjustments: { ...current.adjustments, [key]: value } }));
  };

  const updateTrim = (edge: 'start' | 'end', value: number) => {
    setProject((current) => {
      const duration = current.videoMeta?.duration ?? 15;
      if (edge === 'start') {
        const start = Math.max(0, Math.min(value, duration - 0.1));
        const end = start >= current.trimEnd || current.trimEnd - start > 15
          ? Math.min(duration, start + 15)
          : current.trimEnd;
        return { ...current, trimStart: start, trimEnd: end };
      }
      const end = Math.max(current.trimStart + 0.1, Math.min(value, duration, current.trimStart + 15));
      return { ...current, trimEnd: end };
    });
  };

  const getPortableProject = async (): Promise<HypeCardProject> => {
    return designOnlyProject(project);
  };

  const handleMediaUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    if (file.type.startsWith('video/')) {
      if (file.size > 120 * 1024 * 1024) {
        setNotice('Video is too large. Please choose a video under 120MB.');
        return;
      }
      
      const id = slugify(`${file.name}-${Date.now()}`);
      const url = URL.createObjectURL(file);
      try {
        const v = document.createElement('video');
        v.preload = 'auto';
        v.muted = true;
        v.playsInline = true;
        v.src = url;
        await new Promise<void>((resolve, reject) => {
          v.addEventListener('loadedmetadata', () => resolve(), { once: true });
          v.addEventListener('error', () => reject(new Error('This browser cannot decode that video. Try an MP4/H.264 clip.')), { once: true });
        });
        if (!Number.isFinite(v.duration) || v.duration <= 0) {
          throw new Error('This video has an invalid duration.');
        }
        let preparedVideo: Blob = file;
        let playbackUrl = url;
        let conversionWarning = '';
        try {
          setNotice('');
          setAutosaveWarning('Preparing a smaller MP4 locally… 0%');
          preparedVideo = await transcodeVideoToMp4(file, (progress) => {
            setAutosaveWarning(`Preparing a smaller MP4 locally… ${Math.round(progress * 100)}%`);
          });
          if (preparedVideo.size >= file.size && file.type.includes('mp4')) {
            preparedVideo = file;
          }
          playbackUrl = URL.createObjectURL(preparedVideo);
        } catch (conversionError) {
          console.warn('Video conversion unavailable; keeping original locally.', conversionError);
          conversionWarning = 'This browser could not create a smaller MP4, so the original video will stay local.';
        }

        await saveMediaBlob(id, preparedVideo);
        if (project.mediaId) {
          await deleteMediaBlob(project.mediaId).catch(console.warn);
        }
        setVideoUrl(playbackUrl);
        
        // Generate poster for project.photo as fallback
        v.currentTime = Math.min(0.05, v.duration / 2);
        await new Promise<void>((resolve) => {
          v.addEventListener('seeked', () => resolve(), { once: true });
          v.addEventListener('error', () => resolve(), { once: true });
        });
        let poster: string | null = null;
        try {
          const cv = document.createElement('canvas');
          cv.width = v.videoWidth || 640;
          cv.height = v.videoHeight || 640;
          cv.getContext('2d')?.drawImage(v, 0, 0, cv.width, cv.height);
          poster = cv.toDataURL('image/jpeg', 0.8);
        } catch (e) {}

        setProject(curr => ({
          ...curr,
          mediaType: 'video',
          mediaId: id,
          videoMeta: {
            name: preparedVideo.type.includes('mp4')
              ? file.name.replace(/\.[^.]+$/, '') + '.mp4'
              : file.name,
            type: preparedVideo.type || file.type,
            size: preparedVideo.size,
            duration: v.duration,
          },
          trimStart: 0,
          trimEnd: Math.min(15, v.duration),
          photo: poster,
          photoTransform: defaultProject().photoTransform,
          adjustments: defaultProject().adjustments
        }));
         setTemplateMediaNotice(false);
        setValidation('');
        setAutosaveWarning('');
        setNotice(conversionWarning);
        if (playbackUrl !== url) URL.revokeObjectURL(url);
      } catch (err) {
        URL.revokeObjectURL(url);
        setAutosaveWarning('');
        setNotice(err instanceof Error ? err.message : 'Could not save video to local storage.');
      }
    } else if (file.type.startsWith('image/')) {
      try {
        const res = await blobToDataUrl(file);
        if (!isSafeRasterDataUrl(res)) {
          setNotice('Please choose a valid PNG, JPG, WEBP, or GIF.');
          return;
        }
        const id = `image-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        await saveMediaBlob(id, file);
        if (project.mediaId) {
          await deleteMediaBlob(project.mediaId).catch(console.warn);
        }
        setVideoUrl(undefined);
        setProject(curr => ({
          ...curr,
          mediaType: 'image',
          mediaId: id,
          videoMeta: null,
          photo: res,
          photoTransform: defaultProject().photoTransform,
          adjustments: defaultProject().adjustments
        }));
         setTemplateMediaNotice(false);
        setValidation('');
        setAutosaveWarning('');
      } catch (error) {
        console.error('Failed to save image media', error);
        setNotice('That image could not be saved in this browser. Try another image or browser.');
      }
    } else {
      setNotice('Please choose a PNG, JPG, WEBP, GIF, MP4, MOV, or WebM file.');
    }
  };

  const handleMediaRemove = async () => {
    if (project.mediaId) {
      await deleteMediaBlob(project.mediaId).catch(console.warn);
    }
    setVideoUrl(undefined);
    setTemplateMediaNotice(false);
    setProject(curr => ({
      ...curr,
      mediaType: null,
      mediaId: null,
      videoMeta: null,
      photo: null,
      photoTransform: defaultProject().photoTransform,
      adjustments: defaultProject().adjustments
    }));
  };

  const handleExport = async () => {
    setValidation('');
    setNotice('');
    if (!project.photo && !project.mediaType) {
      setValidation('Please add a photo or video first.');
      return;
    }
    if (project.mediaType === 'image' && !project.photo) {
      setValidation('The attached image is still loading. Please try again in a moment.');
      return;
    }
    
    if (project.mediaType === 'video' && (!videoUrl || !videoRef.current)) {
      setValidation('Please re-attach the original video before exporting.');
      return;
    }

    if (project.mediaType === 'video' && videoRef.current) {
      setExporting(true);
      setExportProgress(0);
      exportAbortRef.current = new AbortController();
      
      try {
        const { width, height } = getDimensions(project.format);
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Could not create canvas context');

        const ns = 'export';
        const bgSvg = buildHypeCardSvg(project, 'bg', ns);
        const fgSvg = buildHypeCardSvg(project, 'fg', ns);
        const clipInfo = getPhotoClipInfo(project, ns);

        // Load background and foreground as images
        const [bgImg, fgImg] = await Promise.all([
          svgToImage(bgSvg, width, height),
          svgToImage(fgSvg, width, height)
        ]);

        const video = videoRef.current;
        const originalTime = video.currentTime;
        
        const { blob, ext, audioIncluded } = await exportVideoCanvas(
          canvas,
          video,
          30,
          (progress) => setExportProgress(progress),
          exportAbortRef.current.signal,
          includeAudio,
          project.trimStart,
          project.trimEnd,
          (ctx, v) => {
            // Draw BG
            ctx.drawImage(bgImg, 0, 0, width, height);
            
            // Draw Video
            ctx.save();
            // Create Path for clip
            const p = new Path2D();
            if (project.format !== 'card') {
              const frame = getPhotoFrame(project.format);
              p.roundRect(frame.x, frame.y, frame.width, frame.height, frame.radius);
            } else {
              const frame = STADIUM_MEDIA_FRAME;
              p.roundRect(frame.x, frame.y, frame.width, frame.height, frame.radius);
            }
            ctx.clip(p);

            // Draw video with transform
            ctx.translate(clipInfo.cx, clipInfo.cy);
            ctx.rotate((project.photoTransform.rotation * Math.PI) / 180);
            ctx.scale(project.photoTransform.flip ? -1 : 1, 1);
            ctx.translate(-clipInfo.cx, -clipInfo.cy);
            ctx.filter = `brightness(${project.adjustments.brightness}) contrast(${project.adjustments.contrast}) saturate(${project.adjustments.saturation})`;
            drawVideoContain(ctx, v, clipInfo.x, clipInfo.y, clipInfo.w, clipInfo.h);
            ctx.restore();
            
            // Draw FG
            ctx.drawImage(fgImg, 0, 0, width, height);
          }
        );
        
        video.currentTime = originalTime; // restore playback

        const a = document.createElement('a');
        const downloadUrl = URL.createObjectURL(blob);
        a.href = downloadUrl;
        a.download = `hype_card_${Date.now()}.${ext}`;
        a.click();
        window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
        if (ext === 'webm') {
          setNotice('Exported as WebM because MP4 encoding is not supported in this browser. If this video does not play on your phone, try exporting from a different browser like Chrome.');
        } else if (includeAudio && !audioIncluded) {
          setNotice('The video exported without sound because this browser could not capture the clip audio.');
        }
      } catch (err: any) {
        if (err.message !== 'Export cancelled') {
          console.error(err);
          setNotice(err.message || 'Export failed.');
        }
      } finally {
        setExporting(false);
      }
    } else {
      // Fallback to existing image export...
      try {
        const dimensions = getDimensions(project.format);
        const svg = buildHypeCardSvg(project);
        const { dataUrl, extension } = await rasterizeSvgForDownload(
          svg,
          dimensions.width,
          dimensions.height,
          imageFormat,
        );
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = `hype_card_${Date.now()}.${extension}`;
        a.click();
      } catch {
        setNotice('Could not generate the card for download.');
      }
    }
  };

  const handleCancelExport = () => {
    if (exportAbortRef.current) {
      exportAbortRef.current.abort();
    }
  };

  const shareUrlFor = (share: HypeCardShare) => {
    const cleanBase = import.meta.env.BASE_URL.replace(/\/$/, '');
    const origin = ['pixlsports.com', 'www.pixlsports.com'].includes(window.location.hostname.toLowerCase())
      ? 'https://pixlsports.com'
      : window.location.origin;
    return `${origin}${cleanBase}/h/${share.shareToken}`;
  };

  const handleShare = async () => {
    setValidation('');
    setNotice('');
    if (!isSignedIn) {
      setLocation('/sign-in');
      return;
    }
    if (project.mediaType !== 'video' || !videoUrl || !videoRef.current) {
      setValidation('Interactive share links require an attached video. PNG and JPG exports remain static.');
      return;
    }
    setSharing(true);
    setShareProgress(0);
    try {
      const prepared = await prepareHypeCardShareMedia(videoRef.current, project, setShareProgress);
      const videoContentType = prepared.videoContentType.startsWith('video/mp4') ? 'video/mp4' : 'video/webm';
      const [videoUpload, posterUpload] = await Promise.all([
        requestHypeCardShareUploadUrl({ mediaKind: 'video', contentType: videoContentType }),
        requestHypeCardShareUploadUrl({ mediaKind: 'poster', contentType: 'image/jpeg' }),
      ]);
      const uploadResponses = await Promise.all([
        fetch(videoUpload.uploadUrl, { method: 'PUT', headers: { 'Content-Type': videoContentType }, body: prepared.video }),
        fetch(posterUpload.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: prepared.poster }),
      ]);
      if (uploadResponses.some((response) => !response.ok)) throw new Error('The prepared media could not be uploaded.');

      const duration = Math.max(0.1, project.trimEnd - project.trimStart);
      const shareProject: HypeCardProject = {
        ...project,
        mediaType: 'video',
        mediaId: null,
        photo: null,
        trimStart: 0,
        trimEnd: duration,
        videoMeta: {
          name: project.videoMeta?.name || 'Hype Card highlight',
          type: videoContentType,
          size: prepared.video.size,
          duration,
        },
      };
      const created = await createHypeShare.mutateAsync({
        data: {
          title: `${project.playerName || project.teamName || 'Pixl Sports'} · ${project.headline}`,
          slug: slugify(`${project.teamName}-${project.playerName}-${project.headline}`).slice(0, 80),
          manifest: { version: 1, shareKey, project: shareProject },
          videoUploadClaimId: videoUpload.claimId,
          posterUploadClaimId: posterUpload.claimId,
        },
      });
      if (existingShare && existingShare.shareToken !== created.shareToken) {
        await deleteHypeShare.mutateAsync({ shareToken: existingShare.shareToken }).catch(() => undefined);
      }
      setPublishedShare(created);
      await queryClient.invalidateQueries({ queryKey: getListHypeCardSharesQueryKey() });
      const url = shareUrlFor(created);
      try {
        if (navigator.share) await navigator.share({ title: created.title, text: 'Watch this Pixl Sports Hype Card', url });
        else await navigator.clipboard.writeText(url);
      } catch {
        await navigator.clipboard.writeText(url).catch(() => undefined);
      }
      setNotice('Interactive link published for 30 days. The link is ready to share.');
    } catch (error) {
      console.error(error);
      setNotice(error instanceof Error ? error.message : 'Could not publish the interactive Hype Card.');
    } finally {
      setSharing(false);
    }
  };

  const revokeShare = async () => {
    if (!existingShare || !window.confirm('Revoke this link and remove its shared clip and poster?')) return;
    try {
      await deleteHypeShare.mutateAsync({ shareToken: existingShare.shareToken });
      setPublishedShare(null);
      await queryClient.invalidateQueries({ queryKey: getListHypeCardSharesQueryKey() });
      setNotice('Interactive link revoked and shared media removed.');
    } catch {
      setNotice('The interactive link could not be revoked.');
    }
  };


  return (
    <div className="moment-studio flex min-h-[100dvh] flex-col bg-muted sm:fixed sm:inset-0 sm:h-auto sm:min-h-0 sm:overflow-hidden">
      <header className="sticky top-0 z-40 flex min-h-14 shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-background px-3 py-2 sm:static sm:px-4">
        <div className="flex min-w-0 basis-full items-center gap-2 sm:gap-3 xl:basis-auto xl:flex-1">
          <Link href="/studio" className="grid h-9 w-9 shrink-0 place-items-center border border-border bg-background hover:border-primary hover:bg-muted clip-angled-sm transition-colors" aria-label="Back to studio">
            <ArrowLeft className="h-4 w-4" />
          </Link>
           <h1 className="min-w-0 truncate font-display text-lg tracking-wide text-foreground sm:text-xl">Hype Cards</h1>
           <div className="ml-auto flex shrink-0 items-center gap-2 sm:ml-4">
             <div className={`hidden items-center gap-2 whitespace-nowrap px-3 py-1.5 text-xs font-bold uppercase tracking-widest clip-angled-sm border sm:flex ${saveStatus === 'Saving' ? 'bg-primary/10 text-primary border-primary/20' : saveStatus === 'Save failed' ? 'bg-destructive/10 text-destructive border-destructive/20' : saveStatus === 'Conflict' ? 'bg-orange-500/10 text-orange-500 border-orange-500/20' : 'bg-muted text-muted-foreground border-border'}`}>
               {saveStatus === 'Saving' ? <RotateCw className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
               {saveStatus}
             </div>
              {!cloudProjectId && (
                <button type="button" onClick={saveToCloud} disabled={createProject.isPending} aria-label="Save design to cloud" title="Save design to cloud" className="flex min-h-10 items-center gap-2 px-3 py-1.5 text-xs font-bold uppercase tracking-widest clip-angled-sm bg-foreground text-background hover:bg-primary hover:text-primary-foreground transition-colors border border-transparent">
                 <Save className="h-3 w-3" /> <span className="hidden sm:inline">Save design</span>
               </button>
             )}
           </div>
        </div>
         <div className="flex min-w-0 basis-full flex-wrap items-center justify-end gap-2 xl:basis-auto">
 <div className="flex min-w-0 flex-wrap justify-end gap-2">
             <Button variant="outline" className="hidden min-h-10 gap-2 whitespace-nowrap rounded-none clip-angled-sm sm:flex" onClick={async () => {
              try {
                const portableProject = await getPortableProject();
                const str = serializeHypeCardTemplate(portableProject);
                const blob = new Blob([str], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${slugify(project.playerName || 'project')}.lmx`;
                a.click();
                window.setTimeout(() => URL.revokeObjectURL(url), 1000);
                 setNotice(`${PORTABLE_TEMPLATE_MEDIA_NOTE} Re-add media after opening.`);
              } catch (error) {
                setNotice(error instanceof Error ? error.message : 'Could not prepare the project file.');
              }
            }}>
              <Save className="h-4 w-4" /> Save template
            </Button>
             <label className="hidden cursor-pointer sm:block">
               <span className="flex h-10 items-center gap-2 whitespace-nowrap border border-border bg-background px-4 text-sm font-medium hover:border-primary hover:bg-muted clip-angled-sm transition-colors">
                <FolderOpen className="h-4 w-4" /> Open...
              </span>
              <input type="file" accept=".lmx,application/json" className="sr-only" onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                try {
                  const text = await readProjectFile(file);
                   const reopened = parseHypeCardTemplate(text);
                    if (reopened) {
                      setProject(reopened);
                      setTemplateMediaNotice(true);
                      setNotice(`Template opened. Your design text and layout were restored. ${PORTABLE_TEMPLATE_MEDIA_NOTE} Add media again before exporting.`);
                    }
                   else setNotice('That file is not a valid Hype Card project.');
                } catch {
                  setNotice('Could not open that file.');
                }
              }} />
            </label>
             <Button onClick={handleExport} disabled={exporting} className="min-h-10 gap-2 whitespace-nowrap rounded-none bg-primary font-bold text-primary-foreground hover:bg-primary/90 clip-angled-sm">
              {exporting ? 'Exporting...' : <Download className="h-4 w-4" />}
              {exporting ? `${Math.round(exportProgress * 100)}%` : 'Export'}
            </Button>
             <Button variant="outline" onClick={handleShare} disabled={sharing || exporting} className="min-h-10 gap-2 rounded-none clip-angled-sm" aria-label={existingShare ? 'Replace interactive share link' : 'Share interactive Hype Card'} title={existingShare ? 'Replace interactive share link' : 'Share interactive Hype Card'}>
              <Share2 className="h-4 w-4" />
              <span className="hidden sm:inline">{sharing ? `${Math.round(shareProgress * 100)}%` : existingShare ? 'Replace link' : 'Share'}</span>
            </Button>
            {exporting && (
              <Button variant="outline" size="icon" onClick={handleCancelExport} className="rounded-xl border-destructive text-destructive">
                <X className="h-4 w-4" />
              </Button>
            )}
            <Button variant="outline" size="icon" onClick={() => setMobilePreviewOpen(true)} className="rounded-none clip-angled-sm sm:hidden" aria-label="Preview">
              <Eye className="h-4 w-4" />
            </Button>
           </div>
        </div>
      </header>

      {validation && (
        <div className="flex shrink-0 items-start gap-2 border-b border-destructive/20 bg-destructive/10 px-4 py-2 text-xs font-bold leading-relaxed text-destructive" role="alert">
          <span>{validation}</span>
        </div>
      )}

      {notice && (
        <div className="flex shrink-0 items-center justify-between border-b border-border bg-destructive px-4 py-2 text-sm font-bold text-destructive-foreground">
          {notice}
          <button type="button" onClick={() => setNotice('')}><X className="h-4 w-4" /></button>
        </div>
      )}

      {existingShare && (
        <div className="flex shrink-0 flex-col gap-2 border-b border-primary/25 bg-primary/10 px-4 py-3 text-sm sm:flex-row sm:items-center">
          <span className="shrink-0 text-xs font-bold uppercase tracking-widest text-primary">Interactive link</span>
          <input readOnly value={shareUrlFor(existingShare)} onFocus={(event) => event.currentTarget.select()} className="min-w-0 flex-1 border border-primary/25 bg-background px-3 py-2 text-xs font-medium" aria-label="Interactive Hype Card share link" />
          <Button type="button" size="sm" variant="outline" className="rounded-none" onClick={() => navigator.clipboard.writeText(shareUrlFor(existingShare)).then(() => setNotice('Share link copied.')).catch(() => setNotice('Select and copy the link above.'))}><Clipboard className="mr-2 h-4 w-4" /> Copy</Button>
          <Button type="button" size="sm" variant="outline" className="rounded-none text-destructive" onClick={revokeShare} disabled={deleteHypeShare.isPending}><Link2Off className="mr-2 h-4 w-4" /> Revoke</Button>
        </div>
      )}

      {autosaveWarning && (
        <div className="flex shrink-0 items-center justify-between border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-950">
          {autosaveWarning}
          <button type="button" onClick={() => setAutosaveWarning('')} aria-label="Dismiss autosave warning"><X className="h-4 w-4" /></button>
        </div>
      )}

      <div className="flex flex-col sm:min-h-0 sm:flex-1 sm:flex-row">
        <aside className="hype-walkthrough-panel w-full flex-shrink-0 border-r border-border bg-background sm:min-h-0 sm:w-[460px] sm:overflow-y-auto sm:overscroll-contain lg:w-[500px] xl:w-[520px]">
          <div className="flex flex-col gap-6 p-5">
            <div className="border-b border-border pb-5">
              <div className="mb-3 flex items-end justify-between gap-3">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary">Hype Card Walkthrough</p>
                  <p className="mt-1 text-xs font-medium text-muted-foreground">One design choice at a time.</p>
                </div>
                <span className="shrink-0 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                  {walkthroughStep + 1} / {hypeWalkthroughSteps.length}
                </span>
              </div>
              <div className="mb-3 h-1 overflow-hidden bg-muted" aria-hidden="true">
                <div className="h-full bg-primary transition-all" style={{ width: `${((walkthroughStep + 1) / hypeWalkthroughSteps.length) * 100}%` }} />
              </div>
              <div className="flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="Hype Card walkthrough steps">
                {hypeWalkthroughSteps.map((step, index) => (
                  <button
                    key={step.label}
                    type="button"
                    role="tab"
                    aria-selected={walkthroughStep === index}
                    onClick={() => setWalkthroughStep(index)}
                    className={`shrink-0 border px-2 py-1.5 text-[10px] font-bold uppercase tracking-wide transition-colors ${walkthroughStep === index ? 'border-primary bg-primary text-primary-foreground' : index < walkthroughStep ? 'border-primary/40 bg-primary/5 text-primary' : 'border-border bg-background text-muted-foreground hover:border-primary/50'}`}
                  >
                    {index + 1}. {step.label}
                  </button>
                ))}
              </div>
              <p className="mt-3 text-xs font-medium text-muted-foreground">
                {hypeWalkthroughSteps[walkthroughStep].hint}
              </p>
            </div>

            {walkthroughStep === 0 && <Section title="Moment" icon={Lightbulb}>
              <div className="flex flex-wrap gap-2">
                {HEADLINES.map((h) => (
                  <button
                    key={h}
                    type="button"
                    data-testid={`button-moment-${slugify(h)}`}
                    onClick={() => updateProject('headline', h)}
                    className={`rounded-xl border px-3 py-2 text-xs font-bold transition-all ${project.headline === h ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background hover:border-primary/60 hover:bg-muted'}`}
                  >
                    {h}!
                  </button>
                ))}
              </div>
              <div className="mt-4">
                <HypeField
                  label="Custom moment"
                  value={project.headline}
                  onChange={(value) => updateProject('headline', value)}
                  placeholder="e.g. GAME WINNER"
                />
                <p className="mt-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Use your own moment text or choose a preset above.</p>
              </div>
            </Section>}

            {walkthroughStep === 1 && <Section title="Media" icon={ImagePlus}>
              <p className="mb-4 text-xs text-muted-foreground">Add a photo or a video up to 120MB. Videos are prepared locally as a smaller MP4 when supported, and exports are limited to a 15-second selection. Media never leaves this device.</p>
              {cloudProjectId && !project.mediaType && (
                <p className="mb-4 border-l-2 border-primary bg-primary/5 px-3 py-2 text-xs font-medium text-foreground" data-testid="text-design-only-media-prompt">
                  This saved design does not include media. Add a photo or video before exporting.
                </p>
              )}
              {templateMediaNotice && !project.mediaType && (
                <p className="mb-4 border-l-2 border-primary bg-primary/5 px-3 py-2 text-xs font-medium text-foreground" data-testid="text-portable-template-media-notice">
                  {PORTABLE_TEMPLATE_MEDIA_NOTE} Add a photo or video before exporting.
                </p>
              )}
              <AssetButton
                label="Media"
                hasAsset={Boolean(project.mediaType)}
                onChange={handleMediaUpload}
                onRemove={handleMediaRemove}
              />
              {project.mediaType && (
                <div className="mt-4 rounded-xl border border-border bg-muted/50 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <Label className="text-xs font-bold">Crop & Position</Label>
                    <button type="button" onClick={() => setProject((c) => ({ ...c, photoTransform: defaultProject().photoTransform }))} className="text-[10px] font-bold text-muted-foreground hover:text-foreground">Reset</button>
                  </div>
                  <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-4">
                    <ZoomIn className="h-3.5 w-3.5 text-muted-foreground" />
                    <Slider value={[project.photoTransform.zoom]} min={0.5} max={3} step={0.01} onValueChange={([v]) => updateTransform('zoom', v)} />
                    <Move className="h-3.5 w-3.5 text-muted-foreground" />
                    <div className="grid grid-cols-2 gap-2">
                      <Slider value={[project.photoTransform.x]} min={-500} max={500} step={1} onValueChange={([v]) => updateTransform('x', v)} />
                      <Slider value={[project.photoTransform.y]} min={-500} max={500} step={1} onValueChange={([v]) => updateTransform('y', v)} />
                    </div>
                  </div>
                  <div className="mt-4 flex gap-2">
                    <Button type="button" variant="outline" size="sm" className="flex-1 gap-2" onClick={() => updateTransform('rotation', (project.photoTransform.rotation + 90) % 360)}>
                      <RotateCw className="h-3.5 w-3.5" /> Rotate
                    </Button>
                    <Button type="button" variant="outline" size="sm" className="flex-1 gap-2" onClick={() => updateTransform('flip', !project.photoTransform.flip)}>
                      <FlipHorizontal2 className="h-3.5 w-3.5" /> Flip
                    </Button>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowAdvanced((open) => !open)}
                    className="mt-4 flex w-full items-center justify-between border-t border-border pt-3 text-xs font-bold"
                  >
                    <span className="flex items-center gap-2"><SlidersHorizontal className="h-3.5 w-3.5" /> Image adjustments</span>
                    <span>{showAdvanced ? 'Hide' : 'Show'}</span>
                  </button>
                  {showAdvanced && (
                    <div className="mt-4 grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-4">
                      <Label className="text-[10px] uppercase tracking-wide">Brightness</Label>
                      <Slider value={[project.adjustments.brightness]} min={0.5} max={1.5} step={0.01} onValueChange={([v]) => updateAdjustment('brightness', v)} />
                      <Label className="text-[10px] uppercase tracking-wide">Contrast</Label>
                      <Slider value={[project.adjustments.contrast]} min={0.5} max={1.5} step={0.01} onValueChange={([v]) => updateAdjustment('contrast', v)} />
                      <Label className="text-[10px] uppercase tracking-wide">Color</Label>
                      <Slider value={[project.adjustments.saturation]} min={0} max={2} step={0.01} onValueChange={([v]) => updateAdjustment('saturation', v)} />
                    </div>
                  )}
                </div>
              )}
              {project.mediaType === 'video' && (
                <div className="mt-3 space-y-3 rounded-lg bg-muted px-3 py-3">
                  <div className="space-y-3 border-b border-border pb-3">
                    <div className="flex items-center justify-between gap-3">
                      <Label className="text-xs font-medium">Trim video</Label>
                      <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                        {formatVideoTime(project.trimStart)}–{formatVideoTime(project.trimEnd)}
                      </span>
                    </div>
                    <div className="grid grid-cols-[3rem_1fr] items-center gap-3">
                      <Label className="text-[10px] uppercase tracking-wide">Start</Label>
                      <Slider
                        value={[project.trimStart]}
                        min={0}
                        max={Math.max(0.1, (project.videoMeta?.duration ?? 15) - 0.1)}
                        step={0.1}
                        onValueChange={([value]) => updateTrim('start', value)}
                        aria-label="Video trim start"
                      />
                      <Label className="text-[10px] uppercase tracking-wide">End</Label>
                      <Slider
                        value={[project.trimEnd]}
                        min={0.1}
                        max={Math.max(0.1, project.videoMeta?.duration ?? 15)}
                        step={0.1}
                        onValueChange={([value]) => updateTrim('end', value)}
                        aria-label="Video trim end"
                      />
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      Selected length: {(project.trimEnd - project.trimStart).toFixed(1)}s. Exports can be up to 15 seconds.
                    </p>
                  </div>
                  <p className="text-[11px] font-medium text-muted-foreground" data-testid="text-video-export-support">
                    {exportSupport.mp4Mime
                      ? 'This browser will export a phone-ready MP4.'
                      : exportSupport.webmMime
                        ? 'This browser will export WebM. For MP4, use a browser that supports MP4 recording.'
                        : 'Video export is not supported in this browser. You can still edit and preview the card.'}
                  </p>
                  <p className="text-[10px] text-muted-foreground">Original sound is included when this browser exposes the clip audio for recording.</p>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="include-audio" className="text-xs font-medium">Keep original sound</Label>
                    <Switch id="include-audio" checked={includeAudio} onCheckedChange={setIncludeAudio} />
                  </div>
                </div>
              )}
              {project.mediaType === 'image' && (
                <div className="mt-3 flex items-center justify-between rounded-lg bg-muted px-3 py-2">
                  <Label className="text-xs font-medium">Download format</Label>
                  <div className="flex gap-1" role="group" aria-label="Image download format">
                    {(['png', 'jpeg'] as const).map((format) => (
                      <button
                        key={format}
                        type="button"
                        onClick={() => setImageFormat(format)}
                        className={`rounded-md px-2 py-1 text-[10px] font-bold uppercase ${imageFormat === format ? 'bg-primary text-primary-foreground' : 'bg-background text-foreground'}`}
                      >
                        {format === 'jpeg' ? 'JPG' : 'PNG'}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </Section>}

            {walkthroughStep === 2 && <Section title="Details" icon={FileImage}>
              <div className="flex flex-col gap-4">
                <HypeField label="Player name" value={project.playerName} onChange={(v) => updateProject('playerName', v)} placeholder="e.g. Jordan Smith" />
                <div className="grid grid-cols-2 gap-4">
                  <HypeField label="Jersey number" value={project.jerseyNumber} onChange={(v) => updateProject('jerseyNumber', v)} placeholder="e.g. 12" />
                  <HypeField label="Position" value={project.position} onChange={(v) => updateProject('position', v)} placeholder="e.g. Point guard" />
                </div>
                <HypeField label="Team name" value={project.teamName} onChange={(v) => updateProject('teamName', v)} placeholder="e.g. Eastside Falcons" />
                  <div className="flex items-center justify-between rounded-lg border border-border bg-muted/50 px-3 py-3">
                    <div>
                      <Label htmlFor="show-lower-third" className="text-xs font-medium">Show lower third text</Label>
                      <p className="mt-1 text-[10px] text-muted-foreground">Show the player and team details at the bottom of the card.</p>
                    </div>
                    <Switch
                      id="show-lower-third"
                      checked={project.showLowerThird}
                      onCheckedChange={(checked) => updateProject('showLowerThird', checked)}
                      aria-label="Show lower third text"
                    />
                  </div>
              </div>
            </Section>}

            {walkthroughStep === 3 && <Section title="Format" icon={SlidersHorizontal}>
              <div className="rounded-xl border border-primary bg-primary/5 p-4 ring-1 ring-primary/30" data-testid="portrait-format">
                <span className="block text-xs font-bold">Portrait card</span>
                <span className="mt-1 block text-[10px] text-muted-foreground">1000 × 1400 · Fixed output</span>
              </div>
              <p className="mt-2 text-[10px] font-medium text-muted-foreground">
                Hype Cards use the portrait layout for every export.
              </p>
            </Section>}

            {walkthroughStep === 4 && <Section title="Layout" icon={LayoutGrid}>
              <div className="grid grid-cols-1 gap-3">
                {cardLayouts.map((l) => (
                  <LayoutOption key={l.id} layout={l} project={project} selected={project.layout === l.id && project.format === 'card'} onSelect={() => { updateProject('layout', l.id); updateProject('format', 'card'); }} />
                ))}
              </div>
            </Section>}

            {walkthroughStep === 5 && <Section title="Palette" icon={Palette}>
              <div className="flex flex-col gap-2">
                {Object.entries(palettes).map(([id, p]) => (
                  <button key={id} type="button" onClick={() => updateProject('palette', id as PaletteId)} className={`flex items-center justify-between rounded-xl border p-2 pl-3 transition-colors ${project.palette === id ? 'border-primary bg-primary/5 ring-1 ring-primary/30' : 'border-border bg-background hover:bg-muted'}`}>
                    <span className="text-xs font-bold">{p.name}</span>
                    <div className="flex shrink-0 -space-x-1.5 overflow-hidden">
                      {[p.primary, p.secondary, p.accent].map((c, i) => (
                        <span key={i} className="inline-block h-6 w-6 rounded-full border-2 border-background" style={{ backgroundColor: c }} />
                      ))}
                    </div>
                  </button>
                ))}
              </div>
            </Section>}

            {walkthroughStep === 6 && (
              <section className="border-t border-border pt-6">
                <div className="mb-5 flex items-center gap-2">
                  <Check className="h-5 w-5 text-primary" />
                  <h2 className="text-sm font-bold uppercase tracking-widest text-foreground">Ready to export</h2>
                </div>
                <div className="space-y-3">
                  {[
                    ['Moment', project.headline || 'BIG PLAY'],
                    ['Player', project.playerName || 'Your player'],
                    ['Team', project.teamName || 'Your team'],
                    ['Output', 'Portrait card'],
                  ].map(([label, value]) => (
                    <div key={label} className="flex items-center justify-between gap-4 border-b border-border py-2">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</span>
                      <span className="text-right text-sm font-bold text-foreground">{value}</span>
                    </div>
                  ))}
                </div>
                <p className="mt-5 text-xs font-medium leading-relaxed text-muted-foreground">
                  Your design updates instantly in the preview. You can go back to any step before exporting.
                </p>
                <Button type="button" onClick={handleExport} disabled={exporting} className="mt-5 w-full gap-2 rounded-none bg-primary font-bold text-primary-foreground hover:bg-primary/90 clip-angled-sm">
                  <Download className="h-4 w-4" /> {exporting ? `${Math.round(exportProgress * 100)}%` : 'Export card'}
                </Button>
              </section>
            )}

            <div className="mt-auto flex items-center justify-end gap-3 border-t border-border pt-5">
              {walkthroughStep > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setWalkthroughStep((step) => Math.max(0, step - 1))}
                  className="mr-auto rounded-none clip-angled-sm"
                >
                  Back
                </Button>
              )}
              {walkthroughStep < hypeWalkthroughSteps.length - 1 ? (
                <Button
                  type="button"
                  onClick={() => setWalkthroughStep((step) => Math.min(hypeWalkthroughSteps.length - 1, step + 1))}
                  className="rounded-none bg-foreground text-background hover:bg-primary hover:text-primary-foreground clip-angled-sm"
                >
                  Next: {hypeWalkthroughSteps[walkthroughStep + 1].label}
                </Button>
              ) : (
                <Button type="button" variant="outline" onClick={() => setWalkthroughStep(0)} className="rounded-none clip-angled-sm">
                  Start over
                </Button>
              )}
            </div>
          </div>
        </aside>

        <main className="block h-[72dvh] max-h-[720px] min-h-[520px] shrink-0 overflow-hidden p-4 sm:h-auto sm:min-h-0 sm:max-h-none sm:flex-1 sm:p-8">
          <div className="mx-auto h-full max-w-[800px]">
            <PreviewCanvas project={project} videoUrl={videoUrl} videoRef={videoRef} />
          </div>
        </main>
      </div>

      <MobilePreviewDialog project={project} videoUrl={videoUrl} open={mobilePreviewOpen} onOpenChange={setMobilePreviewOpen} title={project.headline} />
    
      {saveStatus === 'Conflict' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-card border border-destructive p-6 shadow-2xl clip-angled-sm text-center">
            <div className="mx-auto grid h-12 w-12 place-items-center bg-destructive/10 text-destructive rounded-full mb-4">
              <RotateCw className="h-6 w-6" />
            </div>
            <h2 className="font-display text-2xl uppercase tracking-wide text-foreground">Sync Conflict</h2>
            <p className="mt-2 text-sm font-medium text-muted-foreground">This project was modified from another device or session. Do you want to load the newest server version and lose local changes, or keep your local changes and save them as a new project?</p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <button type="button" onClick={() => resolveConflict('server')} className="flex-1 bg-muted text-foreground py-3 text-sm font-bold uppercase tracking-wider clip-angled-sm hover:bg-destructive hover:text-destructive-foreground transition-colors">
                Load Server Version
              </button>
              <button type="button" onClick={() => resolveConflict('new')} className="flex-1 bg-primary text-primary-foreground py-3 text-sm font-bold uppercase tracking-wider clip-angled-sm hover:opacity-90 transition-opacity">
                Save as New
              </button>
            </div>
          </div>
        </div>
      )}
</div>
  );
}

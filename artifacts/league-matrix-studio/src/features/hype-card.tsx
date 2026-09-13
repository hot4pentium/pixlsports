import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import {
  ArrowLeft, Check, Download, Eye, FileImage, FlipHorizontal2, FolderOpen, ImagePlus,
  LayoutGrid, Lightbulb, Maximize2, Move, Palette, RotateCw, Save, ShieldCheck, SlidersHorizontal, Upload, X, ZoomIn, Play, Pause, Volume2, VolumeX, RotateCcw
} from 'lucide-react';
import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';

import {
  HypeCardProject, HypeFormat, TemplateId, CardLayoutId, PaletteId,
  HEADLINES, templates, cardLayouts, formats, palettes, defaultProject, getDimensions
} from './hype-card-types';
import { buildHypeCardSvg, getPhotoClipInfo, SvgLayer, getPhotoFrame, STADIUM_MEDIA_FRAME } from './hype-card-svg';
import { saveVideoBlob, loadVideoBlob, deleteVideoBlob, checkExportSupport } from './hype-card-media';
import { exportVideoCanvas } from './hype-card-export';


function svgToImage(svg: string, width: number, height: number): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.width = width;
    img.height = height;
    img.onload = () => {
      resolve(img);
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      reject(new Error('Failed to load SVG into image'));
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}

function drawVideoCover(
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
  let sx = 0;
  let sy = 0;
  let sw = sourceWidth;
  let sh = sourceHeight;
  if (sourceRatio > targetRatio) {
    sw = sourceHeight * targetRatio;
    sx = (sourceWidth - sw) / 2;
  } else {
    sh = sourceWidth / targetRatio;
    sy = (sourceHeight - sh) / 2;
  }
  context.drawImage(video, sx, sy, sw, sh, x, y, width, height);
}

function slugify(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'hype-card';
}

function readProjectFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read that project file.'));
    reader.readAsText(file);
  });
}

function isProject(value: unknown): value is { tool: string; project: HypeCardProject } {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { tool?: unknown; project?: unknown };
  return candidate.tool === 'hype-card' && Boolean(candidate.project) && typeof candidate.project === 'object';
}

function isSafeRasterDataUrl(url: string | null): boolean {
  if (!url) return false;
  return /^data:image\/(jpeg|png|webp|gif);base64,/.test(url);
}

function normalizeProject(project: any): HypeCardProject {
  const defaults = defaultProject();
  const safePhoto = isSafeRasterDataUrl(project.photo) ? project.photo : null;
  const safeLogo = isSafeRasterDataUrl(project.logo) ? project.logo : null;
  const isLegacy = project.version === 1;
  const mediaType = isLegacy
    ? (safePhoto ? 'image' : null)
    : (project.mediaType === 'image' || project.mediaType === 'video' ? project.mediaType : null);
  return {
    ...defaults,
    ...project,
    version: 2,
    headline: HEADLINES.includes(project.headline) ? project.headline : defaults.headline,
    mediaType,
    mediaId: mediaType === 'video' && typeof project.mediaId === 'string' ? project.mediaId : null,
    videoMeta: mediaType === 'video' && project.videoMeta && typeof project.videoMeta === 'object'
      ? {
          name: String(project.videoMeta.name || 'Attached video'),
          type: String(project.videoMeta.type || ''),
          size: Number(project.videoMeta.size) || 0,
          duration: Number(project.videoMeta.duration) || 0,
        }
      : null,
    layout: project.layout ?? defaults.layout,
    finish: defaults.finish,
    photoTransform: { ...defaults.photoTransform, ...project.photoTransform },
    adjustments: { ...defaults.adjustments, ...project.adjustments },
    visibility: { ...defaults.visibility, ...project.visibility },
    photo: safePhoto,
    logo: safeLogo,
  };
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
      project.grade,
      project.stat,
      project.achievement,
      project.coachMessage,
      project.logo,
      project.visibility.grade,
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

function PreviewArtwork({
  project,
  videoUrl,
  videoRef,
  ns,
  testId,
}: {
  project: HypeCardProject;
  videoUrl?: string;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
  ns: string;
  testId: string;
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
            className="absolute max-w-none object-cover"
            autoPlay
            loop
            muted
            playsInline
            style={mediaStyle}
          />
        ) : (
          <img
            src={project.photo ?? ''}
            alt=""
            className="absolute max-w-none object-cover"
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
  onExpand,
}: {
  project: HypeCardProject;
  videoUrl?: string;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
  onExpand: () => void;
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
      if (isPlaying) videoRef.current.play().catch(() => setIsPlaying(false));
      else videoRef.current.pause();
    }
  }, [isPlaying, videoUrl, videoRef]);

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
          className="relative z-10 cursor-zoom-in overflow-hidden shadow-2xl clip-angled focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary"
          style={{
            aspectRatio: `${dimensions.width}/${dimensions.height}`,
            width: previewWidth || '100%',
            height: previewHeight || 'auto',
            maxWidth: 760,
          }}
          role="button"
          tabIndex={0}
          aria-label="Expand card preview"
          onClick={onExpand}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onExpand();
            }
          }}
        >
          <PreviewArtwork project={project} videoUrl={videoUrl} videoRef={videoRef} ns={ns} testId="hype-preview-canvas" />
          <span className="pointer-events-none absolute right-4 top-4 z-30 flex items-center gap-2 bg-foreground/85 px-3 py-2 text-xs font-bold uppercase tracking-widest text-background opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 clip-angled-sm">
            <Maximize2 className="h-4 w-4" />
            Expand
          </span>
        </div>
      </div>
      
      {project.mediaType === 'video' && videoUrl && (
        <div className="absolute bottom-6 left-1/2 z-20 -translate-x-1/2 flex items-center gap-2 bg-foreground/90 p-2 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 clip-angled-sm shadow-xl border border-white/10">
          <button type="button" data-testid="button-play-pause" onClick={() => setIsPlaying(!isPlaying)} className="grid h-10 w-10 place-items-center bg-white/10 text-white hover:bg-primary hover:text-primary-foreground clip-angled-sm transition-colors" aria-label={isPlaying ? 'Pause' : 'Play'}>
            {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
          </button>
          <button type="button" data-testid="button-restart" onClick={() => { if (videoRef?.current) { videoRef.current.currentTime = 0; videoRef.current.play().catch(()=>setIsPlaying(false)); setIsPlaying(true); } }} className="grid h-10 w-10 place-items-center bg-white/10 text-white hover:bg-primary hover:text-primary-foreground clip-angled-sm transition-colors" aria-label="Restart">
            <RotateCcw className="h-5 w-5" />
          </button>
          <button type="button" data-testid="button-mute-unmute" onClick={() => setIsMuted(!isMuted)} className="grid h-10 w-10 place-items-center bg-white/10 text-white hover:bg-primary hover:text-primary-foreground clip-angled-sm transition-colors" aria-label={isMuted ? 'Unmute' : 'Mute'}>
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
    video.muted = isMuted;
    if (isPlaying) {
      video.play().catch(() => setIsPlaying(false));
    } else {
      video.pause();
    }
  }, [isMuted, isPlaying, open, videoUrl]);

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
            className="relative z-10 overflow-hidden shadow-xl clip-angled"
            style={{
              aspectRatio: `${dimensions.width}/${dimensions.height}`,
              width: `${fittedWidth}px`,
              height: `${fittedHeight}px`,
            }}
            data-testid="mobile-hype-preview-canvas"
          >
            <PreviewArtwork project={project} videoUrl={videoUrl} videoRef={mobileVideoRef} ns={ns} testId="mobile-hype-preview-canvas" />
             {project.mediaType === 'video' && videoUrl && (
               <div className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 bg-foreground/90 p-2 clip-angled-sm border border-white/10 shadow-lg">
                 <button type="button" data-testid="button-play-pause" onClick={() => setIsPlaying((playing) => !playing)} className="grid h-10 w-10 place-items-center bg-white/10 text-white hover:bg-primary hover:text-primary-foreground clip-angled-sm transition-colors" aria-label={isPlaying ? 'Pause' : 'Play'}>
                   {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
                 </button>
                 <button type="button" data-testid="button-restart" onClick={() => {
                   const video = mobileVideoRef.current;
                   if (!video) return;
                   video.currentTime = 0;
                   video.play().catch(() => setIsPlaying(false));
                   setIsPlaying(true);
                 }} className="grid h-10 w-10 place-items-center bg-white/10 text-white hover:bg-primary hover:text-primary-foreground clip-angled-sm transition-colors" aria-label="Restart">
                   <RotateCcw className="h-5 w-5" />
                 </button>
                 <button type="button" data-testid="button-mute-unmute" onClick={() => setIsMuted((muted) => !muted)} className="grid h-10 w-10 place-items-center bg-white/10 text-white hover:bg-primary hover:text-primary-foreground clip-angled-sm transition-colors" aria-label={isMuted ? 'Unmute' : 'Mute'}>
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
  const [project, setProject] = useState<HypeCardProject>(() => {
    try {
      const stored = window.localStorage.getItem('leaguematrix-hype-card-project-v2');
      if (!stored) return defaultProject();
      const parsed = JSON.parse(stored) as { tool?: string; project?: any };
      return parsed.tool === 'hype-card' && parsed.project ? normalizeProject(parsed.project) : defaultProject();
    } catch {
      return defaultProject();
    }
  });

  const [notice, setNotice] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [mobilePreviewOpen, setMobilePreviewOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [validation, setValidation] = useState('');
  const [videoUrl, setVideoUrl] = useState<string | undefined>(undefined);
  const [exportSupport, setExportSupport] = useState(() => checkExportSupport());
  const [includeAudio, setIncludeAudio] = useState(true);
  const [imageFormat, setImageFormat] = useState<'png' | 'jpeg'>('png');
  const videoRef = useRef<HTMLVideoElement>(null);
  const exportAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const previousBodyOverflow = document.body.style.overflow;
    const previousRootOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousRootOverflow;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (project.mediaType !== 'video' || !project.mediaId) {
      setVideoUrl(undefined);
      return () => {
        cancelled = true;
      };
    }

    loadVideoBlob(project.mediaId).then((blob) => {
      if (!blob) {
        if (!cancelled) {
          setVideoUrl(undefined);
          setNotice('Could not find the attached video for this project. Please re-attach it.');
        }
        return;
      }
      const url = URL.createObjectURL(blob);
      if (cancelled) {
        URL.revokeObjectURL(url);
      } else {
        setVideoUrl(url);
      }
    }).catch((err) => {
      if (!cancelled) {
        console.error('Failed to load video blob', err);
        setNotice('Failed to load video from local storage.');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [project.mediaId, project.mediaType]);

  useEffect(() => {
    setExportSupport(checkExportSupport());
  }, [project.mediaType]);

  // Cleanup videoUrl on unmount or URL change
  useEffect(() => {
    return () => {
      if (videoUrl) URL.revokeObjectURL(videoUrl);
    };
  }, [videoUrl]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      try {
        window.localStorage.setItem('leaguematrix-hype-card-project-v2', JSON.stringify({ tool: 'hype-card', project }));
        window.localStorage.setItem('leaguematrix-project', 'true');
      } catch {
        setNotice('Your browser could not autosave this project. You can still download a project file.');
      }
    }, 400);
    return () => window.clearTimeout(timeout);
  }, [project]);

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

  const handleMediaUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    if (file.type.startsWith('video/')) {
      if (file.size > 75 * 1024 * 1024) {
        setNotice('Video is too large. Please choose a video under 75MB.');
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
        if (v.duration > 15.05) {
          throw new Error('Video is longer than 15 seconds. Please trim it and try again.');
        }

        await saveVideoBlob(id, file);
        if (project.mediaId && project.mediaType === 'video') {
          await deleteVideoBlob(project.mediaId).catch(console.warn);
        }
        setVideoUrl(url);
        
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
          videoMeta: { name: file.name, type: file.type, size: file.size, duration: v.duration },
          photo: poster,
          photoTransform: defaultProject().photoTransform,
          adjustments: defaultProject().adjustments
        }));
        setValidation('');
      } catch (err) {
        URL.revokeObjectURL(url);
        setNotice(err instanceof Error ? err.message : 'Could not save video to local storage.');
      }
    } else if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = async () => {
        const res = String(reader.result);
        if (!isSafeRasterDataUrl(res)) {
          setNotice('Please choose a valid PNG, JPG, WEBP, or GIF.');
          return;
        }
        if (project.mediaId && project.mediaType === 'video') {
          await deleteVideoBlob(project.mediaId).catch(console.warn);
        }
        setVideoUrl(undefined);
        setProject(curr => ({
          ...curr,
          mediaType: 'image',
          mediaId: null,
          videoMeta: null,
          photo: res,
          photoTransform: defaultProject().photoTransform,
          adjustments: defaultProject().adjustments
        }));
        setValidation('');
      };
      reader.onerror = () => setNotice('That image could not be loaded. Try another file.');
      reader.readAsDataURL(file);
    } else {
      setNotice('Please choose a PNG, JPG, WEBP, GIF, MP4, MOV, or WebM file.');
    }
  };

  const handleMediaRemove = async () => {
    if (project.mediaId && project.mediaType === 'video') {
      await deleteVideoBlob(project.mediaId).catch(console.warn);
    }
    setVideoUrl(undefined);
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
            drawVideoCover(ctx, v, clipInfo.x, clipInfo.y, clipInfo.w, clipInfo.h);
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
      const canvas = document.createElement('canvas');
      const dimensions = getDimensions(project.format);
      canvas.width = dimensions.width;
      canvas.height = dimensions.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        setNotice('Could not generate the card for download.');
        return;
      }
      try {
        const svg = buildHypeCardSvg(project);
        const img = await svgToImage(svg, dimensions.width, dimensions.height);
        ctx.drawImage(img, 0, 0, dimensions.width, dimensions.height);
        const a = document.createElement('a');
        const mimeType = imageFormat === 'png' ? 'image/png' : 'image/jpeg';
        const extension = imageFormat === 'png' ? 'png' : 'jpg';
        a.href = canvas.toDataURL(mimeType, imageFormat === 'jpeg' ? 0.95 : undefined);
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


  return (
    <div className="moment-studio flex h-[100dvh] flex-col overflow-hidden bg-muted sm:fixed sm:inset-0 sm:h-auto">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-background px-4">
        <div className="flex items-center gap-3">
          <Link href="/studio" className="grid h-9 w-9 place-items-center border border-border bg-background hover:border-primary hover:bg-muted clip-angled-sm transition-colors" aria-label="Back to studio">
            <ArrowLeft className="h-4 w-4" />
          </Link>
           <h1 className="font-display text-xl tracking-wide text-foreground">Hype Cards</h1>
        </div>
        <div className="flex items-center gap-2">
          {validation && <span className="hidden text-xs font-bold text-destructive sm:inline-block">{validation}</span>}
          <div className="flex gap-2">
            <Button variant="outline" className="hidden gap-2 rounded-none clip-angled-sm sm:flex" onClick={() => {
              const str = JSON.stringify({ tool: 'hype-card', project }, null, 2);
              const blob = new Blob([str], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `${slugify(project.playerName || 'project')}.lmx`;
              a.click();
               window.setTimeout(() => URL.revokeObjectURL(url), 1000);
            }}>
              <Save className="h-4 w-4" /> Save project
            </Button>
            <label className="hidden cursor-pointer sm:block">
              <span className="flex h-10 items-center gap-2 border border-border bg-background px-4 text-sm font-medium hover:border-primary hover:bg-muted clip-angled-sm transition-colors">
                <FolderOpen className="h-4 w-4" /> Open...
              </span>
              <input type="file" accept=".lmx,application/json" className="sr-only" onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                try {
                  const text = await readProjectFile(file);
                  const parsed = JSON.parse(text);
                  if (isProject(parsed)) setProject(normalizeProject(parsed.project));
                  else setNotice('That file is not a valid Hype Card project.');
                } catch {
                  setNotice('Could not open that file.');
                }
              }} />
            </label>
            <Button onClick={handleExport} disabled={exporting} className="gap-2 rounded-none bg-primary font-bold text-primary-foreground hover:bg-primary/90 clip-angled-sm">
              {exporting ? 'Exporting...' : <Download className="h-4 w-4" />}
              {exporting ? `${Math.round(exportProgress * 100)}%` : 'Export'}
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

      {notice && (
        <div className="flex shrink-0 items-center justify-between border-b border-border bg-destructive px-4 py-2 text-sm font-bold text-destructive-foreground">
          {notice}
          <button type="button" onClick={() => setNotice('')}><X className="h-4 w-4" /></button>
        </div>
      )}

      {validation && <div className="block border-b border-border bg-destructive px-4 py-2 text-sm font-bold text-destructive-foreground sm:hidden">{validation}</div>}

      <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
        <aside className="min-h-0 w-full flex-shrink-0 overscroll-contain overflow-y-auto border-r border-border bg-background bg-tech-grid sm:w-[400px]">
          <div className="flex flex-col gap-6 p-5">
            <Section title="Moment" icon={Lightbulb}>
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
            </Section>

            <Section title="Media" icon={ImagePlus}>
              <p className="mb-4 text-xs text-muted-foreground">Add a photo or a short video (up to 15 seconds, max 75MB).</p>
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
            </Section>

            <Section title="Details" icon={FileImage}>
              <div className="flex flex-col gap-4">
                <HypeField label="Player name" value={project.playerName} onChange={(v) => updateProject('playerName', v)} placeholder="e.g. Jordan Smith" />
                <div className="grid grid-cols-2 gap-4">
                  <HypeField label="Jersey number" value={project.jerseyNumber} onChange={(v) => updateProject('jerseyNumber', v)} placeholder="e.g. 12" />
                  <HypeField label="Position" value={project.position} onChange={(v) => updateProject('position', v)} placeholder="e.g. Point guard" />
                </div>
                <HypeField label="Team name" value={project.teamName} onChange={(v) => updateProject('teamName', v)} placeholder="e.g. Eastside Falcons" />
                
                <div className="space-y-3 rounded-xl border border-border p-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-bold text-muted-foreground">Recognition</Label>
                    <Switch checked={project.visibility.achievement} onCheckedChange={(c) => updateProject('visibility', { ...project.visibility, achievement: c })} />
                  </div>
                  {project.visibility.achievement && <HypeField label="" value={project.achievement} onChange={(v) => updateProject('achievement', v)} placeholder="e.g. Player of the week" />}
                </div>

                <div className="space-y-3 rounded-xl border border-border p-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-bold text-muted-foreground">Message</Label>
                    <Switch checked={project.visibility.coachMessage} onCheckedChange={(c) => updateProject('visibility', { ...project.visibility, coachMessage: c })} />
                  </div>
                  {project.visibility.coachMessage && <HypeField label="" value={project.coachMessage} onChange={(v) => updateProject('coachMessage', v)} placeholder="e.g. Keep showing up." />}
                </div>
              </div>
            </Section>

            <Section title="Output" icon={SlidersHorizontal}>
              <div className="grid grid-cols-2 gap-2">
                {formats.map((format) => (
                  <button
                    key={format.id}
                    type="button"
                    onClick={() => updateProject('format', format.id)}
                    className={`rounded-xl border p-3 text-left transition-colors ${project.format === format.id ? 'border-primary bg-primary/5 ring-1 ring-primary/30' : 'border-border bg-background hover:bg-muted'}`}
                    data-testid={`button-format-${format.id}`}
                  >
                    <span className="block text-xs font-bold">{format.label}</span>
                    <span className="mt-1 block text-[10px] text-muted-foreground">{format.dimensions}</span>
                  </button>
                ))}
              </div>
              {project.format !== 'card' && (
                <div className="mt-4 grid gap-2">
                  <Label className="text-xs font-bold">Graphic style</Label>
                  {templates.map((template) => (
                    <button
                      key={template.id}
                      type="button"
                      onClick={() => updateProject('template', template.id)}
                      className={`rounded-xl border px-3 py-2 text-left transition-colors ${project.template === template.id ? 'border-primary bg-primary/5 ring-1 ring-primary/30' : 'border-border bg-background hover:bg-muted'}`}
                      data-testid={`button-template-${template.id}`}
                    >
                      <span className="block text-xs font-bold">{template.name}</span>
                      <span className="mt-1 block text-[10px] text-muted-foreground">{template.summary}</span>
                    </button>
                  ))}
                </div>
              )}
            </Section>

            <Section title="Layout" icon={LayoutGrid}>
              <div className="grid grid-cols-1 gap-3">
                {cardLayouts.map((l) => (
                  <LayoutOption key={l.id} layout={l} project={project} selected={project.layout === l.id && project.format === 'card'} onSelect={() => { updateProject('layout', l.id); updateProject('format', 'card'); }} />
                ))}
              </div>
            </Section>

            <Section title="Palette" icon={Palette}>
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
            </Section>

            <Section title="Brand Settings" icon={ShieldCheck}>
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between rounded-xl border border-border p-3">
                  <Label htmlFor="branding" className="text-sm font-medium">Show LeagueMatrix branding</Label>
                  <Switch id="branding" checked={project.branding} onCheckedChange={(c) => updateProject('branding', c)} />
                </div>
                <div className="flex items-center justify-between rounded-xl border border-border p-3">
                  <Label htmlFor="overlay" className="text-sm font-medium">Show graphic overlays</Label>
                  <Switch id="overlay" checked={project.overlay} onCheckedChange={(c) => updateProject('overlay', c)} />
                </div>
                <AssetButton label="Team logo" hasAsset={Boolean(project.logo)} onChange={(e) => assetUpload(e, (u) => updateProject('logo', u), setNotice)} onRemove={() => updateProject('logo', null)} />
              </div>
            </Section>
          </div>
        </aside>

        <main className="hidden min-h-0 flex-1 overflow-hidden p-4 sm:block sm:p-8">
          <div className="mx-auto h-full max-w-[800px]">
            <PreviewCanvas project={project} videoUrl={videoUrl} videoRef={videoRef} onExpand={() => setMobilePreviewOpen(true)} />
          </div>
        </main>
      </div>

      <MobilePreviewDialog project={project} videoUrl={videoUrl} open={mobilePreviewOpen} onOpenChange={setMobilePreviewOpen} title={project.headline} />
    </div>
  );
}

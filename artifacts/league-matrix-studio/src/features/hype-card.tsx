type SaveStatus = 'Saved locally' | 'Saving' | 'Saved design' | 'Waiting to sync' | 'Offline' | 'Save failed' | 'Conflict';
type MediaSyncState = {
  status: 'idle' | 'syncing' | 'failed';
  loaded: number;
  total: number;
  message?: string;
};
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import {
  ArrowLeft, Check, Download, Eye, FlipHorizontal2, FolderOpen, ImagePlus,
  LayoutGrid, Lightbulb, MessageCircle, Move, RotateCw, Save, SlidersHorizontal, Upload, X, ZoomIn, Play, Pause, Volume2, VolumeX, RotateCcw, Share2, Link2, Link2Off, Clipboard, Trash2
} from 'lucide-react';
import { Link } from 'wouter';
import { useParams, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { useUser } from '@clerk/react';
import { 
  useCreateProject, 
  useUpdateProject, 
  useGetProject, 
  useListProjects,
  getGetProjectQueryKey,
  getListProjectsQueryKey,
  useGetAccountAccess,
  getGetAccountAccessQueryKey,
  serveProjectMedia,
  requestProjectMediaUploadUrl,
  completeProjectMediaUpload,
  abandonProjectMediaUpload,
  deleteProjectMedia,
  useCreateHypeCardShare,
  useDeleteHypeCardShare,
  useListHypeCardShares,
  useListHypeCardShareReplies,
  useMarkHypeCardShareRepliesRead,
  useDeleteHypeCardShareReply,
  useListAthleteInvites,
  useUpdateAthleteInvite,
  getListAthleteInvitesQueryKey,
  getListHypeCardShareRepliesQueryKey,
  getListHypeCardSharesQueryKey,
  requestHypeCardShareUploadUrl,
  type HypeCardShare,
  type OwnedHypeCardShare,
  type Project
} from '@workspace/api-client-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

import {
  HypeCardProject, HypeFormat, TemplateId, CardLayoutId,
  templates, cardLayouts, defaultProject, getDimensions, cardFinishes,
  normalizeHypeCardProject, readHypeCardProject, saveHypeCardProject, isSafeRasterDataUrl, designOnlyProject, clearHypeCardMedia,
  serializeHypeCardTemplate, parseHypeCardTemplate, PORTABLE_TEMPLATE_MEDIA_NOTE,
  persistCompletedHypeCardCloudSave, readHypeCardCloudDraft, saveHypeCardCloudDraft,
} from './hype-card-types';
import { buildHypeCardSvg, getPhotoClipInfo, SvgLayer, getPhotoFrame, STADIUM_MEDIA_FRAME } from './hype-card-svg';
import { getHypeCardNoticeTone } from './hype-card-notice';
import { saveMediaBlob, loadMediaBlob, deleteMediaBlob, checkExportSupport, uploadMediaBlob, type MediaUploadProgress } from './hype-card-media';
import { exportVideoCanvas, rasterizeSvgForDownload, svgToImage } from './hype-card-export';
import { transcodeVideoToMp4 } from './hype-card-transcode';
import { getGuestUsageKey } from './guest-access';
import { MAX_HOSTED_VIDEO_BYTES, prepareHypeCardShareMedia, uploadHypeCardShareMedia, type HypeCardShareQuality } from './hype-card-share';
import { sports, getSportRule, normalizeTrackerData, type GameSession } from './stat-tracker';
import { getUserProfile, seedHypeCardFromSupporterProfile } from './supporter-dashboard-model';
import { LOCAL_MEDIA_DEFAULT, PUBLIC_SHARE_MEDIA } from './privacy-copy';
import { PreviewArtwork } from './hype-card-preview';

const DEFAULT_MEDIA_NAME = 'Game Day highlight';
const cleanMediaName = (value: string | undefined | null) => {
  const cleaned = (value ?? '').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned && !/^(?:IMG|VID|MOV|DSC|PXL|Screenshot)[ ]?\d+$/i.test(cleaned)
    ? cleaned.slice(0, 80)
    : DEFAULT_MEDIA_NAME;
};

function isOwnedHypeCardShare(share: HypeCardShare | OwnedHypeCardShare): share is OwnedHypeCardShare {
  return 'trackerProjectId' in share && 'expiresInDays' in share;
}

function waitForVideoEvent(
  video: HTMLVideoElement,
  eventName: 'loadedmetadata' | 'seeked',
  timeoutMs: number,
  rejectOnError: boolean,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      window.clearTimeout(timeoutId);
      video.removeEventListener(eventName, onReady);
      video.removeEventListener('error', onError);
    };
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      if (rejectOnError) reject(new Error('This browser cannot decode that video. Try an MP4/H.264 clip.'));
      else resolve();
    };
    const timeoutId = window.setTimeout(() => {
      cleanup();
      if (rejectOnError) reject(new Error('The browser took too long to read that video. Try an MP4/H.264 clip.'));
      else resolve();
    }, timeoutMs);
    video.addEventListener(eventName, onReady, { once: true });
    video.addEventListener('error', onError, { once: true });
  });
}

function drawVideoContain(
  context: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  x: number,
  y: number,
  width: number,
  height: number,
  fit: 'fill' | 'fit' = 'fit',
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
  if (fit === 'fill') {
    const scale = Math.max(width / sourceWidth, height / sourceHeight);
    const drawWidth = sourceWidth * scale;
    const drawHeight = sourceHeight * scale;
    context.drawImage(video, 0, 0, sourceWidth, sourceHeight, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
    return;
  }
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

type GameDayHypePrefill = {
  date: string;
  opponent: string;
  eventType: 'game' | 'practice';
};

function readGameDayHypePrefill(): GameDayHypePrefill | null {
  if (typeof window === 'undefined') return null;
  const search = new URLSearchParams(window.location.search);
  const source = search.get('source');
  if (source !== 'game-day' && source !== 'workspace') return null;
  return {
    date: search.get('date') ?? '',
    opponent: search.get('opponent') ?? '',
    eventType: search.get('eventType') === 'practice' ? 'practice' : 'game',
  };
}

function getGameDayStatSummary(game: GameSession | undefined): string {
  if (!game) return '';
  const rule = getSportRule(game.sport);
  const highlights = rule.stats
    .filter((stat) => (game.stats[stat.id] ?? 0) > 0)
    .slice(0, 2)
    .map((stat) => `${game.stats[stat.id]} ${stat.shortLabel}`);
  return highlights.length
    ? highlights.join(' · ')
    : `${game.score}–${game.opponentScore} final`;
}

function formatGameDayDate(value: string): string {
  if (!value) return '';
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
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

function isCloudMediaId(value: string | null | undefined): value is string {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(value));
}

function formatMediaBytes(bytes: number) {
  if (bytes <= 0) return '0 KB';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

function hasDeviceOnlyMedia(project: HypeCardProject) {
  return [project.mediaId, project.downloadMediaId, project.posterMediaId, project.logoMediaId]
    .some((id) => Boolean(id && !isCloudMediaId(id)));
}

type ProjectMediaUploadRecord = {
  claimId: string;
  objectPath: string;
  mediaId?: string;
};

async function cleanupProjectMediaUploads(records: ProjectMediaUploadRecord[]): Promise<string[]> {
  const failures: string[] = [];
  await Promise.all(records.map(async (record) => {
    try {
      if (record.mediaId) {
        await deleteProjectMedia(record.mediaId);
      } else {
        await abandonProjectMediaUpload(record.claimId);
      }
    } catch (error: any) {
      if (error?.status === 404) return;
      failures.push(record.mediaId ? 'completed media' : 'unfinished upload');
    }
  }));
  return failures;
}

function projectForLocalSave(project: HypeCardProject) {
  return project.mediaType === 'image' && project.mediaId
    ? { ...project, photo: null }
    : project;
}

function mergeDeviceMedia(serverProject: HypeCardProject, localProject: HypeCardProject) {
  const localPhoto = localProject.mediaId && !isCloudMediaId(localProject.mediaId);
  const localLogo = localProject.logoMediaId && !isCloudMediaId(localProject.logoMediaId);
  return {
    ...serverProject,
    ...(localPhoto ? {
      mediaType: localProject.mediaType,
      mediaId: localProject.mediaId,
      downloadMediaId: localProject.downloadMediaId,
      posterMediaId: localProject.posterMediaId,
      videoPrepared: localProject.videoPrepared,
      videoMeta: localProject.videoMeta,
      photo: localProject.photo,
    } : {}),
    ...(localLogo ? {
      logoMediaId: localProject.logoMediaId,
      logo: localProject.logo,
    } : {}),
  };
}

function hydrateCloudHypeCard(cloudProject: Project) {
  const source = normalizeHypeCardProject(cloudProject.project);
  const photo = cloudProject.media.find((item) => item.mediaRole === 'photo');
  const logo = cloudProject.media.find((item) => item.mediaRole === 'logo');
  const poster = cloudProject.media.find((item) => item.mediaRole === 'poster');
  const preview = cloudProject.media.find((item) => item.mediaRole === 'video_preview');
  const download = cloudProject.media.find((item) => item.mediaRole === 'video_download');
  return normalizeHypeCardProject({
    ...source,
    format: 'card',
    mediaType: preview || download ? 'video' : photo ? 'image' : null,
    mediaId: preview?.id ?? photo?.id ?? null,
    downloadMediaId: download?.id ?? null,
    posterMediaId: poster?.id ?? null,
    logoMediaId: logo?.id ?? null,
  });
}

async function cacheCloudStaticMedia(cloudProject: Project) {
  const hydrated = hydrateCloudHypeCard(cloudProject);
  const load = async (mediaRole: 'photo' | 'logo' | 'poster') => {
    const media = cloudProject.media.find((item) => item.mediaRole === mediaRole);
    if (!media) return null;
    const blob = await serveProjectMedia(media.id);
    await saveMediaBlob(media.id, blob);
    return blobToDataUrl(blob);
  };
  const [photo, logo, poster] = await Promise.all([
    load('photo'),
    load('logo'),
    load('poster'),
  ]);
  return {
    photo: hydrated.mediaType === 'video' ? poster : photo,
    logo,
  };
}

async function uploadProjectMedia(
  projectId: string,
  mediaRole: 'photo' | 'logo' | 'poster' | 'video_preview' | 'video_download',
  blob: Blob,
  name: string,
  options: {
    signal?: AbortSignal;
    onProgress?: MediaUploadProgress;
    onClaimCreated?: (record: ProjectMediaUploadRecord) => void;
  } = {},
) {
  const contentType = blob.type || (mediaRole.startsWith('video') ? 'video/mp4' : 'image/jpeg');
  const mediaType = mediaRole.startsWith('video') ? 'video' : 'image';
  const upload = await requestProjectMediaUploadUrl({
    projectId, mediaRole, mediaType, name, size: blob.size, contentType,
  });
  const record: ProjectMediaUploadRecord = {
    claimId: upload.claimId,
    objectPath: upload.objectPath,
  };
  options.onClaimCreated?.(record);
  await uploadMediaBlob(upload.uploadURL, blob, contentType, {
    signal: options.signal,
    onProgress: options.onProgress,
  });
  if (options.signal?.aborted) {
    const error = new Error('The media upload was cancelled.');
    error.name = 'AbortError';
    throw error;
  }
  const media = await completeProjectMediaUpload({ objectPath: upload.objectPath });
  record.mediaId = media.id;
  return media;
}

function projectForCloudSave(project: HypeCardProject, paid: boolean): HypeCardProject {
  const design = designOnlyProject(project);
  return paid
    ? { ...design, videoMeta: project.videoMeta }
    : design;
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
      project.message,
      project.logo,
      project.visibility.stat,
      project.visibility.achievement,
      project.visibility.message,
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
  icon: typeof Lightbulb;
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
  { label: 'Moment', hint: 'Write your own moment' },
  { label: 'Media', hint: 'Add player media' },
  { label: 'Layout', hint: 'Choose the scene' },
  { label: 'Review', hint: 'Preview and export' },
] as const;

const mobileMediaSteps = [
  { label: 'Add media', hint: 'Choose the player media and team logo.' },
  { label: 'Frame', hint: 'Set the crop, position, and video framing.' },
  { label: 'Fine-tune', hint: 'Adjust color, trim video, and export options.' },
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
  accept = 'image/*,video/*',
}: {
  label: string;
  hasAsset: boolean;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onRemove: () => void;
  accept?: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <label className="flex min-h-12 flex-1 cursor-pointer items-center justify-center gap-3 border-2 border-dashed border-border bg-background px-4 text-sm font-bold uppercase tracking-widest transition-colors hover:border-primary hover:text-primary clip-angled-sm">
        {hasAsset ? <Check className="h-5 w-5 text-primary" /> : <Upload className="h-5 w-5 text-muted-foreground" />}
        {hasAsset ? `${label} added` : `Add ${label}`}
        <input type="file" accept={accept} className="sr-only" onChange={onChange} />
      </label>
      {hasAsset && (
        <button type="button" onClick={onRemove} className="grid h-12 w-12 shrink-0 place-items-center bg-muted border border-border text-foreground hover:bg-destructive hover:text-destructive-foreground transition-colors clip-angled-sm" aria-label={`Remove ${label}`}>
          <X className="h-5 w-5" />
        </button>
      )}
    </div>
  );
}

function MediaAssetControls({
  hasMedia,
  hasLogo,
  onMediaChange,
  onMediaRemove,
  onLogoChange,
  onLogoRemove,
}: {
  hasMedia: boolean;
  hasLogo: boolean;
  onMediaChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onMediaRemove: () => void | Promise<void>;
  onLogoChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onLogoRemove: () => void | Promise<void>;
}) {
  return (
    <div className="space-y-3">
      <AssetButton
        label="Media"
        hasAsset={hasMedia}
        onChange={onMediaChange}
        onRemove={onMediaRemove}
      />
      <AssetButton
        label="Team logo"
        hasAsset={hasLogo}
        onChange={onLogoChange}
        onRemove={onLogoRemove}
        accept="image/*"
      />
    </div>
  );
}

function MediaFramingControls({
  project,
  onReset,
  onTransformChange,
  onVideoFitChange,
  children,
}: {
  project: HypeCardProject;
  onReset: () => void;
  onTransformChange: (key: keyof HypeCardProject['photoTransform'], value: number | boolean) => void;
  onVideoFitChange: (value: HypeCardProject['videoFit']) => void;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-muted/50 p-4">
      <div className="mb-3 flex items-center justify-between">
        <Label className="text-xs font-bold">Crop & Position</Label>
        <button type="button" onClick={onReset} className="text-[10px] font-bold text-muted-foreground hover:text-foreground">Reset</button>
      </div>
      <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-4">
        <ZoomIn className="h-3.5 w-3.5 text-muted-foreground" />
        <Slider value={[project.photoTransform.zoom]} min={0.5} max={3} step={0.01} onValueChange={([value]) => onTransformChange('zoom', value)} aria-label="Media zoom" />
        <Move className="h-3.5 w-3.5 text-muted-foreground" />
        <div className="grid grid-cols-2 gap-2">
          <Slider value={[project.photoTransform.x]} min={-500} max={500} step={1} onValueChange={([value]) => onTransformChange('x', value)} aria-label="Move media horizontally" />
          <Slider value={[project.photoTransform.y]} min={-500} max={500} step={1} onValueChange={([value]) => onTransformChange('y', value)} aria-label="Move media vertically" />
        </div>
      </div>
      <div className="mt-4 flex gap-2">
        <Button type="button" variant="outline" size="sm" className="flex-1 gap-2" onClick={() => onTransformChange('rotation', (project.photoTransform.rotation + 90) % 360)}>
          <RotateCw className="h-3.5 w-3.5" /> Rotate
        </Button>
        <Button type="button" variant="outline" size="sm" className="flex-1 gap-2" onClick={() => onTransformChange('flip', !project.photoTransform.flip)}>
          <FlipHorizontal2 className="h-3.5 w-3.5" /> Flip
        </Button>
      </div>
      {project.mediaType === 'video' && (
        <div className="mt-4 flex items-center gap-2" role="group" aria-label="Video framing">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Video frame</span>
          {(['fill', 'fit'] as const).map((mode) => (
            <Button key={mode} type="button" size="sm" variant={project.videoFit === mode ? 'default' : 'outline'} className="rounded-none text-[10px] uppercase" onClick={() => onVideoFitChange(mode)}>
              {mode === 'fill' ? 'Fill' : 'Fit'}
            </Button>
          ))}
        </div>
      )}
      {children}
    </div>
  );
}

function MediaAdjustmentControls({
  project,
  showAdvanced,
  onToggle,
  onAdjustmentChange,
  className = 'rounded-xl border border-border bg-muted/50 p-4',
}: {
  project: HypeCardProject;
  showAdvanced: boolean;
  onToggle: () => void;
  onAdjustmentChange: (key: keyof HypeCardProject['adjustments'], value: number) => void;
  className?: string;
}) {
  return (
    <div className={className}>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between text-xs font-bold"
        aria-expanded={showAdvanced}
      >
        <span className="flex items-center gap-2"><SlidersHorizontal className="h-3.5 w-3.5" /> Image adjustments</span>
        <span>{showAdvanced ? 'Hide' : 'Show'}</span>
      </button>
      {showAdvanced && (
        <div className="mt-4 grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-4">
          <Label className="text-[10px] uppercase tracking-wide">Brightness</Label>
          <Slider value={[project.adjustments.brightness]} min={0.5} max={1.5} step={0.01} onValueChange={([value]) => onAdjustmentChange('brightness', value)} aria-label="Brightness" />
          <Label className="text-[10px] uppercase tracking-wide">Contrast</Label>
          <Slider value={[project.adjustments.contrast]} min={0.5} max={1.5} step={0.01} onValueChange={([value]) => onAdjustmentChange('contrast', value)} aria-label="Contrast" />
          <Label className="text-[10px] uppercase tracking-wide">Color</Label>
          <Slider value={[project.adjustments.saturation]} min={0} max={2} step={0.01} onValueChange={([value]) => onAdjustmentChange('saturation', value)} aria-label="Color saturation" />
        </div>
      )}
    </div>
  );
}

function MediaTrimAndAudioControls({
  project,
  exportSupport,
  includeAudio,
  audioId,
  onAudioChange,
  onTrimChange,
}: {
  project: HypeCardProject;
  exportSupport: { mp4Mime: string | null; webmMime: string | null };
  includeAudio: boolean;
  audioId: string;
  onAudioChange: (value: boolean) => void;
  onTrimChange: (edge: 'start' | 'end', value: number) => void;
}) {
  return (
    <div className="space-y-3 rounded-lg bg-muted px-3 py-3">
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
            onValueChange={([value]) => onTrimChange('start', value)}
            aria-label="Video trim start"
          />
          <Label className="text-[10px] uppercase tracking-wide">End</Label>
          <Slider
            value={[project.trimEnd]}
            min={0.1}
            max={Math.max(0.1, project.videoMeta?.duration ?? 15)}
            step={0.1}
            onValueChange={([value]) => onTrimChange('end', value)}
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
        <Label htmlFor={audioId} className="text-xs font-medium">Keep original sound</Label>
        <Switch id={audioId} checked={includeAudio} onCheckedChange={onAudioChange} />
      </div>
    </div>
  );
}

function MediaImageDownloadControls({
  imageFormat,
  onFormatChange,
}: {
  imageFormat: 'png' | 'jpeg';
  onFormatChange: (format: 'png' | 'jpeg') => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-muted px-3 py-2">
      <Label className="text-xs font-medium">Download format</Label>
      <div className="flex gap-1" role="group" aria-label="Image download format">
        {(['png', 'jpeg'] as const).map((format) => (
          <button
            key={format}
            type="button"
            onClick={() => onFormatChange(format)}
            aria-pressed={imageFormat === format}
            className={`rounded-md px-2 py-1 text-[10px] font-bold uppercase ${imageFormat === format ? 'bg-primary text-primary-foreground' : 'bg-background text-foreground'}`}
          >
            {format === 'jpeg' ? 'JPG' : 'PNG'}
          </button>
        ))}
      </div>
    </div>
  );
}

export function PreviewCanvas({
  project,
  videoUrl,
  videoRef,
  onRequestPlay,
}: {
  project: HypeCardProject;
  videoUrl?: string;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
  onRequestPlay?: () => void;
}) {
  const dimensions = getDimensions(project.format);
  const ns = useMemo(() => Math.random().toString(36).substring(2, 9), [project.layout, project.format, project.template]);
  const stageRef = useRef<HTMLDivElement>(null);
  const [stageBounds, setStageBounds] = useState({ width: 0, height: 0 });

  const [isPlaying, setIsPlaying] = useState(Boolean(videoUrl));
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
      if (isPlaying && videoUrl) videoRef.current.play().catch(() => setIsPlaying(false));
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
      
      {project.mediaType === 'video' && (
        <div className={`absolute bottom-6 left-1/2 z-20 -translate-x-1/2 flex items-center gap-2 bg-foreground/90 p-2 transition-opacity ${videoUrl ? 'opacity-0 group-hover:opacity-100' : 'opacity-100'} focus-within:opacity-100 clip-angled-sm shadow-xl border border-white/10`}>
          <button type="button" data-testid="button-play-pause" onClick={() => {
            if (!videoUrl) { onRequestPlay?.(); setIsPlaying(true); return; }
            setIsPlaying(!isPlaying);
          }} className="grid h-10 w-10 place-items-center bg-white/10 text-white hover:bg-primary hover:text-primary-foreground clip-angled-sm transition-colors" aria-label={isPlaying ? 'Pause' : 'Play'}>
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
  const profile = getUserProfile(user);
  const gameDayPrefill = useMemo(readGameDayHypePrefill, []);
  const queryClient = useQueryClient();
  const initialCloudDraft = useMemo(
    () => cloudProjectId ? readHypeCardCloudDraft(cloudProjectId) : null,
    [cloudProjectId],
  );

  const [project, setProject] = useState<HypeCardProject>(() => {
    try {
      const initial = cloudProjectId ? initialCloudDraft?.project ?? defaultProject() : readHypeCardProject() ?? defaultProject();
      return { ...initial, format: 'card' };
    } catch {
      return defaultProject();
    }
  });

  const [notice, setNotice] = useState('');
  const [templateMediaNotice, setTemplateMediaNotice] = useState(false);
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>(
    cloudProjectId
      ? initialCloudDraft
        ? navigator.onLine ? initialCloudDraft.syncState === 'pending' ? 'Waiting to sync' : 'Saved design' : 'Offline'
        : navigator.onLine ? 'Saving' : 'Offline'
      : 'Saved locally',
  );
  const [conflictData, setConflictData] = useState<Project | null>(null);
  const [mediaSyncState, setMediaSyncState] = useState<MediaSyncState>({
    status: 'idle',
    loaded: 0,
    total: 0,
  });
  
  const [autosaveWarning, setAutosaveWarning] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [mobilePreviewOpen, setMobilePreviewOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [validation, setValidation] = useState('');
  const [videoUrl, setVideoUrl] = useState<string | undefined>(undefined);
  const [preparingVideo, setPreparingVideo] = useState(false);
  const [exportSupport, setExportSupport] = useState(() => checkExportSupport());
  const [includeAudio, setIncludeAudio] = useState(true);
  const [imageFormat, setImageFormat] = useState<'png' | 'jpeg'>('png');
  const [walkthroughStep, setWalkthroughStep] = useState(0);
  const [mediaSubstep, setMediaSubstep] = useState(0);
  const [sharing, setSharing] = useState(false);
  const [shareProgress, setShareProgress] = useState(0);
  const [shareStage, setShareStage] = useState('');
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [replyDialogOpen, setReplyDialogOpen] = useState(() => new URLSearchParams(window.location.search).has('replies'));
  const [shareTrackerProjectId, setShareTrackerProjectId] = useState<string>('none');
  const [shareSport, setShareSport] = useState<string>('basketball');
  const [shareExpiresInDays, setShareExpiresInDays] = useState<string>('30');
  const [shareMode, setShareMode] = useState<'card' | 'stats'>('card');
  const [shareVideoQuality, setShareVideoQuality] = useState<HypeCardShareQuality>('standard');
  const [shareVideoTooLargeQuality, setShareVideoTooLargeQuality] = useState<HypeCardShareQuality | null>(null);
  const [shareMediaName, setShareMediaName] = useState(DEFAULT_MEDIA_NAME);
  const { data: athleteInvites } = useListAthleteInvites({
    query: {
      enabled: Boolean(isSignedIn),
      queryKey: getListAthleteInvitesQueryKey(),
    },
  });
  const athleteHypePage = athleteInvites?.[0] ?? null;
  const updateAthleteHypePage = useUpdateAthleteInvite();
  const [linkedExportPending, setLinkedExportPending] = useState(false);
  const [publishedShare, setPublishedShare] = useState<HypeCardShare | null>(null);
  const [publishedStatsShare, setPublishedStatsShare] = useState<HypeCardShare | null>(null);
  const [syncRetry, setSyncRetry] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const exportAbortRef = useRef<AbortController | null>(null);
  const mediaPreparationAbortRef = useRef<AbortController | null>(null);
  const sharePreparationAbortRef = useRef<AbortController | null>(null);
  const cloudPreviewLoadingRef = useRef(false);
  const mediaSyncRef = useRef(false);
  const mediaSyncAbortRef = useRef<AbortController | null>(null);
  const profilePrefillAppliedRef = useRef(false);
  const gameDayPrefillAppliedRef = useRef(false);

  const initializedForId = useRef<string | null>(initialCloudDraft ? cloudProjectId ?? null : null);
  const hydratedServerForId = useRef<string | null>(null);
  const lastSaved = useRef<HypeCardProject>(project);
  const currentRevision = useRef<number>(initialCloudDraft?.cloudRevision ?? 1);
  const guestUsageKey = useRef(getGuestUsageKey('hype_card', 'hype-editor', false)).current;
  const shareKey = cloudProjectId || guestUsageKey;
  const mutateFnRef = useRef<any>(null);
  const isSavingRef = useRef(false);
  const nextSaveDataRef = useRef<HypeCardProject | null>(null);

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  useEffect(() => {
    if (!isOnline && cloudProjectId) setSaveStatus('Offline');
  }, [cloudProjectId, isOnline]);

  useEffect(() => {
    if (isLoaded && !isSignedIn && cloudProjectId && isOnline && !initialCloudDraft) {
      setLocation('/sign-in');
    }
  }, [isLoaded, isSignedIn, cloudProjectId, initialCloudDraft, isOnline, setLocation]);

  if (isLoaded && !isSignedIn && cloudProjectId && isOnline && !initialCloudDraft) {
    return (
      <div className="flex h-[100dvh] items-center justify-center bg-muted">
        <p className="font-bold uppercase tracking-wider text-muted-foreground">Redirecting to sign in...</p>
      </div>
    );
  }

  const { data: cloudProjectData } = useGetProject(cloudProjectId || '', {
    query: { enabled: !!cloudProjectId && !!isSignedIn && isOnline, queryKey: getGetProjectQueryKey(cloudProjectId || '') }
  });
  const { data: accountAccess } = useGetAccountAccess({
    query: {
      enabled: Boolean(isSignedIn && isOnline),
      staleTime: 15000,
      queryKey: getGetAccountAccessQueryKey(),
    },
  });

  const updateProjectMutation = useUpdateProject({
    mutation: {
      onSuccess: (data) => {
        currentRevision.current = data.revision;
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
  const { data: projects } = useListProjects({
    query: {
      enabled: Boolean(isSignedIn && isOnline),
      queryKey: getListProjectsQueryKey(),
      staleTime: 10_000,
    },
  });
  const trackerProjects = projects?.filter(p => p.project.tool === 'stat-tracker') || [];

  useEffect(() => {
    if (!isLoaded) return;
    if (!profilePrefillAppliedRef.current) {
      setProject((current) => seedHypeCardFromSupporterProfile(current, profile));
      profilePrefillAppliedRef.current = true;
    }
    if (!gameDayPrefill || gameDayPrefillAppliedRef.current) return;
    if (gameDayPrefill.eventType === 'game' && isSignedIn && !projects) return;

    const completedGames = trackerProjects.flatMap((trackerProject) => (
      normalizeTrackerData(trackerProject.project).games
    ));
    const matchingGame = completedGames
      .filter((game) => game.status === 'final')
      .find((game) => (
        game.date === gameDayPrefill.date
        && (!gameDayPrefill.opponent || game.opponent === gameDayPrefill.opponent)
      ));
    const context = [
      gameDayPrefill.eventType === 'practice'
        ? 'Practice'
        : gameDayPrefill.opponent ? `vs ${gameDayPrefill.opponent}` : 'Game day',
      formatGameDayDate(gameDayPrefill.date),
    ].filter(Boolean).join(' · ');
    const statSummary = gameDayPrefill.eventType === 'game'
      ? getGameDayStatSummary(matchingGame)
      : '';

    setProject((current) => ({
      ...current,
      achievement: context || current.achievement,
      stat: statSummary || current.stat,
    }));
    gameDayPrefillAppliedRef.current = true;
    if (gameDayPrefill) {
      setNotice(statSummary
        ? 'Game details and finished stats are ready. Choose media from your camera roll.'
        : 'Game details are ready. Choose media from your camera roll.');
    }
  }, [
    cloudProjectId,
    gameDayPrefill,
    isLoaded,
    profile.athleteName,
    profile.jerseyNumber,
    profile.position,
    profile.teamName,
    projects,
    trackerProjects,
  ]);

  const { data: hypeShares } = useListHypeCardShares(undefined, {
    query: {
      enabled: Boolean(isSignedIn && isOnline),
      queryKey: getListHypeCardSharesQueryKey(),
      staleTime: 10_000,
    },
  });
  const existingShare: HypeCardShare | OwnedHypeCardShare | null =
    publishedShare ?? hypeShares?.find((share) => share.shareMode === 'card' && share.manifest.shareKey === shareKey) ?? null;
  const existingStatsShare: HypeCardShare | OwnedHypeCardShare | null =
    publishedStatsShare ?? hypeShares?.find((share) => share.shareMode === 'stats' && share.manifest.shareKey === shareKey) ?? null;
  const { data: shareReplies } = useListHypeCardShareReplies(existingShare?.shareToken ?? '', {
    query: {
      enabled: Boolean(isSignedIn && existingShare && isOnline),
      queryKey: getListHypeCardShareRepliesQueryKey(existingShare?.shareToken ?? ''),
      refetchInterval: 15_000,
    },
  });
  const markRepliesRead = useMarkHypeCardShareRepliesRead();
  const deleteReply = useDeleteHypeCardShareReply({
    mutation: {
      onSuccess: (_data, variables) => {
        const queryKey = getListHypeCardShareRepliesQueryKey(variables.shareToken);
        queryClient.setQueryData(queryKey, (current: typeof shareReplies) => {
          if (!current) return current;
          const removed = current.replies.find((reply) => reply.id === variables.replyId);
          return {
            ...current,
            unreadCount: removed && !removed.isRead ? Math.max(0, current.unreadCount - 1) : current.unreadCount,
            replies: current.replies.filter((reply) => reply.id !== variables.replyId),
          };
        });
      },
      onError: () => setNotice('Could not delete that reply. Please try again.'),
    },
  });
  const isShareSuccessNotice = notice.startsWith('Hype Card added to Athlete Hype Page')
    || notice.startsWith('Video added to Athlete Hype Page')
    || notice.startsWith('Stats link ready')
    || notice === 'Share link copied.'
    || notice === 'Stats link copied.'
    || notice.startsWith('Hype Card removed from Athlete Hype Page');
  const noticeTone = getHypeCardNoticeTone(notice);
  const isSuccessNotice = noticeTone === 'success';
  mutateFnRef.current = updateProjectMutation.mutateAsync;

  useEffect(() => {
    if (!replyDialogOpen || !existingShare || !shareReplies?.unreadCount || markRepliesRead.isPending) return;
    void markRepliesRead.mutateAsync({ shareToken: existingShare.shareToken }).then(() =>
      queryClient.invalidateQueries({ queryKey: getListHypeCardShareRepliesQueryKey(existingShare.shareToken) })
    );
  }, [replyDialogOpen, existingShare?.shareToken, shareReplies?.unreadCount]);

  useEffect(() => {
    if (cloudProjectId && cloudProjectData && hydratedServerForId.current !== cloudProjectId) {
      hydratedServerForId.current = cloudProjectId;
      initializedForId.current = cloudProjectId;
      const photo = cloudProjectData.media.find((item) => item.mediaRole === 'photo');
      const logo = cloudProjectData.media.find((item) => item.mediaRole === 'logo');
      const poster = cloudProjectData.media.find((item) => item.mediaRole === 'poster');
      const p = seedHypeCardFromSupporterProfile(hydrateCloudHypeCard(cloudProjectData), profile);
      currentRevision.current = cloudProjectData.revision;
      const localDraft = readHypeCardCloudDraft(cloudProjectId);
      const revisionChanged = localDraft?.cloudRevision !== null
        && localDraft?.cloudRevision !== cloudProjectData.revision;
      const pendingConflict = Boolean(
        localDraft?.syncState === 'pending'
        && revisionChanged,
      );
      const keepPendingLocal = Boolean(
        localDraft?.syncState === 'pending'
        && !revisionChanged,
      );
      const mergeSyncedDeviceMedia = Boolean(
        localDraft?.syncState === 'synced'
        && hasDeviceOnlyMedia(localDraft.project),
      );
      if (pendingConflict && localDraft) {
        const localProject = seedHypeCardFromSupporterProfile({ ...localDraft.project, format: 'card' as HypeFormat }, profile);
        setProject(localProject);
        lastSaved.current = localProject;
        setConflictData(cloudProjectData);
        setSaveStatus('Conflict');
      } else if (keepPendingLocal && localDraft) {
        const localProject = seedHypeCardFromSupporterProfile({ ...localDraft.project, format: 'card' as HypeFormat }, profile);
        setProject(localProject);
        lastSaved.current = localProject;
        setSaveStatus(isOnline ? 'Waiting to sync' : 'Offline');
        nextSaveDataRef.current = localProject;
      } else if (mergeSyncedDeviceMedia && localDraft) {
        const merged = mergeDeviceMedia(p, localDraft.project);
        const profileProject = seedHypeCardFromSupporterProfile({ ...merged, format: 'card' as HypeFormat }, profile);
        setProject(profileProject);
        lastSaved.current = profileProject;
        saveHypeCardCloudDraft(cloudProjectId, window.localStorage, {
          project: projectForLocalSave(profileProject),
          syncState: 'synced',
          cloudRevision: cloudProjectData.revision,
        });
        setSaveStatus('Saved design');
      } else {
        setProject(p);
        lastSaved.current = p;
        saveHypeCardCloudDraft(cloudProjectId, window.localStorage, {
        project: p,
          syncState: 'synced',
          cloudRevision: cloudProjectData.revision,
        });
        setSaveStatus('Saved design');
      }
      void (async () => {
        if (pendingConflict || keepPendingLocal || mergeSyncedDeviceMedia) return;
        try {
          if (!photo && !logo && !poster) return;
          const staticMedia = await cacheCloudStaticMedia(cloudProjectData);
          setProject((current) => ({
            ...current,
            photo: staticMedia.photo ?? current.photo,
            logo: staticMedia.logo ?? current.logo,
          }));
        } catch {
          setNotice('Some saved images could not be loaded. Check your connection and try again.');
        }
      })();
    }
  }, [cloudProjectData, cloudProjectId, isOnline]);

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
      if ((project.mediaType === 'image' && project.photo) || !project.mediaId || !project.mediaType) {
        if (project.mediaType !== 'image') setVideoUrl(undefined);
        return;
      }

      let blob = await loadMediaBlob(project.mediaId);
      
      if (!blob) {
        if (!cancelled) {
          if (project.mediaType === 'video') setVideoUrl(undefined);
          if (cloudProjectId && isCloudMediaId(project.mediaId)) {
            setNotice(isOnline
              ? 'The saved media is not on this device yet. Press Play to load it.'
              : 'This media is saved in the cloud but not on this phone. Reconnect to load it.');
            return;
          }
          setNotice('The attached media is no longer available on this device. Please add it again.');
          setProject((current) => (
            current.mediaId === project.mediaId
              ? clearHypeCardMedia(current)
              : current
          ));
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
  }, [cloudProjectId, isOnline, project.mediaId, project.mediaType, project.photo]);

  const loadPreviewForPlay = async () => {
    if (videoUrl || !cloudProjectId || !project.mediaId || cloudPreviewLoadingRef.current) return;
    if (!isOnline) {
      setNotice('Reconnect to load this cloud video onto your phone.');
      return;
    }
    cloudPreviewLoadingRef.current = true;
    try {
      const blob = await serveProjectMedia(project.mediaId);
      await saveMediaBlob(project.mediaId, blob);
      setVideoUrl(URL.createObjectURL(blob));
    } catch {
      setNotice('The preview video could not be loaded. Check your connection and try again.');
    } finally {
      cloudPreviewLoadingRef.current = false;
    }
  };

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

  useEffect(() => () => {
    mediaPreparationAbortRef.current?.abort();
  }, []);

  const processNextSave = async () => {
    if (
      isSavingRef.current
      || !nextSaveDataRef.current
      || !cloudProjectId
      || saveStatus === 'Conflict'
      || !isOnline
      || !isSignedIn
    ) return;

    const dataToSave = nextSaveDataRef.current;
    nextSaveDataRef.current = null;
    isSavingRef.current = true;
    setSaveStatus('Saving');
    let savedSuccessfully = false;

    try {
      const savedProject = projectForCloudSave(dataToSave, Boolean(accountAccess?.paid));

      const saved = await mutateFnRef.current({
        projectId: cloudProjectId,
        data: {
          project: savedProject,
          expectedRevision: currentRevision.current
        }
      });
      lastSaved.current = dataToSave;
      const newerPendingProject = nextSaveDataRef.current;
      persistCompletedHypeCardCloudSave(
        cloudProjectId,
        window.localStorage,
        projectForLocalSave(dataToSave),
        saved.revision,
        newerPendingProject ? projectForLocalSave(newerPendingProject) : null,
      );
      setSaveStatus(newerPendingProject ? 'Waiting to sync' : 'Saved design');
      savedSuccessfully = true;
    } catch (e: any) {
      if (e?.status !== 409 && !e?.message?.includes('409') && !e?.error?.includes('conflict')) {
         if (!nextSaveDataRef.current) nextSaveDataRef.current = dataToSave;
         setSaveStatus(navigator.onLine ? 'Save failed' : 'Offline');
      }
    } finally {
      isSavingRef.current = false;
      if (savedSuccessfully && nextSaveDataRef.current) {
        processNextSave();
      }
    }
  };

  const processNextSaveRef = useRef(processNextSave);
  processNextSaveRef.current = processNextSave;

  useEffect(() => {
    if (!cloudProjectId || !isOnline || !isSignedIn || initializedForId.current !== cloudProjectId) return;
    const localDraft = readHypeCardCloudDraft(cloudProjectId);
    if (localDraft?.syncState !== 'pending') return;
    nextSaveDataRef.current = project;
    setSaveStatus('Waiting to sync');
    void processNextSaveRef.current();
  }, [cloudProjectId, isOnline, isSignedIn]);

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
        try {
          const localProject = projectForLocalSave(project);
          saveHypeCardCloudDraft(cloudProjectId, window.localStorage, {
            project: localProject,
            syncState: 'pending',
            cloudRevision: currentRevision.current,
          });
          setAutosaveWarning('');
          if (!isOnline || !isSignedIn) {
            setSaveStatus('Offline');
            return;
          }
          setSaveStatus('Waiting to sync');
          nextSaveDataRef.current = project;
          void processNextSaveRef.current();
        } catch {
          setAutosaveWarning('Local autosave is unavailable in this browser. Export now to avoid losing your work.');
          setSaveStatus('Save failed');
        }
      }
    }, 400);

    return () => window.clearTimeout(timeout);
  }, [project, cloudProjectId, isOnline, isSignedIn]);

  const saveToCloud = async () => {
    if (!isOnline) {
      setNotice('This design is saved on this phone. Reconnect when you want to save it to the cloud.');
      return;
    }
    if (!isSignedIn) {
      setLocation('/sign-in');
      return;
    }
    setSaveStatus('Saving');
    try {
      const created = await createProject.mutateAsync({
        data: {
          name: `${project.teamName || 'Untitled'} - ${project.headline || 'Project'}`,
          project: projectForCloudSave(project, Boolean(accountAccess?.paid)),
          ...(accountAccess?.accessMode === 'guest' ? { guestUsageKey } : {}),
        }
      });
      queryClient.invalidateQueries({ queryKey: getGetAccountAccessQueryKey() });
      lastSaved.current = project;
      saveHypeCardCloudDraft(created.id, window.localStorage, {
        project: projectForLocalSave(project),
        syncState: 'synced',
        cloudRevision: created.revision,
      });
      if (accountAccess?.paid) {
        try {
          const uploads: Promise<unknown>[] = [];
          if (project.mediaType === 'image' && project.mediaId) {
            const blob = await loadMediaBlob(project.mediaId);
            if (blob) uploads.push(uploadProjectMedia(created.id, 'photo', blob, 'photo'));
          }
          if (project.logoMediaId) {
            const blob = await loadMediaBlob(project.logoMediaId);
            if (blob) uploads.push(uploadProjectMedia(created.id, 'logo', blob, 'logo'));
          } else if (project.logo) {
            uploads.push(uploadProjectMedia(created.id, 'logo', await (await fetch(project.logo)).blob(), 'logo'));
          }
          if (project.mediaType === 'video' && project.videoPrepared) {
            const preview = project.mediaId ? await loadMediaBlob(project.mediaId) : undefined;
            const download = project.downloadMediaId ? await loadMediaBlob(project.downloadMediaId) : undefined;
            if (preview) uploads.push(uploadProjectMedia(created.id, 'video_preview', preview, 'preview.mp4'));
            if (download) uploads.push(uploadProjectMedia(created.id, 'video_download', download, 'download.mp4'));
            if (project.photo) uploads.push(uploadProjectMedia(created.id, 'poster', await (await fetch(project.photo)).blob(), 'poster.jpg'));
          }
          await Promise.all(uploads);
          queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(created.id) });
          setNotice('Project and private media saved. Video preview loads when you press Play; download quality loads when you export.');
        } catch (error) {
          setNotice(error instanceof Error ? `${error.message} Your cloud draft was saved; media remains available locally.` : 'Cloud draft saved, but media upload failed.');
        }
      } else {
        setNotice('Design saved. Paid accounts can keep private media; guest and unpaid saves contain design settings only.');
      }
      setLocation(`/studio/hype-card/${created.id}`);
    } catch (e: any) {
      setSaveStatus('Save failed');
      setNotice(e?.status === 409 ? 'Workspace Hype Card limit reached. Use your existing drafts or contact support.' : 'Failed to migrate project to cloud.');
    }
  };

  useEffect(() => {
    if (
      !cloudProjectId
      || !isOnline
      || !accountAccess?.paid
      || !hasDeviceOnlyMedia(project)
      || mediaSyncRef.current
      || initializedForId.current !== cloudProjectId
    ) return;

    let cancelled = false;
    const syncAbortController = new AbortController();
    mediaSyncRef.current = true;
    mediaSyncAbortRef.current = syncAbortController;
    try {
      saveHypeCardCloudDraft(cloudProjectId, window.localStorage, {
        project: projectForLocalSave(project),
        syncState: 'pending',
        cloudRevision: currentRevision.current,
      });
    } catch {
      // The regular autosave path will surface storage failures without stopping media recovery.
    }

    void (async () => {
      let next = project;
      const obsoleteLocalIds: string[] = [];
      const interruptedUploads: ProjectMediaUploadRecord[] = [];
      const trackUpload = (record: ProjectMediaUploadRecord) => {
        interruptedUploads.push(record);
      };

      try {
        if (next.mediaType === 'image' && next.mediaId && !isCloudMediaId(next.mediaId)) {
          const blob = await loadMediaBlob(next.mediaId);
          if (blob) {
            const media = await uploadProjectMedia(cloudProjectId, 'photo', blob, next.videoMeta?.name || 'photo', {
              onClaimCreated: trackUpload,
            });
            await saveMediaBlob(media.id, blob);
            const obsoleteCloudVideo = cloudProjectData?.media.filter((item) =>
              item.mediaRole === 'video_preview'
              || item.mediaRole === 'video_download'
              || item.mediaRole === 'poster'
            ) ?? [];
            await Promise.all(obsoleteCloudVideo.map(async (item) => {
              try {
                await deleteProjectMedia(item.id);
              } catch (error: any) {
                if (error?.status !== 404) throw error;
              }
            }));
            obsoleteLocalIds.push(next.mediaId);
            next = {
              ...next,
              mediaId: media.id,
              downloadMediaId: null,
              posterMediaId: null,
              videoPrepared: false,
              videoMeta: null,
            };
          }
        }

        if (next.logoMediaId && !isCloudMediaId(next.logoMediaId)) {
          const blob = await loadMediaBlob(next.logoMediaId);
          if (blob) {
            const media = await uploadProjectMedia(cloudProjectId, 'logo', blob, 'logo', {
              onClaimCreated: trackUpload,
            });
            await saveMediaBlob(media.id, blob);
            obsoleteLocalIds.push(next.logoMediaId);
            next = { ...next, logoMediaId: media.id };
          }
        }

        const localVideoReady = next.mediaType === 'video'
          && next.videoPrepared
          && next.mediaId
          && next.downloadMediaId
          && !isCloudMediaId(next.mediaId)
          && !isCloudMediaId(next.downloadMediaId)
          && (!next.posterMediaId || !isCloudMediaId(next.posterMediaId));
        if (localVideoReady) {
          const localPoster = next.posterMediaId
            ? await loadMediaBlob(next.posterMediaId)
            : undefined;
          const [preview, download, poster] = await Promise.all([
            loadMediaBlob(next.mediaId!),
            loadMediaBlob(next.downloadMediaId!),
            localPoster ?? (next.photo ? fetch(next.photo).then((response) => response.blob()) : Promise.resolve(undefined)),
          ]);
          if (preview && download && poster && !cancelled && !syncAbortController.signal.aborted) {
            const uploadBytes: Record<'preview' | 'download' | 'poster', number> = {
              preview: 0,
              download: 0,
              poster: 0,
            };
            const totalUploadBytes = preview.size + download.size + poster.size;
            setMediaSyncState({
              status: 'syncing',
              loaded: 0,
              total: totalUploadBytes,
            });
            const updateUploadProgress = (
              key: 'preview' | 'download' | 'poster',
              loaded: number,
              total: number,
            ) => {
              uploadBytes[key] = Math.min(total, loaded);
              setMediaSyncState((current) => ({
                ...current,
                status: 'syncing',
                loaded: uploadBytes.preview + uploadBytes.download + uploadBytes.poster,
                total: totalUploadBytes,
              }));
            };
            const uploadResults = await Promise.allSettled([
              uploadProjectMedia(cloudProjectId, 'video_preview', preview, `${next.videoMeta?.name || 'video'}.preview`, {
                signal: syncAbortController.signal,
                onProgress: (loaded, total) => updateUploadProgress('preview', loaded, total),
                onClaimCreated: trackUpload,
              }),
              uploadProjectMedia(cloudProjectId, 'video_download', download, `${next.videoMeta?.name || 'video'}.download`, {
                signal: syncAbortController.signal,
                onProgress: (loaded, total) => updateUploadProgress('download', loaded, total),
                onClaimCreated: trackUpload,
              }),
              uploadProjectMedia(cloudProjectId, 'poster', poster, `${next.videoMeta?.name || 'video'}.jpg`, {
                signal: syncAbortController.signal,
                onProgress: (loaded, total) => updateUploadProgress('poster', loaded, total),
                onClaimCreated: trackUpload,
              }),
            ]);
            const failedUpload = uploadResults.find((result): result is PromiseRejectedResult => result.status === 'rejected');
            if (failedUpload) throw failedUpload.reason;
            const [previewMedia, downloadMedia, posterMedia] = uploadResults.map((result) => (
              (result as PromiseFulfilledResult<Awaited<ReturnType<typeof completeProjectMediaUpload>>>).value
            ));
            await Promise.all([
              saveMediaBlob(previewMedia.id, preview),
              saveMediaBlob(downloadMedia.id, download),
              saveMediaBlob(posterMedia.id, poster),
            ]);
            const obsoleteCloudPhotos = cloudProjectData?.media.filter((item) => item.mediaRole === 'photo') ?? [];
            await Promise.all(obsoleteCloudPhotos.map(async (item) => {
              try {
                await deleteProjectMedia(item.id);
              } catch (error: any) {
                if (error?.status !== 404) throw error;
              }
            }));
            obsoleteLocalIds.push(next.mediaId!, next.downloadMediaId!);
            if (next.posterMediaId && !isCloudMediaId(next.posterMediaId)) {
              obsoleteLocalIds.push(next.posterMediaId);
            }
            next = {
              ...next,
              mediaId: previewMedia.id,
              downloadMediaId: downloadMedia.id,
              posterMediaId: posterMedia.id,
            };
            setMediaSyncState({ status: 'idle', loaded: totalUploadBytes, total: totalUploadBytes });
          }
        }

        if (!cancelled && next !== project) {
          await Promise.all(obsoleteLocalIds.map((id) => deleteMediaBlob(id).catch(() => undefined)));
          setProject(next);
          setNotice('This design and its prepared media are now saved to the cloud.');
          interruptedUploads.length = 0;
          queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(cloudProjectId) });
          queryClient.invalidateQueries({ queryKey: getGetAccountAccessQueryKey() });
        }
      } catch {
        const cleanupFailures = await cleanupProjectMediaUploads(interruptedUploads);
        if (!cancelled) {
          const cleanupMessage = cleanupFailures.length > 0
            ? ` Cloud cleanup also failed for ${cleanupFailures.length} uploaded item${cleanupFailures.length === 1 ? '' : 's'}; retry cloud sync to try again.`
            : '';
          setMediaSyncState((current) => ({
            ...current,
            status: 'failed',
            message: `The private media sync did not finish. Your local media is safe;${cleanupMessage || ' retry when you are ready.'}`,
          }));
          setNotice(`The design is safe on this phone, but its media did not sync.${cleanupFailures.length > 0 ? ' Some abandoned cloud media could not be removed; retry cloud sync.' : ' You can retry without choosing it again.'}`);
        }
      } finally {
        mediaSyncRef.current = false;
        if (mediaSyncAbortRef.current === syncAbortController) {
          mediaSyncAbortRef.current = null;
        }
      }
    })();

    return () => {
      cancelled = true;
      syncAbortController.abort();
      if (mediaSyncAbortRef.current === syncAbortController) {
        mediaSyncAbortRef.current = null;
        mediaSyncRef.current = false;
        setMediaSyncState((current) => current.status === 'syncing'
          ? {
              ...current,
              status: 'failed',
              message: 'The private media sync was paused. Your local media is safe; retry cloud sync to continue.',
            }
          : current);
      }
    };
  }, [accountAccess?.paid, cloudProjectData, cloudProjectId, isOnline, project, queryClient, syncRetry]);

  const resolveConflict = async (action: 'server' | 'new') => {
    if (action === 'server') {
       if (conflictData) {
         let accepted = hydrateCloudHypeCard(conflictData);
         try {
           const staticMedia = await cacheCloudStaticMedia(conflictData);
           accepted = {
             ...accepted,
             photo: staticMedia.photo,
             logo: staticMedia.logo,
           };
         } catch {
           setNotice('The newest cloud media could not be loaded. Reconnect and try loading the server version again.');
           return;
         }
         saveHypeCardCloudDraft(conflictData.id, window.localStorage, {
           project: projectForLocalSave(accepted),
           syncState: 'synced',
           cloudRevision: conflictData.revision,
         });
         setProject(accepted);
         currentRevision.current = conflictData.revision;
         lastSaved.current = accepted;
         hydratedServerForId.current = null;
         queryClient.setQueryData(getGetProjectQueryKey(conflictData.id), conflictData);
         setConflictData(null);
         setSaveStatus('Saved design');
       } else if (cloudProjectData) {
         const accepted = hydrateCloudHypeCard(cloudProjectData);
         saveHypeCardCloudDraft(cloudProjectData.id, window.localStorage, {
           project: projectForLocalSave(accepted),
           syncState: 'synced',
           cloudRevision: cloudProjectData.revision,
         });
         setProject(accepted);
         currentRevision.current = cloudProjectData.revision;
         lastSaved.current = accepted;
         setSaveStatus('Saved design');
       }
    } else {
       setSaveStatus('Saving');
       try {
         const p = { ...project };
         const created = await createProject.mutateAsync({
           data: {
             name: `${p.teamName || 'Untitled'} - ${p.headline || 'Project'} (Copy)`,
              project: projectForCloudSave(p, Boolean(accountAccess?.paid)),
               ...(accountAccess?.accessMode === 'guest' ? { guestUsageKey: `${guestUsageKey}-copy` } : {}),
           }
         });
          queryClient.invalidateQueries({ queryKey: getGetAccountAccessQueryKey() });
          lastSaved.current = p;
          saveHypeCardCloudDraft(created.id, window.localStorage, {
            project: projectForLocalSave(p),
            syncState: 'synced',
            cloudRevision: created.revision,
          });
         
         setConflictData(null);
         queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
         setLocation(`/studio/hype-card/${created.id}`);
        } catch (e: any) {
         setSaveStatus('Conflict');
          setNotice(e?.status === 409 ? 'Workspace Hype Card limit reached. Use your existing drafts or contact support.' : 'Failed to save as new project. Please try again.');
       }
    }
  };

  const updateProject = <K extends keyof HypeCardProject>(key: K, value: HypeCardProject[K]) => {
    setProject((current) => ({ ...current, format: 'card', [key]: value }));
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

  const cancelVideoPreparation = () => {
    mediaPreparationAbortRef.current?.abort();
    setAutosaveWarning('');
    setPreparingVideo(false);
    setNotice('Video preparation cancelled. Choose the video again when you are ready.');
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
      mediaPreparationAbortRef.current?.abort();
      const preparationAbort = new AbortController();
      mediaPreparationAbortRef.current = preparationAbort;
      try {
        const v = document.createElement('video');
        v.preload = 'auto';
        v.muted = true;
        v.playsInline = true;
        v.src = url;
        await waitForVideoEvent(v, 'loadedmetadata', 10_000, true);
        if (!Number.isFinite(v.duration) || v.duration <= 0) {
          throw new Error('This video has an invalid duration.');
        }
        let preparedVideo: Blob = file;
        let preparedDownload: Blob = file;
        let preparedPreview: Blob = file;
        let conversionSucceeded = false;
        let playbackUrl = url;
        let conversionWarning = '';
        try {
          setNotice('');
          setPreparingVideo(true);
          setAutosaveWarning('Preparing the download video locally… 0%');
          preparedDownload = await transcodeVideoToMp4(
            file,
            (progress) => {
              if (!preparationAbort.signal.aborted) {
                setAutosaveWarning(`Preparing the download video locally… ${Math.round(progress * 100)}%`);
              }
            },
            { signal: preparationAbort.signal },
          );
          setAutosaveWarning('Preparing the preview video locally… 0%');
          preparedPreview = await transcodeVideoToMp4(
            preparedDownload,
            (progress) => {
              if (!preparationAbort.signal.aborted) {
                setAutosaveWarning(`Preparing the preview video locally… ${Math.round(progress * 100)}%`);
              }
            },
            { signal: preparationAbort.signal, longEdge: 640, videoBitsPerSecond: 850_000 },
          );
          conversionSucceeded = true;
          preparedVideo = preparedPreview;
          playbackUrl = URL.createObjectURL(preparedVideo);
        } catch (conversionError) {
          if (preparationAbort.signal.aborted) throw conversionError;
          console.warn('Video conversion unavailable; keeping original locally.', conversionError);
          preparedDownload = file;
          preparedPreview = file;
          const silentAudio = conversionError instanceof Error && conversionError.name === 'AudioCaptureUnavailable';
          const stalled = conversionError instanceof Error && conversionError.message.toLowerCase().includes('stalled');
          const changedLength = conversionError instanceof Error && conversionError.message.includes('changed the clip length');
          conversionWarning = silentAudio
            ? 'The prepared video did not contain audible sound, so the original video was kept on this device.'
            : changedLength
            ? 'Video preparation changed the clip length, so the original video was kept on this device instead.'
            : stalled
            ? 'Video preparation stopped because this browser was not making progress. The original video will stay local.'
            : 'This browser could not create a smaller MP4, so the original video will stay local.';
        }

        const previewId = `${id}-preview`;
        const downloadId = `${id}-download`;
        const posterId = `${id}-poster`;
        await Promise.all([
          saveMediaBlob(previewId, preparedPreview),
          saveMediaBlob(downloadId, preparedDownload),
        ]);
        if (project.mediaId) await deleteMediaBlob(project.mediaId).catch(console.warn);
        if (project.downloadMediaId) await deleteMediaBlob(project.downloadMediaId).catch(console.warn);
        if (project.posterMediaId && !isCloudMediaId(project.posterMediaId)) {
          await deleteMediaBlob(project.posterMediaId).catch(console.warn);
        }
        setVideoUrl(playbackUrl);
        
        // Generate poster for project.photo as fallback
        v.currentTime = Math.min(0.05, v.duration / 2);
        await waitForVideoEvent(v, 'seeked', 5_000, false);
        let poster: string | null = null;
        try {
          const cv = document.createElement('canvas');
          cv.width = v.videoWidth || 640;
          cv.height = v.videoHeight || 640;
          cv.getContext('2d')?.drawImage(v, 0, 0, cv.width, cv.height);
          poster = cv.toDataURL('image/jpeg', 0.8);
        } catch (e) {}

        const posterBlob = poster
          ? await fetch(poster).then((response) => response.blob())
          : null;
        if (posterBlob) {
          await saveMediaBlob(posterId, posterBlob);
        }

        setProject(curr => ({
          ...curr,
          mediaType: 'video',
          mediaId: previewId,
          downloadMediaId: downloadId,
          posterMediaId: posterBlob ? posterId : null,
          videoPrepared: conversionSucceeded,
          videoMeta: {
            name: preparedVideo.type.includes('mp4')
              ? file.name.replace(/\.[^.]+$/, '') + '.mp4'
              : file.name,
            type: preparedVideo.type || file.type,
            size: preparedDownload.size,
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
        setNotice(conversionWarning || (cloudProjectId
          ? conversionSucceeded
            ? 'Video attached on this phone. Cloud sync can continue in the background.'
            : 'The original video is attached on this phone and remains available for local export.'
          : ''));
        if (playbackUrl !== url) URL.revokeObjectURL(url);
      } catch (err) {
        URL.revokeObjectURL(url);
        if (preparationAbort.signal.aborted) return;
        setAutosaveWarning('');
        setNotice(err instanceof Error ? err.message : 'Could not save video to local storage.');
      } finally {
        if (mediaPreparationAbortRef.current === preparationAbort) {
          mediaPreparationAbortRef.current = null;
          setPreparingVideo(false);
        }
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
        if (project.mediaId && !isCloudMediaId(project.mediaId)) {
          await deleteMediaBlob(project.mediaId).catch(console.warn);
        }
        setVideoUrl(undefined);
        setProject(curr => ({
          ...curr,
          mediaType: 'image',
            format: 'card',
          mediaId: id,
          downloadMediaId: null,
          posterMediaId: null,
          videoPrepared: false,
          videoMeta: null,
          photo: res,
          photoTransform: defaultProject().photoTransform,
          adjustments: defaultProject().adjustments
        }));
         setTemplateMediaNotice(false);
        setValidation('');
        setAutosaveWarning('');
        if (cloudProjectId) setNotice('Photo attached on this phone. Cloud sync can continue in the background.');
      } catch (error) {
        console.error('Failed to save image media', error);
        setNotice('That image could not be saved in this browser. Try another image or browser.');
      }
    } else {
      setNotice('Please choose a PNG, JPG, WEBP, GIF, MP4, MOV, or WebM file.');
    }
  };

  const handleLogoUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !file.type.startsWith('image/')) {
      setNotice('Please choose a valid team logo image.');
      return;
    }
    try {
      const logo = await blobToDataUrl(file);
      if (!isSafeRasterDataUrl(logo)) throw new Error('Invalid logo');
      const logoId = `logo-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      await saveMediaBlob(logoId, file);
      if (project.logoMediaId && !isCloudMediaId(project.logoMediaId)) {
        await deleteMediaBlob(project.logoMediaId).catch(() => undefined);
      }
      setProject((current) => ({ ...current, logo, logoMediaId: logoId }));
      if (cloudProjectId) setNotice('Logo attached on this phone. Cloud sync can continue in the background.');
    } catch {
      setNotice('That logo could not be saved. Try a smaller PNG, JPG, or WebP.');
    }
  };

  const handleMediaRemove = async () => {
    if (project.mediaId) {
      await deleteMediaBlob(project.mediaId).catch(console.warn);
    }
    if (project.downloadMediaId) await deleteMediaBlob(project.downloadMediaId).catch(console.warn);
    for (const id of [project.mediaId, project.downloadMediaId, project.posterMediaId]) {
      if (isOnline && isCloudMediaId(id)) await deleteProjectMedia(id).catch(() => undefined);
    }
    setVideoUrl(undefined);
    setTemplateMediaNotice(false);
    setProject(clearHypeCardMedia);
  };

  const handleExport = async (statsUrl?: string) => {
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
    
    if (project.mediaType === 'video') {
      setExporting(true);
      setExportProgress(0);
      exportAbortRef.current = new AbortController();
      let temporaryExportUrl: string | null = null;
      try {
        let video = videoRef.current;
        if (project.downloadMediaId) {
          let downloadBlob = await loadMediaBlob(project.downloadMediaId);
          if (!downloadBlob && cloudProjectId) downloadBlob = await serveProjectMedia(project.downloadMediaId);
          if (!downloadBlob) throw new Error('Download-quality video is unavailable. Please choose the video again.');
          temporaryExportUrl = URL.createObjectURL(downloadBlob);
          video = document.createElement('video');
          video.preload = 'auto';
          video.muted = true;
          video.playsInline = true;
          video.src = temporaryExportUrl;
          await waitForVideoEvent(video, 'loadedmetadata', 10_000, true);
        }
        if (!video) throw new Error('The download-quality video is unavailable. Please choose the video again.');
        const { width, height } = getDimensions(project.format);
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Could not create canvas context');

        const ns = 'export';
        const bgSvg = buildHypeCardSvg(project, 'bg', ns);
        const fgSvg = buildHypeCardSvg(project, 'fg', ns, statsUrl);
        const clipInfo = getPhotoClipInfo(project, ns);

        // Load background and foreground as images
        const [bgImg, fgImg] = await Promise.all([
          svgToImage(bgSvg, width, height),
          svgToImage(fgSvg, width, height)
        ]);

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
             if (project.videoFit === 'fit') {
               ctx.save();
               ctx.filter = 'blur(18px) brightness(0.35)';
               drawVideoContain(ctx, v, clipInfo.x, clipInfo.y, clipInfo.w, clipInfo.h, 'fill');
               ctx.restore();
             }
             drawVideoContain(ctx, v, clipInfo.x, clipInfo.y, clipInfo.w, clipInfo.h, project.videoFit);
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
        if (temporaryExportUrl) URL.revokeObjectURL(temporaryExportUrl);
        setExporting(false);
      }
    } else {
      // Fallback to existing image export...
      try {
        const dimensions = getDimensions(project.format);
        const svg = buildHypeCardSvg(project, 'all', 'export', statsUrl);
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

  const copyShareDestination = async (share: HypeCardShare, label: string) => {
    const url = shareUrlFor(share);
    try {
      await navigator.clipboard.writeText(url);
      setNotice(`${label} copied.`);
    } catch {
      setNotice(`Select and copy the ${label.toLowerCase()} above.`);
    }
  };

  const shareDestination = async (share: HypeCardShare, statsOnly: boolean) => {
    const url = shareUrlFor(share);
    try {
      if (navigator.share) {
        await navigator.share({
          title: share.title,
          text: statsOnly ? 'View the finalized Pixl Sports stats.' : 'Watch this Pixl Sports Hype Card.',
          url,
        });
        setNotice(statsOnly ? 'Stats link shared.' : 'Player page shared.');
      } else {
        await navigator.clipboard.writeText(url);
        setNotice(statsOnly ? 'Stats link copied.' : 'Share link copied.');
      }
    } catch {
      setNotice(statsOnly ? 'Stats link is ready to copy.' : 'Player page is ready to copy.');
    }
  };

  const handleExportWithStatsLink = () => {
    setValidation('');
    setNotice('');
    if (!isOnline) {
      setNotice('Reconnect to create a stats link before exporting it onto the card.');
      return;
    }
    if (!isSignedIn) {
      setLocation('/sign-in');
      return;
    }
    if (existingStatsShare) {
      void handleExport(shareUrlFor(existingStatsShare));
      return;
    }

    setLinkedExportPending(true);
    setShareMode('stats');
    setShareTrackerProjectId('none');
    setShareSport(profile.sport ?? 'basketball');
    setShareExpiresInDays('30');
    setShareDialogOpen(true);
  };

  const handleShareClick = () => {
    setValidation('');
    setNotice('');
    setShareVideoQuality('standard');
    setShareVideoTooLargeQuality(null);
    if (!isOnline) {
      setNotice('Your Hype Card is ready on this phone. Reconnect to post it to an Athlete Hype Page.');
      return;
    }
    if (!isSignedIn) {
      setLocation('/sign-in');
      return;
    }
    if (existingShare && isOwnedHypeCardShare(existingShare)) {
      setShareMode('card');
      setShareTrackerProjectId('none');
      setShareSport(profile.sport ?? existingShare.sport ?? 'basketball');
      setShareExpiresInDays(String(existingShare.expiresInDays));
      setShareMediaName(existingShare.mediaName);
    } else {
      setShareMode('card');
      setShareTrackerProjectId('none');
      setShareSport(profile.sport ?? 'basketball');
      setShareExpiresInDays('30');
      setShareMediaName(cleanMediaName(project.headline || project.videoMeta?.name));
    }
    setShareDialogOpen(true);
  };

  const handlePublishShare = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isOnline) {
      setShareDialogOpen(false);
        setNotice('Reconnect to post this Hype Card to the Athlete Hype Page.');
      return;
    }
    setSharing(true);
    setShareDialogOpen(false);
    setShareProgress(0);
    setShareStage('Starting the Athlete Hype Page upload…');
    const shareAbortController = new AbortController();
    sharePreparationAbortRef.current = shareAbortController;
    const linkedExport = linkedExportPending;
    try {
      const isStatsOnly = shareMode === 'stats';
      const replacementShare = isStatsOnly ? existingStatsShare : existingShare;
      if (!isStatsOnly && project.mediaType === 'video' && (!videoUrl || !videoRef.current)) {
        throw new Error('Add a video and wait for its preview to finish loading before publishing.');
      }
      if (!isStatsOnly && project.mediaType !== 'video' && (project.mediaType !== 'image' || !project.photo)) {
        throw new Error('Add a photo before publishing this Hype Card.');
      }
      if (isStatsOnly && (shareTrackerProjectId === 'none' || !profile.athleteName)) {
        throw new Error('Choose a stats project and add an athlete name in Profile Settings before creating a stats link.');
      }
      let claimId = '';
      let posterClaimId: string | undefined = undefined;
      let mediaKind: 'video' | 'image' = 'video';

      const shareProject: HypeCardProject = {
        ...project,
        mediaId: null,
      };

      if (isStatsOnly) {
        mediaKind = project.mediaType === 'image' ? 'image' : 'video';
        setShareProgress(0.75);
        setShareStage('Creating the finalized stats link…');
      } else if (project.mediaType === 'video' && videoUrl && videoRef.current) {
        setShareStage('Preparing the clip on this device for the Athlete Hype Page…');
        const prepared = await prepareHypeCardShareMedia(
          videoRef.current,
          project,
          (progress) => setShareProgress(progress * 0.6),
          {
            signal: shareAbortController.signal,
            quality: shareVideoQuality,
            onAudioCheck: () => {
              setShareStage('Checking audio before posting…');
              setShareProgress((current) => Math.max(current, 0.6));
            },
          },
        );
        const videoContentType = prepared.videoContentType.startsWith('video/mp4') ? 'video/mp4' : 'video/webm';
        if (prepared.video.size > MAX_HOSTED_VIDEO_BYTES) {
          const error = new Error(
            shareVideoQuality === 'standard'
              ? 'The prepared video is too large for the Athlete Hype Page.'
              : 'The lower-quality prepared video is still too large for the Athlete Hype Page.',
          );
          error.name = 'HostedVideoTooLarge';
          throw error;
        }
        setShareProgress(0.6);
        setShareStage('Uploading the prepared video and poster…');
        const [videoUpload, posterUpload] = await Promise.all([
          requestHypeCardShareUploadUrl({ mediaKind: 'video', contentType: videoContentType }),
          requestHypeCardShareUploadUrl({ mediaKind: 'poster', contentType: 'image/jpeg' }),
        ]);
        const uploadBytes = {
          video: 0,
          poster: 0,
        };
        const totalUploadBytes = prepared.video.size + prepared.poster.size;
        const updateUploadProgress = () => {
          const transferred = uploadBytes.video + uploadBytes.poster;
          setShareProgress(0.6 + (totalUploadBytes ? transferred / totalUploadBytes : 0) * 0.3);
        };
        await Promise.all([
          uploadHypeCardShareMedia(
            videoUpload.uploadUrl,
            prepared.video,
            videoContentType,
            shareAbortController.signal,
            (progress) => {
              uploadBytes.video = prepared.video.size * progress;
              updateUploadProgress();
            },
          ),
          uploadHypeCardShareMedia(
            posterUpload.uploadUrl,
            prepared.poster,
            'image/jpeg',
            shareAbortController.signal,
            (progress) => {
              uploadBytes.poster = prepared.poster.size * progress;
              updateUploadProgress();
            },
          ),
        ]);
        setShareProgress(0.9);

        const duration = prepared.duration;
        mediaKind = 'video';
        claimId = videoUpload.claimId;
        posterClaimId = posterUpload.claimId;

        shareProject.mediaType = 'video';
        shareProject.photo = null;
        shareProject.trimStart = 0;
        shareProject.trimEnd = duration;
        shareProject.videoMeta = {
          name: project.videoMeta?.name || 'Hype Card highlight',
          type: videoContentType,
          size: prepared.video.size,
          duration,
        };
      } else {
        setShareProgress(0.2);
        setShareStage('Preparing the Hype Card image…');
        const dimensions = getDimensions(project.format);
        const svg = buildHypeCardSvg(project, 'all', 'export');
        const { dataUrl, mimeType } = await rasterizeSvgForDownload(
          svg,
          dimensions.width,
          dimensions.height,
          'jpeg',
        );
        setShareProgress(0.5);
        const res = await fetch(dataUrl);
        const blob = await res.blob();

        const imageUpload = await requestHypeCardShareUploadUrl({ mediaKind: 'image', contentType: mimeType as any });
        setShareStage('Uploading the prepared Hype Card image…');
        const uploadResponse = await fetch(imageUpload.uploadUrl, { method: 'PUT', headers: { 'Content-Type': mimeType }, body: blob, signal: shareAbortController.signal });
        if (!uploadResponse.ok) throw new Error('The prepared image could not be uploaded.');

        mediaKind = 'image';
        claimId = imageUpload.claimId;

        shareProject.mediaType = 'image';
        shareProject.photo = 'shared-image';
        shareProject.trimStart = 0;
        shareProject.trimEnd = 0;
        shareProject.videoMeta = null;
        setShareProgress(0.9);
      }

      if (shareAbortController.signal.aborted) {
        const cancellation = new Error('Athlete Hype Page video preparation was cancelled.');
        cancellation.name = 'AbortError';
        throw cancellation;
      }
      setShareStage(isStatsOnly ? 'Saving the finalized stats link…' : 'Saving the Athlete Hype Page video…');
      const shareManifestProject = isStatsOnly
        ? null
        : { ...shareProject, mediaName: shareMediaName.trim() };
      const created = await createHypeShare.mutateAsync({
        data: {
          mediaName: shareMediaName.trim(),
          title: `${project.playerName || project.teamName || 'Pixl Sports'} · ${project.headline}`,
          slug: slugify(`${project.teamName}-${project.playerName}-${project.headline}`).slice(0, 80) || 'hype-card',
          manifest: isStatsOnly
            ? { version: 1, shareKey, shareMode: 'stats' }
            : { version: 1, shareKey, project: shareManifestProject },
          shareKey,
          shareMode,
          mediaType: mediaKind,
          mediaUploadClaimId: isStatsOnly ? null : claimId,
          posterUploadClaimId: isStatsOnly ? null : posterClaimId,
           trackerProjectId: isStatsOnly && shareTrackerProjectId !== 'none' ? shareTrackerProjectId : null,
           sport: isStatsOnly && shareTrackerProjectId !== 'none' ? ((profile.sport ?? shareSport) as any) : null,
           athleteName: isStatsOnly && shareTrackerProjectId !== 'none' ? profile.athleteName : null,
          expiresInDays: parseInt(shareExpiresInDays, 10),
          replaceShareToken: replacementShare?.shareToken ?? null,
        },
      });

      if (isStatsOnly) setPublishedStatsShare(created);
      else setPublishedShare(created);
      await queryClient.invalidateQueries({ queryKey: getListHypeCardSharesQueryKey() });
      const url = shareUrlFor(created);
      if (!linkedExport && isStatsOnly) {
        try {
          if (navigator.share) await navigator.share({ title: created.title, text: 'View the finalized Pixl Sports stats with this video.', url });
          else await navigator.clipboard.writeText(url);
        } catch {
          await navigator.clipboard.writeText(url).catch(() => undefined);
        }
      }
       setNotice(isStatsOnly
        ? linkedExport
          ? `Stats link ready for ${shareExpiresInDays} days. Printing it onto your export now.`
          : `Stats link ready for ${shareExpiresInDays} days. Your video stays on this phone.`
         : project.mediaType === 'video'
           ? `Video added to Athlete Hype Page for ${shareExpiresInDays} days.`
           : `Hype Card added to Athlete Hype Page for ${shareExpiresInDays} days.`);
       setShareVideoQuality('standard');
       setShareVideoTooLargeQuality(null);
      setLinkedExportPending(false);
      if (linkedExport) await handleExport(url);
      if (!isStatsOnly && !linkedExport) {
        if (athleteHypePage && (athleteHypePage.paused || !athleteHypePage.showHypeCard)) {
          await updateAthleteHypePage.mutateAsync({
            inviteToken: athleteHypePage.inviteToken,
            data: {
              athleteName: athleteHypePage.athleteName,
              teamName: athleteHypePage.teamName,
              seasonName: athleteHypePage.seasonName,
              seasonEndsAt: athleteHypePage.seasonEndsAt,
              timezone: athleteHypePage.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || '',
              sport: athleteHypePage.sport,
              trackerProjectId: athleteHypePage.trackerProjectId,
              scheduleProjectId: athleteHypePage.scheduleProjectId,
              showHypeCard: true,
              showStats: athleteHypePage.showStats,
              showSchedule: athleteHypePage.showSchedule,
              paused: false,
            },
          });
          await queryClient.invalidateQueries({ queryKey: getListAthleteInvitesQueryKey() });
        }
        setLocation(athleteHypePage ? `/fan/${athleteHypePage.inviteToken}` : '/studio/athlete-page');
      }
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : '';
      const hostedVideoTooLarge = error instanceof Error && error.name === 'HostedVideoTooLarge';
      const cancelled = error instanceof Error
        && (error.name === 'AbortError' || message === 'Export cancelled' || message.toLowerCase().includes('preparation was cancelled'));
      if (hostedVideoTooLarge) {
        setShareVideoTooLargeQuality(shareVideoQuality);
        if (shareVideoQuality === 'standard') {
          setShareVideoQuality('compact');
          setNotice('The prepared video is over 35 MB. Retry with a lower-quality browser-prepared copy, or download the Hype Card to this device instead.');
        } else {
          setNotice('The lower-quality browser-prepared video is still over 35 MB. Download the Hype Card to this device instead; your original video remains local.');
        }
        setShareDialogOpen(true);
      } else {
        setNotice(cancelled
          ? 'Athlete Hype Page upload cancelled. Your Hype Card is still available for download on this device.'
          : message || 'Could not add this media to the Athlete Hype Page.');
      }
    } finally {
      setLinkedExportPending(false);
      if (sharePreparationAbortRef.current === shareAbortController) {
        sharePreparationAbortRef.current = null;
      }
      setShareStage('');
      setSharing(false);
    }
  };

  const cancelSharePublish = () => {
    sharePreparationAbortRef.current?.abort();
  };

  const revokeShare = async () => {
    if (!existingShare || !window.confirm('Revoke this link and remove its hosted Hype Card media?')) return;
    try {
      await deleteHypeShare.mutateAsync({ shareToken: existingShare.shareToken });
      setPublishedShare(null);
      await queryClient.invalidateQueries({ queryKey: getListHypeCardSharesQueryKey() });
      setNotice('Hype Card removed from Athlete Hype Page and shared media deleted.');
    } catch {
      setNotice('The interactive link could not be revoked.');
    }
  };

  const revokeStatsShare = async () => {
    if (!existingStatsShare || !window.confirm('Revoke this stats link? The video on your phone will not be affected.')) return;
    try {
      await deleteHypeShare.mutateAsync({ shareToken: existingStatsShare.shareToken });
      setPublishedStatsShare(null);
      await queryClient.invalidateQueries({ queryKey: getListHypeCardSharesQueryKey() });
      setNotice('Stats link revoked. Your local video is still available.');
    } catch {
      setNotice('The stats link could not be revoked.');
    }
  };

  const deviceOnlyMedia = hasDeviceOnlyMedia(project);
  const successShare = shareMode === 'stats' ? existingStatsShare : existingShare;
  const deviceMediaMessage = !isOnline
    ? 'Media is attached on this phone. Reconnect only if you want a cloud copy or Athlete Hype Page post.'
    : project.mediaType === 'video' && !project.videoPrepared
      ? 'The original video is attached on this phone and remains available for local export.'
      : accountAccess?.paid
        ? 'Media is attached on this phone and waiting for its cloud copy.'
        : 'Media is attached on this phone. Your downloadable Hype Card stays fully local.';

  return (
    <div className="moment-studio flex min-h-[100dvh] flex-col bg-muted sm:fixed sm:inset-0 sm:h-auto sm:min-h-0 sm:overflow-hidden">
      <header className="sticky top-0 z-40 flex min-h-14 shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-background px-3 py-2 sm:static sm:px-4">
        <div className="flex min-w-0 basis-full items-center gap-2 sm:gap-3 xl:basis-auto xl:flex-1">
          <Link href="/studio" className="grid h-9 w-9 shrink-0 place-items-center border border-border bg-background hover:border-primary hover:bg-muted clip-angled-sm transition-colors" aria-label="Back to studio">
            <ArrowLeft className="h-4 w-4" />
          </Link>
           <h1 className="min-w-0 truncate font-display text-lg tracking-wide text-foreground sm:text-xl">Hype Cards</h1>
           <div className="ml-auto flex shrink-0 items-center gap-2 sm:ml-4">
             <div className={`hidden items-center gap-2 whitespace-nowrap px-3 py-1.5 text-xs font-bold uppercase tracking-widest clip-angled-sm border sm:flex ${saveStatus === 'Saving' ? 'bg-primary/10 text-primary border-primary/20' : saveStatus === 'Save failed' ? 'bg-destructive/10 text-destructive border-destructive/20' : saveStatus === 'Conflict' ? 'bg-orange-500/10 text-orange-500 border-orange-500/20' : saveStatus === 'Offline' || saveStatus === 'Waiting to sync' ? 'border-amber-300 bg-amber-50 text-amber-900' : 'bg-muted text-muted-foreground border-border'}`}>
               {saveStatus === 'Saving' || saveStatus === 'Waiting to sync' ? <RotateCw className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
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
            <Button variant="outline" size="icon" onClick={() => setMobilePreviewOpen(true)} className="rounded-none clip-angled-sm sm:hidden" aria-label="Preview">
              <Eye className="h-4 w-4" />
            </Button>
           </div>
        </div>
      </header>

      {deviceOnlyMedia && mediaSyncState.status === 'idle' && (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-primary/25 bg-primary/10 px-4 py-2 text-xs font-medium text-foreground" role="status" aria-live="polite">
          <span><strong className="uppercase tracking-wider text-primary">On this device:</strong> {deviceMediaMessage}</span>
          {cloudProjectId && isOnline && accountAccess?.paid && !(project.mediaType === 'video' && !project.videoPrepared) && (
            <button
              type="button"
              className="font-bold uppercase tracking-wide text-primary underline underline-offset-2"
              onClick={() => setSyncRetry((value) => value + 1)}
            >
              Retry cloud sync
            </button>
          )}
        </div>
      )}

      {cloudProjectId && (mediaSyncState.status === 'syncing' || mediaSyncState.status === 'failed') && (
        <div
          className={`flex shrink-0 flex-wrap items-center gap-3 border-b px-4 py-3 text-sm ${
            mediaSyncState.status === 'failed'
              ? 'border-amber-700 bg-amber-300 text-amber-950'
              : 'border-primary/25 bg-primary/10 text-foreground'
          }`}
          role={mediaSyncState.status === 'failed' ? 'alert' : 'status'}
          aria-live={mediaSyncState.status === 'failed' ? 'assertive' : 'polite'}
          data-testid="private-media-sync"
        >
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs font-bold uppercase tracking-widest">
              <span>{mediaSyncState.status === 'failed' ? 'Private media sync paused' : 'Syncing private media'}</span>
              <span data-testid="private-media-sync-progress">
                {mediaSyncState.total > 0 ? Math.round((mediaSyncState.loaded / mediaSyncState.total) * 100) : 0}%
                {' · '}
                {formatMediaBytes(mediaSyncState.loaded)} of {formatMediaBytes(mediaSyncState.total)}
              </span>
            </div>
            <div
              className="mt-2 h-2 overflow-hidden bg-background/60"
              role="progressbar"
              aria-label={`Private media sync ${mediaSyncState.total > 0 ? Math.round((mediaSyncState.loaded / mediaSyncState.total) * 100) : 0}%`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={mediaSyncState.total > 0 ? Math.round((mediaSyncState.loaded / mediaSyncState.total) * 100) : 0}
            >
              <div
                className={`h-full transition-[width] duration-300 ${mediaSyncState.status === 'failed' ? 'bg-amber-900' : 'bg-primary'}`}
                style={{ width: `${Math.max(mediaSyncState.status === 'syncing' ? 3 : 0, mediaSyncState.total > 0 ? (mediaSyncState.loaded / mediaSyncState.total) * 100 : 0)}%` }}
              />
            </div>
            {mediaSyncState.message && (
              <p className="mt-2 text-xs font-medium leading-relaxed">{mediaSyncState.message}</p>
            )}
          </div>
          <button
            type="button"
            className="shrink-0 font-bold uppercase tracking-wide underline underline-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => setSyncRetry((value) => value + 1)}
            disabled={!isOnline || !accountAccess?.paid}
          >
            Retry cloud sync
          </button>
        </div>
      )}

      {validation && (
        <div className="flex shrink-0 items-start gap-2 border-b border-destructive/20 bg-destructive/10 px-4 py-2 text-xs font-bold leading-relaxed text-destructive" role="alert">
          <span>{validation}</span>
        </div>
      )}

      {notice && (
        <div className={`flex shrink-0 flex-wrap items-center justify-between gap-3 border-b px-4 py-2 text-sm font-bold ${
          noticeTone === 'success'
            ? 'border-emerald-800 bg-emerald-700 text-white'
            : noticeTone === 'warning'
              ? 'border-amber-700 bg-amber-300 text-amber-950'
              : 'border-border bg-destructive text-destructive-foreground'
        }`} role={noticeTone === 'error' ? 'alert' : 'status'} aria-live={noticeTone === 'error' ? 'assertive' : 'polite'} data-testid="hype-card-notice" data-tone={noticeTone}>
          {notice}
          <div className="flex shrink-0 items-center gap-2">
            {isShareSuccessNotice && successShare && shareMode === 'stats' && (
              <>
                <button
                  type="button"
                  onClick={() => void copyShareDestination(successShare, shareMode === 'stats' ? 'Stats link' : 'Share link')}
                  className="inline-flex min-h-8 items-center gap-2 border border-white/40 bg-white/10 px-3 text-[10px] font-bold uppercase tracking-wider hover:bg-white/20"
                  data-testid="button-copy-success-destination"
                >
                  <Clipboard className="h-3.5 w-3.5" /> Copy destination
                </button>
                <button
                  type="button"
                  onClick={() => void shareDestination(successShare, shareMode === 'stats')}
                  className="inline-flex min-h-8 items-center gap-2 border border-white/40 bg-white/10 px-3 text-[10px] font-bold uppercase tracking-wider hover:bg-white/20"
                  data-testid="button-share-success-destination"
                >
                  <Share2 className="h-3.5 w-3.5" /> Share
                </button>
                <a
                  href={shareUrlFor(successShare)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-8 items-center gap-2 border border-white/40 bg-white/10 px-3 text-[10px] font-bold uppercase tracking-wider hover:bg-white/20"
                  data-testid="link-preview-recipient-success"
                >
                  <Eye className="h-3.5 w-3.5" /> Preview recipient view
                </a>
              </>
            )}
            {isShareSuccessNotice && successShare && shareMode === 'card' && (
              <Link
                href="/studio/athlete-page"
                className="inline-flex min-h-8 items-center gap-2 border border-white/40 bg-white/10 px-3 text-[10px] font-bold uppercase tracking-wider hover:bg-white/20"
                data-testid="link-manage-athlete-page-success"
              >
                <Eye className="h-3.5 w-3.5" /> Manage Athlete Hype Page
              </Link>
            )}
            <button type="button" onClick={() => setNotice('')} aria-label="Dismiss notice"><X className="h-4 w-4" /></button>
          </div>
        </div>
      )}

      {existingShare && (
        <div className="flex shrink-0 flex-col gap-2 border-b border-primary/25 bg-primary/10 px-4 py-3 text-sm sm:flex-row sm:items-center">
          <span className="shrink-0 text-xs font-bold uppercase tracking-widest text-primary">Athlete Hype Page</span>
          <span className="min-w-0 flex-1 text-xs font-medium leading-relaxed text-muted-foreground">The latest playable Hype Card is available on the Athlete Hype Page with its stats, Game Day Live, and event cards.</span>
          <Link href="/studio/athlete-page" className="inline-flex min-h-9 items-center justify-center gap-2 border border-border bg-background px-3 text-xs font-bold uppercase tracking-wider hover:border-primary hover:bg-muted" data-testid="link-manage-athlete-page">
            <Eye className="h-4 w-4" /> Manage
          </Link>
          <Button type="button" size="sm" variant="outline" className="relative rounded-none" onClick={() => setReplyDialogOpen(true)}>
            <MessageCircle className="mr-2 h-4 w-4" /> Replies
            {Boolean(shareReplies?.unreadCount) && <span className="ml-2 bg-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground">{shareReplies?.unreadCount}</span>}
          </Button>
          <Button type="button" size="sm" variant="outline" className="rounded-none text-destructive" onClick={revokeShare} disabled={deleteHypeShare.isPending}><Link2Off className="mr-2 h-4 w-4" /> Revoke</Button>
        </div>
      )}
      {existingStatsShare && (
        <div className="flex shrink-0 flex-col gap-2 border-b border-primary/25 bg-primary/10 px-4 py-3 text-sm">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <span className="shrink-0 text-xs font-bold uppercase tracking-widest text-primary">Stats link</span>
          <input readOnly value={shareUrlFor(existingStatsShare)} onFocus={(event) => event.currentTarget.select()} className="min-w-0 flex-1 border border-primary/25 bg-background px-3 py-2 text-xs font-medium" aria-label="Finalized stats link" />
          <Button type="button" size="sm" variant="outline" className="rounded-none" onClick={() => void copyShareDestination(existingStatsShare, 'Stats link')}><Clipboard className="mr-2 h-4 w-4" /> Copy</Button>
          <Button type="button" size="sm" variant="outline" className="rounded-none" onClick={() => void shareDestination(existingStatsShare, true)}><Share2 className="mr-2 h-4 w-4" /> Share</Button>
          <a
            href={shareUrlFor(existingStatsShare)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-9 items-center gap-2 border border-border bg-background px-3 text-xs font-bold uppercase tracking-wider hover:border-primary hover:bg-muted"
            data-testid="link-preview-stats-recipient"
          >
            <Eye className="h-4 w-4" /> Preview
          </a>
            <Button type="button" size="sm" variant="outline" className="rounded-none text-destructive" onClick={revokeStatsShare} disabled={deleteHypeShare.isPending}><Link2Off className="mr-2 h-4 w-4" /> Revoke</Button>
          </div>
          <p className="text-[10px] font-medium leading-relaxed text-muted-foreground">
            Opens finalized stats only · available until {new Date(existingStatsShare.expiresAt).toLocaleDateString()} · revoking it makes this destination unavailable.
          </p>
        </div>
      )}

      {autosaveWarning && (
        <div className="flex shrink-0 items-center justify-between border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-950">
          {autosaveWarning}
          {preparingVideo ? (
            <button type="button" onClick={cancelVideoPreparation} className="ml-3 font-bold uppercase tracking-wide underline" aria-label="Cancel video preparation">
              Cancel
            </button>
          ) : (
            <button type="button" onClick={() => setAutosaveWarning('')} aria-label="Dismiss autosave warning"><X className="h-4 w-4" /></button>
          )}
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
              <div>
                <HypeField
                  label="Custom moment"
                  value={project.headline}
                  onChange={(value) => updateProject('headline', value)}
                  placeholder="Big Play!"
                />
                <p className="mt-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Type the moment you want on your card. For example: Big Play!</p>
              </div>
            </Section>}

            {walkthroughStep === 1 && <Section title="Media" icon={ImagePlus}>
              <div className="hidden sm:block">
               <p className="mb-4 text-xs text-muted-foreground">{accountAccess?.paid ? <>Paid accounts keep private photos, logos, posters, and two prepared video qualities in cloud storage. Guest and unpaid saves keep design settings only. Preview video loads after Play; download quality loads only when you export. {PUBLIC_SHARE_MEDIA}</> : <>Add a photo or video up to 120MB. Guest and unpaid cloud saves contain design settings only; {LOCAL_MEDIA_DEFAULT} {PUBLIC_SHARE_MEDIA}</>}</p>
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
              <MediaAssetControls
                hasMedia={Boolean(project.mediaType)}
                hasLogo={Boolean(project.logo)}
                onMediaChange={handleMediaUpload}
                onMediaRemove={handleMediaRemove}
                onLogoChange={handleLogoUpload}
                onLogoRemove={async () => {
                  if (isCloudMediaId(project.logoMediaId)) await deleteProjectMedia(project.logoMediaId).catch(() => undefined);
                  if (project.logoMediaId) await deleteMediaBlob(project.logoMediaId).catch(() => undefined);
                  setProject((current) => ({ ...current, logo: null, logoMediaId: null }));
                }}
              />
              {project.mediaType && (
                <div className="mt-4">
                  <MediaFramingControls
                    project={project}
                    onReset={() => setProject((current) => ({ ...current, photoTransform: defaultProject().photoTransform }))}
                    onTransformChange={updateTransform}
                    onVideoFitChange={(value) => updateProject('videoFit', value)}
                  >
                    <div className="mt-4 border-t border-border pt-3">
                      <MediaAdjustmentControls
                        project={project}
                        showAdvanced={showAdvanced}
                        onToggle={() => setShowAdvanced((open) => !open)}
                        onAdjustmentChange={updateAdjustment}
                        className="rounded-none border-0 bg-transparent p-0"
                      />
                    </div>
                  </MediaFramingControls>
                </div>
              )}
              {project.mediaType === 'video' && (
                <div className="mt-3">
                  <MediaTrimAndAudioControls
                    project={project}
                    exportSupport={exportSupport}
                    includeAudio={includeAudio}
                    audioId="include-audio"
                    onAudioChange={setIncludeAudio}
                    onTrimChange={updateTrim}
                  />
                </div>
              )}
              {project.mediaType === 'image' && (
                <div className="mt-3">
                  <MediaImageDownloadControls imageFormat={imageFormat} onFormatChange={setImageFormat} />
                </div>
              )}
              </div>
              <div className="sm:hidden">
                 <p className="mb-4 text-xs text-muted-foreground">{accountAccess?.paid ? <>Paid accounts keep private photos, logos, posters, and two prepared video qualities in cloud storage. {PUBLIC_SHARE_MEDIA}</> : <>Add a photo or video up to 120MB. {LOCAL_MEDIA_DEFAULT} {PUBLIC_SHARE_MEDIA}</>}</p>

                <div className="mb-4 flex gap-1 overflow-x-auto border-y border-border py-2" role="tablist" aria-label="Mobile media editing steps">
                  {mobileMediaSteps.map((step, index) => (
                    <button
                      key={step.label}
                      type="button"
                      role="tab"
                      aria-selected={mediaSubstep === index}
                      onClick={() => setMediaSubstep(index)}
                      className={`min-h-9 shrink-0 border px-3 text-[10px] font-bold uppercase tracking-wide transition-colors ${mediaSubstep === index ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-muted-foreground hover:border-primary/50'}`}
                    >
                      {index + 1}. {step.label}
                    </button>
                  ))}
                </div>
                <p className="mb-4 text-xs font-medium text-muted-foreground">
                  {mobileMediaSteps[mediaSubstep].hint}
                </p>

                {mediaSubstep === 0 && (
                  <div className="space-y-3">
                    {cloudProjectId && !project.mediaType && (
                      <p className="border-l-2 border-primary bg-primary/5 px-3 py-2 text-xs font-medium text-foreground" data-testid="text-design-only-media-prompt">
                        This saved design does not include media. Add a photo or video before exporting.
                      </p>
                    )}
                    {templateMediaNotice && !project.mediaType && (
                      <p className="border-l-2 border-primary bg-primary/5 px-3 py-2 text-xs font-medium text-foreground" data-testid="text-portable-template-media-notice">
                        {PORTABLE_TEMPLATE_MEDIA_NOTE} Add a photo or video before exporting.
                      </p>
                    )}
                    <MediaAssetControls
                      hasMedia={Boolean(project.mediaType)}
                      hasLogo={Boolean(project.logo)}
                      onMediaChange={handleMediaUpload}
                      onMediaRemove={handleMediaRemove}
                      onLogoChange={handleLogoUpload}
                      onLogoRemove={async () => {
                        if (isCloudMediaId(project.logoMediaId)) await deleteProjectMedia(project.logoMediaId).catch(() => undefined);
                        if (project.logoMediaId) await deleteMediaBlob(project.logoMediaId).catch(() => undefined);
                        setProject((current) => ({ ...current, logo: null, logoMediaId: null }));
                      }}
                    />
                  </div>
                )}

                {mediaSubstep === 1 && (
                  project.mediaType ? (
                    <MediaFramingControls
                      project={project}
                      onReset={() => setProject((current) => ({ ...current, photoTransform: defaultProject().photoTransform }))}
                      onTransformChange={updateTransform}
                      onVideoFitChange={(value) => updateProject('videoFit', value)}
                    />
                  ) : (
                    <div className="border-l-2 border-border bg-muted px-3 py-3 text-xs font-medium text-muted-foreground">
                      Add a photo or video in the first step to adjust its framing.
                    </div>
                  )
                )}

                {mediaSubstep === 2 && (
                  <div className="space-y-3">
                    {project.mediaType ? (
                      <>
                        <MediaAdjustmentControls
                          project={project}
                          showAdvanced={showAdvanced}
                          onToggle={() => setShowAdvanced((open) => !open)}
                          onAdjustmentChange={updateAdjustment}
                        />
                        {project.mediaType === 'video' && (
                          <MediaTrimAndAudioControls
                            project={project}
                            exportSupport={exportSupport}
                            includeAudio={includeAudio}
                            audioId="mobile-include-audio"
                            onAudioChange={setIncludeAudio}
                            onTrimChange={updateTrim}
                          />
                        )}
                        {project.mediaType === 'image' && (
                          <MediaImageDownloadControls imageFormat={imageFormat} onFormatChange={setImageFormat} />
                        )}
                      </>
                    ) : (
                      <div className="border-l-2 border-border bg-muted px-3 py-3 text-xs font-medium text-muted-foreground">
                        Add a photo or video in the first step to fine-tune it.
                      </div>
                    )}
                  </div>
                )}

                <div className="mt-5 flex items-center justify-between gap-3 border-t border-border pt-4">
                  <Button type="button" variant="outline" size="sm" onClick={() => setMediaSubstep((step) => Math.max(0, step - 1))} disabled={mediaSubstep === 0} className="rounded-none clip-angled-sm">
                    Back
                  </Button>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {mediaSubstep + 1} / {mobileMediaSteps.length}
                  </span>
                  <Button type="button" size="sm" onClick={() => setMediaSubstep((step) => Math.min(mobileMediaSteps.length - 1, step + 1))} disabled={mediaSubstep === mobileMediaSteps.length - 1} className="rounded-none bg-foreground text-background hover:bg-primary hover:text-primary-foreground clip-angled-sm">
                    Next
                  </Button>
                </div>

                <div className="mt-5 border border-border bg-muted p-2" data-testid="mobile-media-preview">
                  <div className="mb-2 flex items-center justify-between px-1">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-primary">Live preview</span>
                    <button type="button" onClick={() => setMobilePreviewOpen(true)} className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground hover:text-foreground">
                      Full screen
                    </button>
                  </div>
                  <div className="h-[58dvh] min-h-[360px] max-h-[560px]">
                    <PreviewCanvas project={project} videoUrl={videoUrl} videoRef={videoRef} onRequestPlay={loadPreviewForPlay} />
                  </div>
                </div>
              </div>
            </Section>}

            {walkthroughStep === 2 && <Section title="Layout" icon={LayoutGrid}>
              <div className="grid grid-cols-1 gap-3">
                {cardLayouts.map((l) => (
                  <LayoutOption key={l.id} layout={l} project={project} selected={project.layout === l.id} onSelect={() => updateProject('layout', l.id)} />
                ))}
              </div>
            </Section>}

            {walkthroughStep === 3 && (
              <section className="border-t border-border pt-6">
                <div className="mb-5 flex items-center gap-2">
                  <Check className="h-5 w-5 text-primary" />
                  <h2 className="text-sm font-bold uppercase tracking-widest text-foreground">Ready to post</h2>
                </div>
                <div className="space-y-3">
                  {[
                    ['Moment', project.headline || 'Not added'],
                    ['Player', project.playerName || 'Your player'],
                    ['Team', project.teamName || 'Your team'],
                    ['Output', project.format === 'landscape' ? 'Landscape video' : 'Portrait card'],
                  ].map(([label, value]) => (
                    <div key={label} className="flex items-center justify-between gap-4 border-b border-border py-2">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</span>
                      <span className="text-right text-sm font-bold text-foreground">{value}</span>
                    </div>
                  ))}
                </div>
                <p className="mt-5 text-xs font-medium leading-relaxed text-muted-foreground">
                  Your design updates instantly in the preview. When it is ready, post it to the Athlete Hype Page.
                </p>
                <div className="mt-5">
                  <Button type="button" onClick={handleShareClick} disabled={sharing || exporting} data-testid="walkthrough-publish-page" className="w-full min-w-0 gap-2 rounded-none bg-primary px-3 font-bold text-primary-foreground hover:bg-primary/90 clip-angled-sm">
                    <Share2 className="h-4 w-4 shrink-0" /> <span className="truncate">{sharing ? `${Math.round(shareProgress * 100)}%` : 'Add to Athlete Hype Page'}</span>
                  </Button>
                </div>
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

        <main className={`${walkthroughStep === 1 ? 'hidden sm:block' : 'block'} h-[72dvh] max-h-[720px] min-h-[520px] shrink-0 overflow-hidden p-4 sm:h-auto sm:min-h-0 sm:max-h-none sm:flex-1 sm:p-8`}>
          <div className="mx-auto h-full max-w-[800px]">
            <PreviewCanvas project={project} videoUrl={videoUrl} videoRef={videoRef} onRequestPlay={loadPreviewForPlay} />
          </div>
        </main>
      </div>

      <MobilePreviewDialog project={project} videoUrl={videoUrl} open={mobilePreviewOpen} onOpenChange={setMobilePreviewOpen} title={project.headline} />

      <Dialog open={shareDialogOpen} onOpenChange={(open) => {
        setShareDialogOpen(open);
        if (!open) setLinkedExportPending(false);
      }}>
        <DialogContent className="clip-angled-sm">
          <DialogHeader>
            <DialogTitle className="font-display uppercase tracking-wider text-xl">Share Hype Card</DialogTitle>
            <DialogDescription>
              {shareMode === 'stats'
                ? 'Keep your video on this phone and send a separate finalized stats link with it.'
                : project.mediaType === 'video'
                  ? 'Add a prepared, playable video to the Athlete Hype Page. Finalized stats, Game Day Live, and events are managed on that stable page.'
                  : 'Add this playable Hype Card to the Athlete Hype Page. Finalized stats, Game Day Live, and events are managed on that stable page.'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handlePublishShare} className="space-y-4 pt-4">
            {shareMode === 'card' && (
              <div className="grid gap-2 sm:grid-cols-2" role="group" aria-label="Choose how to share">
               <button
                 type="button"
                 onClick={() => {
                   setShareDialogOpen(false);
                   void handleExport();
                 }}
                 data-testid="button-download-hype-card"
                 className="border border-border bg-muted/30 p-3 text-left transition-colors hover:border-primary/50"
               >
                 <span className="block text-xs font-bold uppercase tracking-widest text-primary">Download Hype Card</span>
                 <span className="mt-1 block text-xs font-medium leading-relaxed text-muted-foreground">Save the finished vertical card to this device, then share the file anywhere.</span>
               </button>
              <button
                type="button"
                 onClick={() => setShareMode('card')}
                 data-testid="button-post-athlete-hype-page"
                 aria-pressed
                 className="border border-primary bg-primary/10 p-3 text-left transition-colors"
              >
                  <span className="block text-xs font-bold uppercase tracking-widest text-primary">{project.mediaType === 'video' ? 'Add video to Athlete Hype Page' : 'Add to Athlete Hype Page'}</span>
                  <span className="mt-1 block text-xs font-medium leading-relaxed text-muted-foreground">{project.mediaType === 'video' ? 'Prepare a smaller web copy for reliable recipient playback. The original video stays on this device.' : 'Keep this playable card with finalized stats, Game Day Live, and event cards on the athlete’s stable page.'}</span>
              </button>
             </div>
            )}
            {shareMode === 'card' && project.mediaType === 'video' && (
               <>
                 <p className="border-l-2 border-primary bg-primary/5 px-3 py-2 text-xs font-medium leading-relaxed text-muted-foreground" data-testid="text-hosted-video-preparation">
                   The Athlete Hype Page receives a smaller web copy of the selected clip and a poster image. Your original video remains on this device.
                 </p>
                 {shareVideoTooLargeQuality && (
                   <div className="border-l-2 border-amber-600 bg-amber-50 px-3 py-2 text-xs font-medium leading-relaxed text-amber-950" role="alert" data-testid="hosted-video-size-retry">
                     {shareVideoTooLargeQuality === 'standard'
                       ? 'The first browser-prepared copy was over 35 MB. Retry below with lower resolution and bitrate, or use Download Hype Card to keep the finished file on this device.'
                       : 'The lower-quality browser-prepared copy is still over 35 MB. Use Download Hype Card to keep the finished file on this device; your original video remains local.'}
                   </div>
                 )}
               </>
            )}
             {shareMode === 'stats' && (
               <div className="space-y-2">
                 <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Link Stats Project</Label>
                 <Select value={shareTrackerProjectId} onValueChange={setShareTrackerProjectId}>
                   <SelectTrigger className="clip-angled-sm h-12 rounded-none">
                     <SelectValue placeholder="None" />
                   </SelectTrigger>
                   <SelectContent>
                     <SelectItem value="none">Do not link stats</SelectItem>
                     {trackerProjects.map((p) => (
                       <SelectItem key={p.id} value={p.id}>
                         {p.name}
                       </SelectItem>
                     ))}
                   </SelectContent>
                 </Select>
               </div>
             )}
             {shareMode === 'card' && (
               <div className="space-y-2">
                 <Label htmlFor="share-media-name" className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Moment name</Label>
                 <Input
                   id="share-media-name"
                   value={shareMediaName}
                   onChange={(event) => setShareMediaName(event.target.value)}
                   maxLength={80}
                   placeholder="Game Day highlight"
                   aria-describedby="share-media-name-help"
                   data-testid="input-share-media-name"
                 />
                 <p id="share-media-name-help" className="text-xs font-medium text-muted-foreground">Shown on the Athlete Hype Page. Your device filename stays private.</p>
               </div>
             )}
            {shareMode === 'stats' && (
              <p className="border-l-2 border-primary bg-primary/5 px-3 py-2 text-xs font-medium leading-relaxed text-muted-foreground" data-testid="text-stats-link-export-warning">
                 The export adds a high-contrast “VIEW FINAL STATS” QR code and a readable fallback destination. The link follows this expiration and stops working if you revoke it; after creating it, copy or share the destination from the confirmation bar before sending the export.
              </p>
            )}

            {shareMode === 'stats' && shareTrackerProjectId !== 'none' && (
              <>
                {profile.sport ? (
                  <div className="space-y-2">
                    <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Sport</Label>
                    <div className="flex h-12 items-center border border-border bg-muted/40 px-3 text-sm font-bold" data-testid="publish-profile-sport">
                      {getSportRule(profile.sport).label}
                    </div>
                    <p className="text-xs font-medium text-muted-foreground">Uses the sport selected in Profile Settings.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Sport</Label>
                    <Select value={shareSport} onValueChange={setShareSport}>
                      <SelectTrigger className="clip-angled-sm h-12 rounded-none">
                        <SelectValue placeholder="Select sport" />
                      </SelectTrigger>
                      <SelectContent>
                        {sports.map((s) => (
                          <SelectItem key={s} value={s}>
                            {getSportRule(s).label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="space-y-2">
                  <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Athlete Display Name</Label>
                  <div className={`flex min-h-12 items-center border px-3 text-sm font-bold ${profile.athleteName ? 'border-border bg-muted/40' : 'border-destructive/50 bg-destructive/10 text-destructive'}`} data-testid="publish-profile-athlete">
                    {profile.athleteName || 'Add an athlete name in Profile Settings'}
                  </div>
                  <p className="text-xs font-medium text-muted-foreground">Uses the athlete name saved in Profile Settings.</p>
                </div>
              </>
            )}

            {shareMode === 'stats' && (
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Link Expiration</Label>
                <Select value={shareExpiresInDays} onValueChange={setShareExpiresInDays}>
                  <SelectTrigger className="clip-angled-sm h-12 rounded-none">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="7">7 Days</SelectItem>
                    <SelectItem value="14">14 Days</SelectItem>
                    <SelectItem value="30">30 Days</SelectItem>
                    <SelectItem value="90">90 Days</SelectItem>
                    {!['7', '14', '30', '90'].includes(shareExpiresInDays) && (
                      <SelectItem value={shareExpiresInDays}>{shareExpiresInDays} Days</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
            )}

             <DialogFooter className="mt-6">
               {shareMode === 'card' && project.mediaType === 'video' && shareVideoTooLargeQuality === 'compact' ? (
                 <Button
                   type="button"
                   onClick={() => {
                     setShareDialogOpen(false);
                     void handleExport();
                   }}
                   className="w-full h-12 clip-angled-sm rounded-none text-sm tracking-widest uppercase font-bold"
                   data-testid="button-download-oversized-hype-card"
                 >
                   <Download className="mr-2 h-4 w-4" /> Download Hype Card to this device
                 </Button>
               ) : (
                 <Button type="submit" disabled={shareMode === 'stats' && (shareTrackerProjectId === 'none' || !profile.athleteName)} className="w-full h-12 clip-angled-sm rounded-none text-sm tracking-widest uppercase font-bold">
                   {shareMode === 'stats'
                     ? 'Create stats link'
                     : shareVideoTooLargeQuality === 'standard'
                       ? 'Retry at lower quality'
                       : project.mediaType === 'video'
                         ? 'Add video to Athlete Hype Page'
                         : 'Add to Athlete Hype Page'}
                 </Button>
               )}
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={replyDialogOpen} onOpenChange={setReplyDialogOpen}>
        <DialogContent className="clip-angled-sm sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-display uppercase tracking-wider text-xl">Hype Card Replies</DialogTitle>
            <DialogDescription>Reactions and messages from people who opened your active Athlete Hype Page card.</DialogDescription>
          </DialogHeader>
          <div className="max-h-[55dvh] space-y-3 overflow-y-auto pt-3">
            {!shareReplies?.replies.length ? (
              <div className="border border-dashed border-border p-6 text-center text-sm font-medium text-muted-foreground">No replies yet. Post the Athlete Hype Page to invite reactions.</div>
            ) : shareReplies.replies.map((reply) => (
              <article key={reply.id} className={`border p-3 ${reply.isRead ? 'border-border bg-muted/30' : 'border-primary/40 bg-primary/10'}`}>
                <div className="flex items-start gap-3">
                  <span className="text-2xl" aria-hidden="true">{reply.reaction}</span>
                  <div className="min-w-0 flex-1">
                    {reply.message && <p className="whitespace-pre-wrap break-words text-sm font-medium">{reply.message}</p>}
                    <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{new Date(reply.createdAt).toLocaleString()}</p>
                  </div>
                  {!reply.isRead && <span className="text-[9px] font-bold uppercase tracking-widest text-primary">New</span>}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={deleteReply.isPending}
                    onClick={() => existingShare && deleteReply.mutate({
                      shareToken: existingShare.shareToken,
                      replyId: reply.id,
                    })}
                    aria-label="Delete reply"
                    title="Delete reply"
                    className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </article>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {sharing && (
        <div
          className="fixed inset-0 z-[60] grid place-items-center bg-background/80 p-5 backdrop-blur-sm"
          data-testid="share-link-preparing"
          role="status"
          aria-live="polite"
           aria-label={shareStage || 'Preparing share link'}
        >
          <div className="w-full max-w-md border border-primary/50 bg-card p-6 shadow-2xl clip-angled-sm sm:p-8">
            <div className="flex items-start gap-4">
              <div className="grid h-11 w-11 shrink-0 place-items-center border border-primary/40 bg-primary/10 text-primary">
                <RotateCw className="h-5 w-5 animate-spin" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                 <p className="text-xs font-bold uppercase tracking-widest text-primary">{shareStage || 'Preparing share link'}</p>
                 <h2 className="mt-1 font-display text-2xl uppercase tracking-wide text-foreground">{shareMode === 'stats' ? 'Creating your stats link' : 'Adding your Athlete Hype Page media'}</h2>
                <p className="mt-2 text-sm font-medium leading-6 text-muted-foreground">
                   {shareMode === 'stats'
                     ? 'Keep this page open while we create the separate finalized stats link.'
                     : 'Keep this page open while we prepare the playable video and upload it securely. Your original media stays on this device.'}
                </p>
              </div>
            </div>
            <div className="mt-6">
              <div className="mb-2 flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                <span>Preparing</span>
                <span data-testid="share-link-progress">{Math.round(shareProgress * 100)}%</span>
              </div>
              <div
                className="h-2 overflow-hidden bg-muted"
                role="progressbar"
                aria-label={`${shareStage || 'Preparing share link'} ${Math.round(shareProgress * 100)}%`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(shareProgress * 100)}
              >
                <div className="h-full bg-primary transition-[width] duration-300" style={{ width: `${Math.max(3, shareProgress * 100)}%` }} />
              </div>
            </div>
            {shareMode === 'card' && (
              <Button type="button" variant="outline" onClick={cancelSharePublish} aria-label="Cancel Athlete Hype Page upload" className="mt-5 w-full rounded-none clip-angled-sm">
                Cancel upload
              </Button>
            )}
          </div>
        </div>
      )}
    
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

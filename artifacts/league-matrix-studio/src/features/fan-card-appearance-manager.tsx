import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetAthleteFanCardQueryKey,
  getGetAthleteInviteQueryKey,
  getListAthleteInvitesQueryKey,
  useUpdateAthleteInviteAppearance,
} from '@workspace/api-client-react';
import type React from 'react';
import { Download } from 'lucide-react';
import { removeAthleteBackground } from './athlete-background-removal';
import { saveAthleteCutout } from './athlete-cutout-upload';
import { HypeCardAppearanceControls, HypeCardDesignPicker } from './hype-card-appearance-controls';
import { defaultCardAppearance, normalizeCardAppearance, resolveHypeCardAthleteName, seedCardAppearanceFromProfile, type HypeCardAppearance } from './hype-card-appearance';
import { buildBrandedPremiumHypeCardArtwork } from './premium-hype-card-brand';
import { buildPremiumNavStripPreview, preparePremiumCardPngExport } from './premium-hype-card-artwork';
import type { UserProfile } from './supporter-dashboard-model';
import { ClassicHypeCardPreview } from './classic-hype-card-preview';
import antonFontUrl from '../assets/anton-regular.ttf?url';

export type FanCardAppearanceInvite = {
  inviteToken: string; athleteName: string; teamName: string; sport: string;
  photoUrl: string | null; cutoutUrl?: string | null; photoRevision?: string | null; cardAppearance?: unknown;
};

async function toDataUrl(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  if (url.startsWith('data:')) return url;
  const res = await fetch(url, { credentials: new URL(url, window.location.href).origin === window.location.origin ? 'include' : 'omit' });
  if (!res.ok) throw new Error('image');
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('image'));
    r.readAsDataURL(blob);
  });
}

async function readImageDimensions(dataUrl: string | null): Promise<{ width: number; height: number } | undefined> {
  if (!dataUrl) return undefined;
  const image = new Image();
  const loaded = new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('image'));
  });
  image.src = dataUrl;
  await loaded;
  return { width: image.naturalWidth, height: image.naturalHeight };
}

let fontCss: Promise<string> | null = null;
/** Bundle Anton for number parity; retain best-effort embedding of existing web fonts. */
function loadEmbeddedFonts(): Promise<string> {
  fontCss ??= (async () => {
    const anton = await toDataUrl(antonFontUrl);
    if (!anton) throw new Error('Could not load the jersey-number font.');
    const numberFont = `@font-face{font-family:'Anton';src:url("${anton}") format('truetype');font-weight:400;font-style:normal;}`;
    try {
      const css = await (await fetch('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700&family=DM+Sans:wght@600;800&display=swap')).text();
      const urls = Array.from(new Set(Array.from(css.matchAll(/url\((https:[^)]+)\)/g), (m) => m[1])));
      let out = css;
      for (const u of urls) out = out.split(u).join(await toDataUrl(u) ?? u);
      return numberFont + out.replace(/<\/?style/gi, '');
    } catch { return numberFont; }
  })();
  return fontCss;
}

export function FanCardAppearanceManager({ invite, profile }: {
  invite: FanCardAppearanceInvite;
  profile: Pick<UserProfile, 'athleteName' | 'jerseyNumber' | 'position'>;
}) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const [moving, setMoving] = useState(false);
  const [selectedLayer, setSelectedLayer] = useState<'frame' | 'avatar'>('avatar');
  const [backgroundRemovalBusy, setBackgroundRemovalBusy] = useState(false);
  const [backgroundNotice, setBackgroundNotice] = useState('');
  const [failedCutout, setFailedCutout] = useState<string | null>(null);
  useEffect(() => {
    if (!invite.cutoutUrl) return;
    let cancelled = false;
    const image = new Image();
    image.onload = () => { if (!cancelled) setFailedCutout(null); };
    image.onerror = () => { if (!cancelled) setFailedCutout(invite.cutoutUrl || null); };
    image.src = invite.cutoutUrl;
    return () => { cancelled = true; };
  }, [invite.cutoutUrl]);
  const usableCutout = failedCutout === invite.cutoutUrl ? null : invite.cutoutUrl;
  const [saved, setSaved] = useState(() => normalizeCardAppearance(invite.cardAppearance));
  const [draft, setDraft] = useState(() => seedCardAppearanceFromProfile(invite.cardAppearance, profile));
  const draftRef = useRef(draft);
  const savedRef = useRef(saved);
  savedRef.current = saved;
  draftRef.current = draft;
  const loadedRef = useRef({ token: invite.inviteToken, key: JSON.stringify(saved) });
  const serverKey = JSON.stringify(normalizeCardAppearance(invite.cardAppearance));
  useEffect(() => {
    const server = normalizeCardAppearance(invite.cardAppearance);
    if (loadedRef.current.token !== invite.inviteToken) {
      loadedRef.current = { token: invite.inviteToken, key: serverKey };
      setSaved(server); setDraft(seedCardAppearanceFromProfile(server, profile)); setStatus('idle'); setMoving(false);
      setSelectedLayer('avatar');
      return;
    }
    if (loadedRef.current.key === serverKey) return;
    loadedRef.current.key = serverKey;
    const wasClean = JSON.stringify(draftRef.current) === JSON.stringify(savedRef.current);
    setSaved(server);
    if (wasClean) setDraft(seedCardAppearanceFromProfile(server, profile));
    setMoving(false);
    setSelectedLayer('avatar');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invite.inviteToken, serverKey]);
  const [exportState, setExportState] = useState<'idle' | 'working' | 'error'>('idle');
  const uid = useId().replace(/[^A-Za-z0-9_-]/g, '');
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const clampPlacement = (a: HypeCardAppearance, x: number, y: number) => normalizeCardAppearance({ ...a, athleteX: x, athleteY: y });
  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!moving || selectedLayer === 'frame') return;
    dragRef.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const last = dragRef.current;
    if (!moving || selectedLayer === 'frame' || !last) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dx = (e.clientX - last.x) / rect.width, dy = (e.clientY - last.y) / rect.height;
    dragRef.current = { x: e.clientX, y: e.clientY };
    setDraft((d) => clampPlacement(d, d.athleteX + dx, d.athleteY + dy));
    setStatus('idle');
  };
  const onUp = () => { dragRef.current = null; };
  const onPositionKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!moving || selectedLayer === 'frame') return;
    const directions: Record<string, [number, number]> = { ArrowLeft: [-.01, 0], ArrowRight: [.01, 0], ArrowUp: [0, -.01], ArrowDown: [0, .01] };
    const direction = directions[event.key];
    if (!direction) return;
    event.preventDefault();
    setDraft(current => clampPlacement(current, current.athleteX + direction[0], current.athleteY + direction[1]));
    setStatus('idle');
  };
  const removeBackground = async () => {
    if (!invite.photoUrl || !invite.photoRevision || backgroundRemovalBusy) return;
    setBackgroundRemovalBusy(true);
    setBackgroundNotice('Preparing a transparent athlete cutout on this device…');
    try {
      const imageUrl = new URL(invite.photoUrl, window.location.href);
      const response = await fetch(invite.photoUrl, { credentials: imageUrl.origin === window.location.origin ? 'include' : 'omit' });
      if (!response.ok) throw new Error('The original photo could not be loaded.');
      const cutout = await removeAthleteBackground(await response.blob(), setBackgroundNotice);
      await saveAthleteCutout(invite.inviteToken, cutout, invite.photoRevision);
      setDraft((current) => normalizeCardAppearance({ ...current, removeBackground: true }));
      setBackgroundNotice('Background removed. The original photo is unchanged.');
      setStatus('idle');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListAthleteInvitesQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getGetAthleteInviteQueryKey(invite.inviteToken) }),
        queryClient.invalidateQueries({ queryKey: getGetAthleteFanCardQueryKey(invite.inviteToken) }),
      ]);
    } catch (error) {
      setBackgroundNotice(`Original photo kept. ${error instanceof Error ? error.message : 'Background removal failed.'}`);
    } finally {
      setBackgroundRemovalBusy(false);
    }
  };
  const mutation = useUpdateAthleteInviteAppearance();
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const handleAppearanceChange = (next: HypeCardAppearance) => {
    setDraft(next);
    setStatus('idle');
    if (next.design !== draft.design) {
      setMoving(false);
      setSelectedLayer('avatar');
    }
  };
  const displayAthleteName = resolveHypeCardAthleteName(profile.athleteName, invite.athleteName);
  const svg = useMemo(() => draft.design === 'classic' ? '' : buildBrandedPremiumHypeCardArtwork({
    athleteName: displayAthleteName, teamName: invite.teamName, sport: invite.sport,
    jerseyNumber: draft.jerseyNumber, position: draft.position,
    photoUrl: invite.photoUrl, cutoutUrl: usableCutout, appearance: draft,
  }, 'all', `pv${uid}`), [uid, draft, displayAthleteName, invite.teamName, invite.sport, invite.photoUrl, usableCutout]);
  const navStrip = useMemo(() => draft.design === 'classic' ? '' : buildPremiumNavStripPreview(draft, `pv${uid}`), [uid, draft]);

  const save = () => {
    setStatus('idle');
    mutation.mutate({ inviteToken: invite.inviteToken, data: draft }, {
      onSuccess: (res) => {
        const next = normalizeCardAppearance((res as { cardAppearance?: unknown } | undefined)?.cardAppearance ?? draft);
        loadedRef.current = { token: invite.inviteToken, key: JSON.stringify(next) };
        setSaved(next); setDraft(next); setStatus('saved');
        void Promise.all([
          queryClient.invalidateQueries({ queryKey: getListAthleteInvitesQueryKey() }),
          queryClient.invalidateQueries({ queryKey: getGetAthleteInviteQueryKey(invite.inviteToken) }),
          queryClient.invalidateQueries({ queryKey: getGetAthleteFanCardQueryKey(invite.inviteToken) }),
        ]);
      },
      onError: () => setStatus('error'),
    });
  };

  const exportPng = async () => {
    setExportState('working');
    try {
      const [photo, cutout] = await Promise.all([toDataUrl(invite.photoUrl), toDataUrl(usableCutout)]);
      const fonts = await loadEmbeddedFonts();
      const cutoutSize = await readImageDimensions(cutout);
      const art = buildBrandedPremiumHypeCardArtwork({
        athleteName: displayAthleteName, teamName: invite.teamName, sport: invite.sport,
        jerseyNumber: draft.jerseyNumber, position: draft.position, photoUrl: photo, cutoutUrl: cutout, appearance: draft,
      }, 'all', 'export');
      const png = preparePremiumCardPngExport(art, draft, cutoutSize);
      const markup = png.markup.replace(/(<svg[^>]*>)/, `$1${fonts ? `<style>${fonts}</style>` : ''}`);
      const img = new Image();
      const loaded = new Promise<void>((ok, bad) => { img.onload = () => ok(); img.onerror = () => bad(new Error('render')); });
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
      await loaded;
      const canvas = document.createElement('canvas');
      canvas.width = png.width; canvas.height = png.height;
      canvas.getContext('2d')!.drawImage(img, 0, 0, png.width, png.height);
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
      if (!blob) throw new Error('png');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${displayAthleteName.trim().replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'hype-card'}-${dirty ? 'draft' : draft.design}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      setExportState('idle');
    } catch { setExportState('error'); }
  };

  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,280px)_1fr]" data-testid="fan-card-appearance-manager">
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-3 md:block" data-testid="appearance-preview-and-mobile-design">
        <div className="min-w-0">
          <div className="mx-auto w-full max-w-[280px] overflow-visible rounded-2xl" data-testid="appearance-preview">
            {draft.design === 'classic'
              ? <ClassicHypeCardPreview athleteName={displayAthleteName} teamName={invite.teamName} photoUrl={invite.photoUrl} />
              : <div data-testid="premium-card-preview-stack">
                  <div role="img" aria-label={`${draft.design} preview for ${displayAthleteName}${moving ? '. Use arrow keys to position the avatar.' : ''}`} tabIndex={moving ? 0 : undefined} onKeyDown={onPositionKeyDown} className={`select-none [&>svg]:h-auto [&>svg]:w-full ${moving ? 'cursor-grab' : ''}`} style={{ touchAction: moving ? 'none' : 'auto' }} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} data-testid="appearance-preview-surface" dangerouslySetInnerHTML={{ __html: svg }} />
                  <div className="mt-2 [&>svg]:block [&>svg]:h-auto [&>svg]:w-full" data-testid="appearance-navigation-preview" dangerouslySetInnerHTML={{ __html: navStrip }} />
                </div>}
          </div>
          <p className="mt-2 text-center text-[11px] uppercase tracking-widest text-white/60">{dirty ? 'Unsaved draft preview' : 'Saved design'}</p>
        </div>
        <div className="min-w-0 md:hidden" data-testid="mobile-card-design-controls">
          <HypeCardDesignPicker appearance={draft} onChange={handleAppearanceChange} disabled={mutation.isPending || backgroundRemovalBusy} variant="compact" className="w-full" />
        </div>
      </div>
      <div className="space-y-5">
        {draft.design === 'breakout' && <div className="rounded-xl border border-white/15 bg-white/5 p-3" role="group" aria-label="Breakout layers" data-testid="breakout-layer-list">
          <p className="mb-2 text-xs font-bold uppercase tracking-widest text-white/70">Layers · back to front</p>
          <div className="grid grid-cols-2 gap-2">
            {([
              ['frame', 'Frame'],
              ['avatar', 'Avatar'],
            ] as const).map(([layer, label]) => (
              <button key={layer} type="button" aria-pressed={selectedLayer === layer}
                disabled={mutation.isPending || backgroundRemovalBusy}
                onClick={() => { setMoving(layer !== 'frame'); dragRef.current = null; setSelectedLayer(layer); }}
                className="min-h-11 rounded border border-white/20 px-2 text-xs font-bold aria-pressed:border-white aria-pressed:bg-white/15"
                data-testid={`button-layer-${layer}`}>{label}{layer === 'frame' && <span className="block text-[10px] font-normal text-white/60">Locked</span>}</button>
            ))}
          </div>
        </div>}
        <HypeCardAppearanceControls appearance={draft} onChange={handleAppearanceChange} disabled={mutation.isPending || backgroundRemovalBusy} designPickerClassName="hidden md:block"
          placementLabel={selectedLayer === 'frame' ? 'Frame layer' : 'Avatar placement'}
          showAthleteSize={selectedLayer === 'avatar'}
          showResetButton={selectedLayer !== 'frame'}
          canEnableBackgroundRemoval={!!invite.photoUrl && !!invite.photoRevision}
          onEnableBackgroundRemoval={() => { if (!usableCutout) void removeBackground(); }}
          onResetPlacement={() => {
            setDraft((current) => selectedLayer === 'avatar'
              ? normalizeCardAppearance({ ...current, athleteScale: 1, athleteX: 0, athleteY: 0 })
              : current);
            setMoving(false);
            setStatus('idle');
          }}
          placementActions={
            <div>
              <button type="button" disabled={mutation.isPending || backgroundRemovalBusy || selectedLayer === 'frame'} aria-pressed={moving} onClick={() => { dragRef.current = null; setMoving((m) => !m); }} className="min-h-11 rounded border border-white/30 px-4 text-xs font-bold text-white aria-pressed:bg-white aria-pressed:text-[#10243D]" data-testid="button-reposition-mode">{selectedLayer === 'frame' ? 'Frame stays fixed' : moving ? 'Done positioning' : 'Position avatar'}</button>
              {selectedLayer !== 'frame' && <p className="mt-2 text-xs text-white/70">{moving ? 'Drag the preview to position the avatar. Choose Done positioning when finished.' : 'Choose Position avatar, then drag the preview or use the arrow keys.'}</p>}
              {draft.design === 'breakout' && !usableCutout && <button type="button" disabled={!invite.photoUrl || !invite.photoRevision || backgroundRemovalBusy} onClick={() => void removeBackground()} className="mt-3 min-h-11 rounded border border-white/30 px-4 text-xs font-bold uppercase tracking-widest disabled:opacity-50" data-testid="button-remove-card-background">{backgroundRemovalBusy ? 'Removing background…' : 'Remove background'}</button>}
              {backgroundNotice && <p role="status" className="mt-2 text-xs text-white/75" data-testid="background-removal-status">{backgroundNotice}</p>}
            </div>
          } />
        <div className="flex flex-wrap items-center gap-3 border-t border-white/15 pt-4">
          <button type="button" onClick={save} disabled={!dirty || mutation.isPending} className="min-h-11 rounded bg-white px-5 text-xs font-black uppercase tracking-widest text-[#10243D] disabled:opacity-50" data-testid="button-save-appearance">{mutation.isPending ? 'Saving…' : 'Save design'}</button>
          <button type="button" onClick={() => { setDraft(saved); setStatus('idle'); }} disabled={!dirty || mutation.isPending} className="min-h-11 rounded border border-white/30 px-4 text-xs font-bold uppercase tracking-widest text-white disabled:opacity-50" data-testid="button-revert-appearance">Revert to saved</button>
          <button type="button" onClick={() => { setDraft({ ...defaultCardAppearance('classic'), jerseyNumber: draft.jerseyNumber, position: draft.position }); setStatus('idle'); }} disabled={mutation.isPending} className="min-h-11 rounded border border-white/30 px-4 text-xs font-bold uppercase tracking-widest text-white" data-testid="button-default-appearance">Use Classic</button>
          {draft.design !== 'classic' && <button type="button" onClick={() => void exportPng()} disabled={exportState === 'working'} className="inline-flex min-h-11 items-center gap-2 rounded border border-white/30 px-4 text-xs font-bold uppercase tracking-widest text-white disabled:opacity-50" data-testid="button-export-appearance-png"><Download className="h-4 w-4" aria-hidden="true" />{exportState === 'working' ? 'Preparing…' : dirty ? 'Download draft PNG' : 'Download PNG'}</button>}
        </div>
        <p role="status" aria-live="polite" className="text-sm text-white/80">
          {status === 'saved' && 'Design saved. Supporters now see it.'}
          {status === 'error' && <span className="text-red-200">Could not save the design. Your draft is kept.<button type="button" onClick={save} className="ml-2 underline">Retry</button></span>}
          {exportState === 'error' && <span className="text-red-200"> Could not prepare the PNG. Try again.</span>}
        </p>
        <p className="text-[11px] text-white/50">The PNG shows the card artwork only; Replies, Stats, Taps and Events live on the interactive card.</p>
      </div>
    </div>
  );
}

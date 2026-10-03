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
import { HypeCardAppearanceControls } from './hype-card-appearance-controls';
import { defaultCardAppearance, normalizeCardAppearance, type HypeCardAppearance } from './hype-card-appearance';
import { buildBrandedPremiumHypeCardArtwork } from './premium-hype-card-brand';
import { buildPremiumNavStripExport } from './premium-hype-card-artwork';

export type FanCardAppearanceInvite = {
  inviteToken: string; athleteName: string; teamName: string; sport: string;
  photoUrl: string | null; cutoutUrl?: string | null; cardAppearance?: HypeCardAppearance | null;
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

let fontCss: Promise<string> | null = null;
/** Best effort: embed Barlow Condensed and DM Sans so exported text matches the live card. */
function loadEmbeddedFonts(): Promise<string> {
  fontCss ??= (async () => {
    try {
      const css = await (await fetch('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700&family=DM+Sans:wght@600;800&display=swap')).text();
      const urls = Array.from(new Set(Array.from(css.matchAll(/url\((https:[^)]+)\)/g), (m) => m[1])));
      let out = css;
      for (const u of urls) out = out.split(u).join(await toDataUrl(u) ?? u);
      return out.replace(/<\/?style/gi, '');
    } catch { return ''; }
  })();
  return fontCss;
}

export function FanCardAppearanceManager({ invite }: { invite: FanCardAppearanceInvite }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const [moving, setMoving] = useState(false);
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
  const [draft, setDraft] = useState(saved);
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
      setSaved(server); setDraft(server); setStatus('idle'); setMoving(false);
      return;
    }
    if (loadedRef.current.key === serverKey) return;
    loadedRef.current.key = serverKey;
    const wasClean = JSON.stringify(draftRef.current) === JSON.stringify(savedRef.current);
    setSaved(server);
    if (wasClean) setDraft(server);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invite.inviteToken, serverKey]);
  const [exportState, setExportState] = useState<'idle' | 'working' | 'error'>('idle');
  const uid = useId().replace(/[^A-Za-z0-9_-]/g, '');
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const clampPlacement = (a: HypeCardAppearance, x: number, y: number) => normalizeCardAppearance({ ...a, athleteX: x, athleteY: y });
  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!moving) return;
    dragRef.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const last = dragRef.current;
    if (!moving || !last) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dx = (e.clientX - last.x) / rect.width, dy = (e.clientY - last.y) / rect.height;
    dragRef.current = { x: e.clientX, y: e.clientY };
    setDraft((d) => clampPlacement(d, d.athleteX + dx, d.athleteY + dy));
    setStatus('idle');
  };
  const onUp = () => { dragRef.current = null; };
  const mutation = useUpdateAthleteInviteAppearance();
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const previewCard = invite.cutoutUrl || invite.photoUrl;
  const svg = useMemo(() => draft.design === 'classic' ? '' : buildBrandedPremiumHypeCardArtwork({
    athleteName: invite.athleteName, teamName: invite.teamName, sport: invite.sport,
    jerseyNumber: draft.jerseyNumber, position: draft.position,
    photoUrl: invite.photoUrl, cutoutUrl: usableCutout, appearance: draft,
  }, 'all', `pv${uid}`).replace(/<\/svg>$/, `${buildPremiumNavStripExport(draft)}</svg>`), [uid, draft, invite.athleteName, invite.teamName, invite.sport, invite.photoUrl, usableCutout]);

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
      const art = buildBrandedPremiumHypeCardArtwork({
        athleteName: invite.athleteName, teamName: invite.teamName, sport: invite.sport,
        jerseyNumber: draft.jerseyNumber, position: draft.position, photoUrl: photo, cutoutUrl: cutout, appearance: draft,
      }, 'all', 'export');
      const markup = art.replace(/(<svg[^>]*>)/, `$1${fonts ? `<style>${fonts}</style>` : ''}`).replace(/<\/svg>$/, `${buildPremiumNavStripExport(draft)}</svg>`);
      const img = new Image();
      const loaded = new Promise<void>((ok, bad) => { img.onload = () => ok(); img.onerror = () => bad(new Error('render')); });
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
      await loaded;
      const canvas = document.createElement('canvas');
      canvas.width = 2000; canvas.height = 2800;
      canvas.getContext('2d')!.drawImage(img, 0, 0, 2000, 2800);
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
      if (!blob) throw new Error('png');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${invite.athleteName.trim().replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'hype-card'}-${dirty ? 'draft' : draft.design}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      setExportState('idle');
    } catch { setExportState('error'); }
  };

  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,280px)_1fr]" data-testid="fan-card-appearance-manager">
      <div>
        <div className="mx-auto w-full max-w-[280px] overflow-visible rounded-2xl" data-testid="appearance-preview">
          {draft.design === 'classic'
            ? <div className="grid aspect-[5/7] place-items-center rounded-2xl border border-white/20 bg-[#10243D] p-4 text-center text-sm text-white/80">{previewCard ? <img src={previewCard} alt="" className="max-h-full rounded-lg object-cover" /> : 'Classic design uses your photo and team details.'}</div>
            : <div role="img" aria-label={`${draft.design} preview for ${invite.athleteName}${moving ? '. Use arrow keys to position the photo.' : ''}`} tabIndex={moving ? 0 : undefined} onKeyDown={(event) => {
              if (!moving) return;
              const directions: Record<string, [number, number]> = { ArrowLeft: [-.01, 0], ArrowRight: [.01, 0], ArrowUp: [0, -.01], ArrowDown: [0, .01] };
              const direction = directions[event.key];
              if (!direction) return;
              event.preventDefault();
              setDraft(current => clampPlacement(current, current.athleteX + direction[0], current.athleteY + direction[1]));
              setStatus('idle');
            }} className={`select-none [&>svg]:h-auto [&>svg]:w-full ${moving ? 'cursor-grab ring-2 ring-white' : ''}`} style={{ touchAction: moving ? 'none' : 'auto' }} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} data-testid="appearance-preview-surface" dangerouslySetInnerHTML={{ __html: svg }} />}
        </div>
        <p className="mt-2 text-center text-[11px] uppercase tracking-widest text-white/60">{dirty ? 'Unsaved draft preview' : 'Saved design'}</p>
      </div>
      <div className="space-y-5">
        <HypeCardAppearanceControls appearance={draft} onChange={(next) => { setDraft(next); setStatus('idle'); }} disabled={mutation.isPending} placementActions={
          <div>
            <button type="button" disabled={mutation.isPending} aria-pressed={moving} onClick={() => { dragRef.current = null; setMoving((m) => !m); }} className="min-h-11 rounded border border-white/30 px-4 text-xs font-bold text-white aria-pressed:bg-white aria-pressed:text-[#10243D]" data-testid="button-reposition-mode">{moving ? 'Done positioning' : 'Position photo'}</button>
            <p className="mt-2 text-xs text-white/70">{moving ? 'Drag the preview to position the photo. Choose Done positioning to scroll.' : 'Choose Position photo, then drag the preview.'}</p>
          </div>
        } />
        <div className="flex flex-wrap items-center gap-3 border-t border-white/15 pt-4">
          <button type="button" onClick={save} disabled={!dirty || mutation.isPending} className="min-h-11 rounded bg-white px-5 text-xs font-black uppercase tracking-widest text-[#10243D] disabled:opacity-50" data-testid="button-save-appearance">{mutation.isPending ? 'Saving…' : 'Save design'}</button>
          <button type="button" onClick={() => { setDraft(saved); setStatus('idle'); }} disabled={!dirty || mutation.isPending} className="min-h-11 rounded border border-white/30 px-4 text-xs font-bold uppercase tracking-widest text-white disabled:opacity-50" data-testid="button-revert-appearance">Revert to saved</button>
          <button type="button" onClick={() => { setDraft(defaultCardAppearance('classic')); setStatus('idle'); }} disabled={mutation.isPending} className="min-h-11 rounded border border-white/30 px-4 text-xs font-bold uppercase tracking-widest text-white" data-testid="button-default-appearance">Use Classic</button>
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

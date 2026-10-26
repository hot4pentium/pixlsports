import { useEffect, useId, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetAthleteFanCardQueryKey,
  getGetAthleteInviteQueryKey,
  getListAthleteInvitesQueryKey,
  useUpdateAthleteEditorCardAppearance,
  useUpdateAthleteInviteAppearance,
} from '@workspace/api-client-react';
import { Download, Share2 } from 'lucide-react';
import { normalizeCardAppearance, resolveHypeCardAthleteName, seedCardAppearanceFromProfile, type HypeCardAppearance } from './hype-card-appearance';
import { simpleCardLogoSrc } from './simple-hype-card-brand';
import { buildSimpleHypeCardArtwork, HYPE_TEMPLATE_CARD_H, HYPE_TEMPLATE_CARD_W } from './simple-hype-card-artwork';
import type { UserProfile } from './supporter-dashboard-model';
import { ClassicHypeCardPreview } from './classic-hype-card-preview';
import { HypeCardDesignPicker, HypeCardLowerThirdPicker, HypeCardPhotoPositionSliders, HypeCardTemplateCyclers } from './hype-card-appearance-controls';
import antonFontUrl from '../assets/anton-regular.ttf?url';

type Draft = HypeCardAppearance;
const norm = (v: unknown): Draft => normalizeCardAppearance(v);

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

function supportsImageSharing(file?: File): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function' || typeof File === 'undefined') return false;
  try {
    return navigator.canShare({
      files: [file ?? new File([''], 'hype-card.jpg', { type: 'image/jpeg' })],
    });
  } catch {
    return false;
  }
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

export function FanCardAppearanceManager({ invite, profile, athleteEditor = false }: {
  invite: FanCardAppearanceInvite;
  profile: Pick<UserProfile, 'athleteName' | 'jerseyNumber' | 'position'>;
  athleteEditor?: boolean;
}) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const seed = (v: unknown) => norm(seedCardAppearanceFromProfile(v, profile));
  const profileJerseyNumber = typeof profile.jerseyNumber === 'string'
    ? profile.jerseyNumber.trim().replace(/^#/, '').slice(0, 12)
    : '';
  const [saved, setSaved] = useState<Draft>(() => norm(invite.cardAppearance));
  const [draft, setDraft] = useState<Draft>(() => seed(invite.cardAppearance));
  const currentAppearance = seed(draft);
  const draftRef = useRef(currentAppearance);
  const savedRef = useRef(saved);
  savedRef.current = saved;
  draftRef.current = currentAppearance;
  const loadedRef = useRef({ token: invite.inviteToken, key: JSON.stringify(saved) });
  const serverKey = JSON.stringify(norm(invite.cardAppearance));
  useEffect(() => {
    const server = norm(invite.cardAppearance);
    if (loadedRef.current.token !== invite.inviteToken) {
      loadedRef.current = { token: invite.inviteToken, key: serverKey };
      setSaved(server); setDraft(seed(server)); setStatus('idle');
      return;
    }
    if (loadedRef.current.key === serverKey) return;
    loadedRef.current.key = serverKey;
    const wasClean = JSON.stringify(draftRef.current) === JSON.stringify(savedRef.current);
    setSaved(server);
    if (wasClean) setDraft(seed(server));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invite.inviteToken, serverKey]);
  useEffect(() => {
    setStatus('idle');
    setExportMessage('');
    setPreparedExport(null);
    setExportState('idle');
  }, [profileJerseyNumber]);
  const [exportState, setExportState] = useState<'idle' | 'working' | 'ready' | 'error'>('idle');
  const [preparedExport, setPreparedExport] = useState<{ file: File; draftKey: string } | null>(null);
  const [exportMessage, setExportMessage] = useState('');
  const uid = useId().replace(/[^A-Za-z0-9_-]/g, '');
  const currentDraftKey = JSON.stringify(currentAppearance);
  const readyExport = preparedExport?.draftKey === currentDraftKey ? preparedExport : null;
  const nativeImageSharing = supportsImageSharing();
  const ownerMutation = useUpdateAthleteInviteAppearance();
  const athleteMutation = useUpdateAthleteEditorCardAppearance();
  const dirty = currentDraftKey !== JSON.stringify(saved);
  const displayAthleteName = resolveHypeCardAthleteName(profile.athleteName, invite.athleteName);
  const edit = (patch: Partial<HypeCardAppearance>) => {
    setDraft((d) => normalizeCardAppearance({ ...d, ...patch })); setStatus('idle'); setExportMessage('');
  };
  const updateAppearance = (next: HypeCardAppearance) => {
    setDraft(next); setStatus('idle'); setExportMessage('');
  };
  const cardHref = `/fan/${encodeURIComponent(invite.inviteToken)}`;
  const busy = ownerMutation.isPending || athleteMutation.isPending;

  const save = () => {
    setStatus('idle');
    setExportMessage('');
    const callbacks = {
      onSuccess: (res: { cardAppearance?: unknown }) => {
        const next = norm(res.cardAppearance);
        loadedRef.current = { token: invite.inviteToken, key: JSON.stringify(norm(next)) };
        setSaved(next); setDraft(next); setStatus('saved');
        const refreshes = [
          queryClient.invalidateQueries({ queryKey: getGetAthleteFanCardQueryKey(invite.inviteToken) }),
        ];
        if (!athleteEditor) {
          refreshes.push(
            queryClient.invalidateQueries({ queryKey: getListAthleteInvitesQueryKey() }),
            queryClient.invalidateQueries({ queryKey: getGetAthleteInviteQueryKey(invite.inviteToken) }),
          );
        }
        void Promise.all(refreshes);
      },
      onError: () => setStatus('error'),
    };
    if (athleteEditor) {
      athleteMutation.mutate({ data: currentAppearance }, callbacks);
    } else {
      ownerMutation.mutate({ inviteToken: invite.inviteToken, data: currentAppearance }, callbacks);
    }
  };
  const downloadJpeg = (file: File) => {
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url;
    link.download = file.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
    setPreparedExport(null);
    setExportState('idle');
    setExportMessage('JPG downloaded. Open it from Downloads to save it to Photos.');
  };

  const openImageShare = async (image: { file: File; draftKey: string }) => {
    if (!supportsImageSharing(image.file)) {
      downloadJpeg(image.file);
      return;
    }
    try {
      // Call share before awaiting anything else so a user tap can open the OS share sheet.
      const sharing = navigator.share({ files: [image.file], title: image.file.name });
      setExportState('working');
      await sharing;
      setPreparedExport(null);
      setExportState('idle');
      setExportMessage('Share menu closed.');
    } catch (error) {
      setExportState('ready');
      setExportMessage(
        error instanceof Error && error.name === 'AbortError'
          ? 'Share menu closed without saving. Tap Save to Photos to open it again.'
          : 'The JPG is ready. Tap Save to Photos to open your device share menu.',
      );
    }
  };

  const exportJpeg = async () => {
    if (readyExport) { await openImageShare(readyExport); return; }
    setExportState('working');
    setExportMessage('');
    try {
      const [photo, logo] = await Promise.all([toDataUrl(invite.photoUrl), toDataUrl(simpleCardLogoSrc)]);
      const fonts = await loadEmbeddedFonts();
      const art = buildSimpleHypeCardArtwork({
        athleteName: displayAthleteName, teamName: invite.teamName, jerseyNumber: currentAppearance.jerseyNumber,
        position: currentAppearance.position, photoUrl: photo, logoUrl: logo, design: currentAppearance.design,
        lowerThirdTemplate: currentAppearance.lowerThirdTemplate, borderColor: currentAppearance.borderColor, accentColor: currentAppearance.accentColor,
        athleteX: currentAppearance.athleteX, athleteY: currentAppearance.athleteY, athleteScale: currentAppearance.athleteScale,
      }, `ex${uid}`);
      const w = HYPE_TEMPLATE_CARD_W * 2, h = HYPE_TEMPLATE_CARD_H * 2;
      const markup = art.replace(/(<svg[^>]*>)/, `$1<style>${fonts}</style>`).replace(`width="${HYPE_TEMPLATE_CARD_W}" height="${HYPE_TEMPLATE_CARD_H}"`, `width="${w}" height="${h}"`);
      const img = new Image();
      const loaded = new Promise<void>((ok, bad) => { img.onload = () => ok(); img.onerror = () => bad(new Error('render')); });
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
      await loaded;
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('canvas');
      context.fillStyle = '#081a30';
      context.fillRect(0, 0, w, h);
      context.drawImage(img, 0, 0, w, h);
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.95));
      if (!blob) throw new Error('jpeg');
      if (JSON.stringify(draftRef.current) !== currentDraftKey) {
        setExportState('idle');
        setExportMessage('The design changed while the JPG was being prepared. Try again.');
        return;
      }
      const file = new File([blob], `${displayAthleteName.trim().replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'hype-card'}-${currentAppearance.design}.jpg`, { type: 'image/jpeg' });
      const image = { file, draftKey: currentDraftKey };
      setPreparedExport(image);
      if (supportsImageSharing(file)) await openImageShare(image);
      else downloadJpeg(file);
    } catch {
      setExportState('error');
      setExportMessage('Could not prepare the JPG. Try again.');
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]" data-testid="fan-card-appearance-manager">
      <div className="min-w-0">
        <div className="mx-auto w-full max-w-[360px] overflow-hidden rounded-2xl" data-testid="appearance-preview">
          <ClassicHypeCardPreview athleteName={displayAthleteName} teamName={invite.teamName} photoUrl={invite.photoUrl} appearance={currentAppearance} cardHref={cardHref} />
        </div>
        <p className="mt-2 text-center text-[11px] uppercase tracking-widest text-white/60">{dirty ? 'Unsaved draft preview' : 'Saved design'}</p>
        <div className="mx-auto mt-3 w-full max-w-[360px] lg:hidden">
          <HypeCardTemplateCyclers appearance={currentAppearance} onChange={updateAppearance} disabled={busy} />
        </div>
      </div>
      <div className="space-y-5">
        <div className="hidden space-y-5 lg:block" data-testid="appearance-desktop-template-pickers">
          <HypeCardDesignPicker appearance={draft} onChange={updateAppearance} disabled={busy} />
          <HypeCardLowerThirdPicker appearance={draft} onChange={updateAppearance} disabled={busy} />
        </div>
        <div className="space-y-3" data-testid="photo-position-controls">
          <p className="text-xs font-bold uppercase tracking-widest text-white/70">Photo position</p>
          <HypeCardPhotoPositionSliders
            appearance={currentAppearance}
            onChange={edit}
            disabled={busy}
            testIdPrefix="photo"
            sliderClassName="w-full accent-[#ff7849]"
            showValues={false}
            resetTestId="button-reset-photo-position"
          />
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-white/15 pt-4">
          <button type="button" onClick={save} disabled={!dirty || busy} className="min-h-11 rounded bg-white px-5 text-xs font-black uppercase tracking-widest text-[#10243D] disabled:opacity-50" data-testid="button-save-appearance">{busy ? 'Saving…' : 'Save design'}</button>
          {!athleteEditor && (
            <button type="button" onClick={() => void exportJpeg()} disabled={exportState === 'working'}
              className="inline-flex min-h-11 items-center gap-2 rounded border border-white/30 px-4 text-xs font-bold uppercase tracking-widest text-white disabled:opacity-50" data-testid="button-export-appearance-jpeg">
              {nativeImageSharing ? <Share2 className="h-4 w-4" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />}
              {exportState === 'working' ? 'Preparing…' : nativeImageSharing ? (dirty ? 'Save draft to Photos' : 'Save JPG to Photos') : (dirty ? 'Download draft JPG' : 'Download JPG')}
            </button>
          )}
        </div>
        <p role="status" aria-live="polite" className="text-sm text-white/80">
          {status === 'saved' && (athleteEditor ? 'Design saved.' : 'Design saved. Supporters now see it.')}
           {status === 'error' && <span className="text-red-200">Could not save the design. Your draft is kept.<button type="button" onClick={save} className="ml-2 underline" data-testid="button-retry-appearance">Retry</button></span>}
          {exportMessage && <span className={exportState === 'error' ? 'text-red-200' : ''} data-testid="status-export-appearance-jpeg">{exportMessage}</span>}
        </p>
          <p className="text-[11px] text-white/50">The number comes from Athlete Profile. Adjust the photo, then save the design{athleteEditor ? '.' : ' supporters will see.'}</p>
      </div>
    </div>
  );
}

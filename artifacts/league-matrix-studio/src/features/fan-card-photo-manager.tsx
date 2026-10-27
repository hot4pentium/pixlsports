import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ImagePlus, Trash2 } from 'lucide-react';
import {
  getGetAthleteInviteQueryKey,
  getGetAthleteFanCardQueryKey,
  getListAthleteInvitesQueryKey,
  useConfirmAthleteInvitePhoto,
  useRemoveAthleteInvitePhoto,
  useRequestAthleteInvitePhotoUploadUrl,
} from '@workspace/api-client-react';
import { HYPE_CARD_ATHLETE_PHOTO_UPLOAD_NOTICE } from './privacy-copy';

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

async function preparePhoto(file: File): Promise<Blob> {
  // Re-encoding removes device EXIF metadata, including potential GPS coordinates.
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser cannot prepare the photo.');
    context.fillStyle = '#102b4d';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.87));
    if (!blob || blob.size > MAX_PHOTO_BYTES) throw new Error('The prepared photo is too large. Choose another image.');
    return blob;
  } finally {
    bitmap.close();
  }
}

export function FanCardPhotoManager({ inviteToken, photoUrl }: { inviteToken: string; photoUrl: string | null; cutoutUrl?: string | null; photoRevision?: string | null }) {
  const queryClient = useQueryClient();
  const requestUpload = useRequestAthleteInvitePhotoUploadUrl();
  const confirm = useConfirmAthleteInvitePhoto();
  const remove = useRemoveAthleteInvitePhoto();
  const [selected, setSelected] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const isBusy = busy || requestUpload.isPending || confirm.isPending || remove.isPending;

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getGetAthleteInviteQueryKey(inviteToken) }),
      queryClient.invalidateQueries({ queryKey: getListAthleteInvitesQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getGetAthleteFanCardQueryKey(inviteToken) }),
    ]);
  }

  async function upload() {
    if (!selected || isBusy) return;
    setNotice('');
    if (!PHOTO_TYPES.includes(selected.type) || selected.size > MAX_PHOTO_BYTES || selected.size === 0) {
      setNotice('Choose a JPG, PNG, or WebP image under 5 MB.');
      return;
    }
    setBusy(true);
    try {
      const photo = await preparePhoto(selected);
      const claim = await requestUpload.mutateAsync({
        inviteToken,
        data: { contentType: 'image/jpeg', size: photo.size },
      });
      const uploadResponse = await fetch(claim.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'image/jpeg' },
        body: photo,
      });
      if (!uploadResponse.ok) throw new Error('The photo upload did not finish. Try again.');
      await confirm.mutateAsync({ inviteToken, data: { objectPath: claim.objectPath } });
      setSelected(null);
      await refresh();
      setNotice('HYPE Card photo saved.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'The HYPE Card photo could not be uploaded.');
    } finally {
      setBusy(false);
    }
  }

  async function removePhoto() {
    if (!window.confirm('Remove the HYPE Card photo? Fans will see initials instead.')) return;
    setNotice('');
    try {
      await remove.mutateAsync({ inviteToken });
      await refresh();
      setNotice('HYPE Card photo removed. Fans will see initials instead.');
    } catch {
      setNotice('The HYPE Card photo could not be removed. Please try again.');
    }
  }

  return (
    <section className="mt-6 border-t border-white/15 pt-6" aria-label="HYPE Card photo" data-testid="section-fan-card-photo">
      <h3 className="font-display text-2xl uppercase">HYPE Card photo</h3>
      <p className="mt-2 max-w-xl text-xs leading-relaxed text-white/60">Upload one athlete photo for the front of their public HYPE Card. There is no separate athlete-profile photo to upload. Photos are resized and device metadata is removed before upload.</p>
      <div role="note" aria-label="Public photo visibility" className="mt-4 max-w-2xl border border-amber-200/40 bg-amber-100/10 p-4 text-sm leading-relaxed text-white" data-testid="notice-fan-card-photo-visibility">
        <p className="font-bold uppercase tracking-wide text-amber-100">When fans can see it</p>
        <p className="mt-1">{HYPE_CARD_ATHLETE_PHOTO_UPLOAD_NOTICE}</p>
      </div>
      <div className="mt-4 flex flex-wrap items-end gap-4">
        {photoUrl ? (
          <img src={photoUrl} alt="Current HYPE Card athlete photo" className="h-24 w-24 border border-white/20 object-cover" data-testid="img-owner-fan-card-photo" />
        ) : (
          <div className="grid h-24 w-24 place-items-center border border-dashed border-white/30 text-white/50" aria-label="No athlete photo selected"><ImagePlus aria-hidden="true" /></div>
        )}
        <label className="flex flex-col gap-2 text-xs font-bold uppercase tracking-widest text-white/70">
          Choose photo
          <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { setSelected(event.target.files?.[0] ?? null); setNotice(''); }} className="max-w-[270px] text-xs font-normal normal-case tracking-normal file:mr-3 file:border-0 file:bg-white/15 file:px-3 file:py-2 file:text-white" data-testid="input-fan-card-photo" />
        </label>
        <button type="button" onClick={() => void upload()} disabled={!selected || isBusy} className="inline-flex min-h-11 items-center gap-2 bg-primary px-4 text-xs font-bold uppercase tracking-widest text-primary-foreground disabled:opacity-50" data-testid="button-upload-fan-card-photo">
          <ImagePlus className="h-4 w-4" aria-hidden="true" />{isBusy ? 'Saving…' : photoUrl ? 'Replace photo' : 'Upload photo'}
        </button>
        {photoUrl && <button type="button" onClick={() => void removePhoto()} disabled={isBusy} className="inline-flex min-h-11 items-center gap-2 border border-red-300/60 px-4 text-xs font-bold uppercase tracking-widest text-red-200 disabled:opacity-50" data-testid="button-remove-fan-card-photo"><Trash2 className="h-4 w-4" aria-hidden="true" />Remove</button>}
      </div>
      {notice && <p className="mt-3 text-xs font-medium text-white/75" role="status" data-testid="status-fan-card-photo">{notice}</p>}
    </section>
  );
}
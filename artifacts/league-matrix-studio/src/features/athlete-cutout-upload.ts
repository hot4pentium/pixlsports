import { confirmAthleteInvitePhoto, requestAthleteInvitePhotoUploadUrl } from '@workspace/api-client-react';

const MAX_CUTOUT_BYTES = 5 * 1024 * 1024;

export async function saveAthleteCutout(inviteToken: string, cutout: Blob, sourcePhotoRevision: string) {
  if (!['image/png', 'image/webp'].includes(cutout.type) || !cutout.size || cutout.size > MAX_CUTOUT_BYTES) {
    throw new Error('The transparent cutout must be a PNG or WebP under 5 MB.');
  }
  const claim = await requestAthleteInvitePhotoUploadUrl(inviteToken, {
    contentType: cutout.type as 'image/png' | 'image/webp',
    size: cutout.size,
  });
  const upload = await fetch(claim.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': cutout.type },
    body: cutout,
  });
  if (!upload.ok) throw new Error('The cutout upload did not finish.');
  return confirmAthleteInvitePhoto(inviteToken, {
    objectPath: claim.objectPath,
    mediaRole: 'cutout',
    sourcePhotoRevision,
  });
}
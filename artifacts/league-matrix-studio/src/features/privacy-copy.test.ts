import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LANDING_MEDIA_BADGE,
  LANDING_MEDIA_DETAIL,
  LOCAL_MEDIA_DEFAULT,
  PUBLIC_SHARE_MEDIA,
  HYPE_CARD_ATHLETE_PHOTO_PRIVACY,
  HYPE_CARD_ATHLETE_PHOTO_UPLOAD_NOTICE,
  SUPPORT_TICKET_ATTACHMENT_PRIVACY,
} from './privacy-copy';

test('privacy copy distinguishes local source media from published share media', () => {
  assert.match(LANDING_MEDIA_BADGE, /on-device by default/i);
  assert.match(LANDING_MEDIA_DETAIL, /source photos and videos stay on your device/i);
  assert.match(LANDING_MEDIA_DETAIL, /publishing a hype card hosts a prepared copy/i);
  assert.match(LOCAL_MEDIA_DEFAULT, /source media stays on your device by default/i);
  assert.match(PUBLIC_SHARE_MEDIA, /prepared image or video\/poster/i);
  assert.match(PUBLIC_SHARE_MEDIA, /expires or you revoke it/i);
  assert.match(HYPE_CARD_ATHLETE_PHOTO_PRIVACY, /account-restricted cloud storage/i);
  assert.match(HYPE_CARD_ATHLETE_PHOTO_PRIVACY, /anyone who has its link/i);
  assert.match(HYPE_CARD_ATHLETE_PHOTO_UPLOAD_NOTICE, /prepared photo will appear on the active public hype card page/i);
  assert.match(HYPE_CARD_ATHLETE_PHOTO_UPLOAD_NOTICE, /anyone with its link/i);
  assert.match(HYPE_CARD_ATHLETE_PHOTO_UPLOAD_NOTICE, /remove the photo or pause the hype card page/i);
  assert.match(SUPPORT_TICKET_ATTACHMENT_PRIVACY, /private cloud storage with the ticket/i);
  assert.match(SUPPORT_TICKET_ATTACHMENT_PRIVACY, /text reply is still saved/i);
});
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import QRCode from 'qrcode';

const component = readFileSync(new URL('./hype-card-share-qr.tsx', import.meta.url), 'utf8');
const showcase = readFileSync(new URL('./player-showcase.tsx', import.meta.url), 'utf8');
const native = readFileSync(new URL('../../../../ios/PIXL Sports/SupporterHypeCardView.swift', import.meta.url), 'utf8');

test('PWA QR uses the public sharing URL only inside the existing shareability gate', () => {
  assert.match(showcase, /isShareable && publicHypeCardUrl \? \([\s\S]*?<HypeCardShareQr key=\{publicHypeCardUrl\} url=\{publicHypeCardUrl\}/);
  assert.match(component, /QRCode\.toDataURL\(url,/);
  assert.match(component, /margin: 4/);
  assert.doesNotMatch(component, /fetch\(|mutate|publish|live-taps/);
});

test('PWA QR is expandable, accessible, retryable, and rejects stale link images', () => {
  assert.match(component, /aria-expanded=\{expanded\} aria-controls=\{panelId\}/);
  assert.match(component, /result\?\.url === url \? result : null/);
  assert.match(component, /return \(\) => \{ active = false; \}/);
  assert.match(component, /role="alert"/);
  assert.match(component, /Try again/);
  assert.match(component, /QR code for \$\{athleteName\}'s HYPE Card/);
});

test('the local QR encoder produces a PNG for a public HYPE Card link', async () => {
  const image = await QRCode.toDataURL('https://example.com/fan/sample-card', {
    errorCorrectionLevel: 'M', margin: 4, width: 320,
    color: { dark: '#000000', light: '#ffffff' },
  });
  assert.match(image, /^data:image\/png;base64,/);
  const png = Buffer.from(image.split(',')[1], 'base64');
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
});

test('iOS QR uses the existing permitted ShareLink URL with a white quiet zone', () => {
  assert.match(native, /import CoreImage\.CIFilterBuiltins/);
  assert.match(native, /if let shareURL = card\.shareURL,[\s\S]*?settings\?\.showHypeCard == true && settings\?\.paused == false[\s\S]*?ShareLink\(item: shareURL\)[\s\S]*?NativeHypeCardShareQR\(url: shareURL, athleteName: card\.athleteName\)/);
  assert.match(native, /filter\.message = Data\(url\.absoluteString\.utf8\)/);
  assert.match(native, /source\.size\.width \+ 64/);
  assert.match(native, /source\.draw\(at: CGPoint\(x: 32, y: 32\)\)/);
  assert.match(native, /interpolationQuality = \.none/);
  assert.match(native, /native-hype-card-show-qr/);
});

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  defaultProject,
  clearHypeCardMedia,
  designOnlyProject,
  normalizeHypeCardProject,
  parseHypeCardTemplate,
  readHypeCardProject,
  saveHypeCardProject,
  serializeHypeCardTemplate,
  type HypeCardProject,
} from './hype-card-types';
import { buildPositionBadgeMarkup } from './position-badge';

class MemoryStorage implements Pick<Storage, 'getItem' | 'setItem'> {
  private readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

test('new Hype Card projects leave the moment blank for custom entry', () => {
  const project = defaultProject();

  assert.equal(project.headline, '');
  assert.equal(normalizeHypeCardProject({}).headline, '');
});

test('custom position labels survive local save, reload, and exported badge markup', () => {
  const labels = [
    'GK',
    'GOALKEEPER',
    'CENTER BACK DEFENSIVE MIDFIELDER EXTRAORDINARY',
  ];

  for (const position of labels) {
    const storage = new MemoryStorage();
    const project: HypeCardProject = {
      ...defaultProject(),
      position,
      mediaType: 'image',
      mediaId: 'local-image',
      photo: 'data:image/png;base64,local-photo',
      logo: 'data:image/png;base64,local-logo',
    };

    const downloadedTemplate = serializeHypeCardTemplate(designOnlyProject(project));

    saveHypeCardProject(storage as Storage, project);

    const reloaded = readHypeCardProject(storage as Storage);
    assert.ok(reloaded);
    assert.equal(reloaded.position, position);
    assert.match(
      buildPositionBadgeMarkup(reloaded.position, '#123456', '#abcdef'),
      new RegExp(`>${position.toUpperCase()}<`),
    );
  }
});

test('custom position labels survive a downloaded template and file import', () => {
  const labels = [
    'GK',
    'GOALKEEPER',
    'CENTER BACK DEFENSIVE MIDFIELDER EXTRAORDINARY',
  ];

  for (const position of labels) {
    const project: HypeCardProject = {
      ...defaultProject(),
      position,
      mediaType: 'image',
      mediaId: 'local-image',
      photo: 'data:image/png;base64,local-photo',
      logo: 'data:image/png;base64,local-logo',
    };

    const downloadedTemplate = serializeHypeCardTemplate(designOnlyProject(project));
    const savedProject = designOnlyProject(project);
    const cloudResponse = {
      id: 'cloud-project',
      name: 'Saved design',
      project: savedProject,
      revision: 2,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      media: [],
    };

    assert.equal(savedProject.position, position);
    assert.equal(savedProject.mediaType, null);
    assert.equal(savedProject.mediaId, null);
    assert.equal(savedProject.photo, null);
    assert.equal(savedProject.logo, null);

    const reopened = normalizeHypeCardProject(cloudResponse.project);
    assert.equal(reopened.position, position);
  }
});

test('portable templates keep design text while omitting uploaded media', () => {
  const project: HypeCardProject = {
    ...defaultProject(),
    headline: 'CHAMPIONSHIP MOMENT',
    playerName: 'Jordan Lee',
    mediaType: 'video',
    mediaId: 'local-video',
    videoMeta: {
      name: 'highlight.mp4',
      type: 'video/mp4',
      size: 2048,
      duration: 12,
    },
    photo: 'data:image/png;base64,video-poster',
    logo: 'data:image/png;base64,team-logo',
  };

  const reopened = parseHypeCardTemplate(serializeHypeCardTemplate(project));

  assert.ok(reopened);
  assert.equal(reopened.headline, project.headline);
  assert.equal(reopened.playerName, project.playerName);
  assert.equal(reopened.template, project.template);
  assert.equal(reopened.layout, project.layout);
  assert.equal(reopened.mediaType, null);
  assert.equal(reopened.mediaId, null);
  assert.equal(reopened.videoMeta, null);
  assert.equal(reopened.photo, null);
  assert.equal(reopened.logo, null);
});

test('legacy lower third visibility preferences are ignored during normalization', () => {
  const normalized = normalizeHypeCardProject({ ...defaultProject(), showLowerThird: true });

  assert.equal('showLowerThird' in normalized, false);
});

test('saved projects always reopen in the portrait card format', () => {
  for (const legacyFormat of ['square', 'story', 'landscape']) {
    const reopened = normalizeHypeCardProject({
      ...defaultProject(),
      format: legacyFormat,
    });

    assert.equal(reopened.format, 'card');
  }
});

test('empty projects stay media-free and missing local media can be cleared safely', () => {
  const empty = defaultProject();
  assert.equal(empty.mediaType, null);
  assert.equal(empty.mediaId, null);
  assert.equal(empty.photo, null);

  const missing = normalizeHypeCardProject({
    ...empty,
    mediaType: 'image',
    mediaId: 'missing-local-image',
  });
  assert.equal(missing.mediaType, 'image');
  assert.equal(missing.mediaId, 'missing-local-image');

  const cleared = clearHypeCardMedia(missing);
  assert.equal(cleared.mediaType, null);
  assert.equal(cleared.mediaId, null);
  assert.equal(cleared.downloadMediaId, null);
  assert.equal(cleared.posterMediaId, null);
  assert.equal(cleared.photo, null);
});

test('a saved image with an embedded preview does not retain a separate media reference', () => {
  const project = normalizeHypeCardProject({
    ...defaultProject(),
    mediaType: 'image',
    mediaId: 'stale-local-image',
    photo: 'data:image/png;base64,embedded-photo',
  });

  assert.equal(project.mediaType, 'image');
  assert.equal(project.mediaId, null);
  assert.equal(project.photo, 'data:image/png;base64,embedded-photo');
});

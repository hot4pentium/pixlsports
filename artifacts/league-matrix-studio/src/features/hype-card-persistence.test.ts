import assert from 'node:assert/strict';
import test from 'node:test';

import {
  defaultProject,
  designOnlyProject,
  getInitialHypeCardProject,
  normalizeHypeCardProject,
  parseHypeCardTemplate,
  readHypeCardProject,
  readHypeCardEditorSession,
  saveHypeCardProject,
  saveHypeCardEditorSession,
  shouldResumeLocalHypeCard,
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

test('new Hype Cards start blank even when an older local draft exists', () => {
  const storage = new MemoryStorage();
  const oldDraft = {
    ...defaultProject(),
    headline: 'OLD DRAFT',
    playerName: 'Previous Player',
    mediaType: 'image' as const,
    photo: 'data:image/png;base64,old-photo',
    logo: 'data:image/png;base64,old-logo',
  };
  saveHypeCardProject(storage as Storage, oldDraft);

  const fresh = getInitialHypeCardProject({ storage, resumeLocal: false });

  assert.equal(fresh.headline, defaultProject().headline);
  assert.equal(fresh.playerName, '');
  assert.equal(fresh.mediaType, null);
  assert.equal(fresh.photo, null);
  assert.equal(fresh.logo, null);
});

test('local draft resume is explicit and cloud projects start from a safe placeholder', () => {
  const storage = new MemoryStorage();
  const saved = { ...defaultProject(), headline: 'RESUME THIS' };
  saveHypeCardProject(storage as Storage, saved);

  assert.equal(shouldResumeLocalHypeCard('?resume=local'), true);
  assert.equal(shouldResumeLocalHypeCard('?resume=new'), false);
  assert.equal(getInitialHypeCardProject({ storage, resumeLocal: true }).headline, 'RESUME THIS');
  assert.equal(getInitialHypeCardProject({ cloudProjectId: 'cloud-1', storage, resumeLocal: true }).headline, defaultProject().headline);
});

test('reload session markers only restore for the same account', () => {
  const storage = new MemoryStorage();
  saveHypeCardEditorSession('guest-account-a', storage as Storage);

  assert.equal(readHypeCardEditorSession(storage as Storage)?.ownerId, 'guest-account-a');
  assert.equal(readHypeCardEditorSession(storage as Storage)?.ownerId === 'guest-account-b', false);
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

test('existing cards show the lower third unless explicitly disabled', () => {
  const { showLowerThird: _legacyLowerThird, ...legacyProject } = defaultProject();
  assert.equal(normalizeHypeCardProject(legacyProject).showLowerThird, true);
  assert.equal(normalizeHypeCardProject({ ...defaultProject(), showLowerThird: false }).showLowerThird, false);
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

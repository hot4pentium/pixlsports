import assert from 'node:assert/strict';
import test from 'node:test';

import {
  defaultProject,
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

test('existing cards show the lower third unless explicitly disabled', () => {
  const { showLowerThird: _legacyLowerThird, ...legacyProject } = defaultProject();
  assert.equal(normalizeHypeCardProject(legacyProject).showLowerThird, true);
  assert.equal(normalizeHypeCardProject({ ...defaultProject(), showLowerThird: false }).showLowerThird, false);
});

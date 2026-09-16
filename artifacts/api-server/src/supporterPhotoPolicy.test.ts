import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isUsableSupporterPhotoClaim,
  replacedSupporterPhotoPath,
} from './lib/supporterPhotoPolicy';

const future = new Date('2030-01-01T00:00:00.000Z');
const now = new Date('2029-01-01T00:00:00.000Z');

test('photo claims cannot be used by another signed-in owner', () => {
  const claim = { ownerClerkUserId: 'owner-a', objectPath: '/objects/uploads/a', expiresAt: future };
  assert.equal(isUsableSupporterPhotoClaim(claim, 'owner-a', claim.objectPath, now), true);
  assert.equal(isUsableSupporterPhotoClaim(claim, 'owner-b', claim.objectPath, now), false);
  assert.equal(isUsableSupporterPhotoClaim(claim, 'owner-a', '/objects/uploads/b', now), false);
});

test('replacement deletes only the previous distinct photo', () => {
  assert.equal(replacedSupporterPhotoPath('/objects/uploads/old', '/objects/uploads/new'), '/objects/uploads/old');
  assert.equal(replacedSupporterPhotoPath('/objects/uploads/same', '/objects/uploads/same'), undefined);
  assert.equal(replacedSupporterPhotoPath(undefined, '/objects/uploads/new'), undefined);
});
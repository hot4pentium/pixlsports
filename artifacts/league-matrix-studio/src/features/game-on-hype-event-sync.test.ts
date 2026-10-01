import assert from 'node:assert/strict';
import test from 'node:test';
import { QueryClient } from '@tanstack/react-query';
import { invalidateHypeCardEvents } from './game-on-hype-event-sync';

test('saving an Event Card invalidates owner, page and fan Events caches without touching unrelated work', async () => {
  const client = new QueryClient();
  const keys = [
    ['/api/athlete-invites', 'owner'],
    ['/api/athlete-invites/athlete'],
    ['/api/athlete-invites/athlete/fan'],
  ];
  for (const key of keys) client.setQueryData(key, { events: [] });
  client.setQueryData(['/api/projects'], []);
  await invalidateHypeCardEvents(client);
  for (const key of keys) assert.equal(client.getQueryState(key)?.isInvalidated, true);
  assert.equal(client.getQueryState(['/api/projects'])?.isInvalidated, false);
  client.clear();
});
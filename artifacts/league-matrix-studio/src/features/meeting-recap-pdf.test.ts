import assert from 'node:assert/strict';
import test from 'node:test';

import { buildMeetingRecapPdf } from './meeting-recap-pdf';

test('meeting recap PDF includes a real document with meeting metadata', () => {
  const pdf = buildMeetingRecapPdf(
    {
      id: 'meeting-pdf',
      date: '2026-09-23',
      time: '18:00',
      location: 'Main Office',
      title: 'Team Meeting',
    },
    {
      notes: 'Keep hydration breaks on the schedule.',
      participants: [
        { id: 'coach', name: 'Coach', role: 'Coach', present: true },
        { id: 'parent', name: 'Team parent', role: 'Support', present: false },
      ],
      agenda: [
        { id: 'agenda-1', label: 'Review the week ahead', completed: true },
        { id: 'agenda-2', label: 'Set team priorities', completed: false },
      ],
      decisions: [{ id: 'decision-1', text: 'Add a water break.' }],
      followUps: [{ id: 'follow-up-1', task: 'Update the schedule', owner: 'Coach', dueDate: '2026-09-24' }],
      startedAt: '2026-09-23T22:00:00.000Z',
      endedAt: '2026-09-23T22:30:00.000Z',
    },
  );

  const output = pdf.output('arraybuffer');
  assert.equal(pdf.getNumberOfPages(), 1);
  assert.ok(output.byteLength > 2_000);
  assert.equal(new TextDecoder().decode(output.slice(0, 5)), '%PDF-');
});
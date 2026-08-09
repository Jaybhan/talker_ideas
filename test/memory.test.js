import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildUserMessage, relativeDay } from '../src/prompts.js';

const TODAY = new Date('2026-08-09T12:00:00');
const iso = (daysAgo) =>
  new Date(TODAY.getTime() - daysAgo * 86400000).toISOString().slice(0, 10);

test('recent events are phrased in days, not dates', () => {
  assert.equal(relativeDay(iso(0), TODAY), 'today');
  assert.equal(relativeDay(iso(1), TODAY), 'yesterday');
  assert.equal(relativeDay(iso(3), TODAY), '3 days ago');
  assert.equal(relativeDay(iso(9), TODAY), 'last week');
  assert.match(relativeDay(iso(30), TODAY), /weeks ago/);
});

test('a malformed date degrades to the raw string rather than throwing', () => {
  assert.equal(relativeDay('not-a-date', TODAY), 'not-a-date');
});

/* The regression this guards: an earlier version generalized "watched the new
   Spider-Man" into the topic "likes films" and dropped the specifics, so the
   next day he could not name the film without spelling it out. */
test('specific recent events reach the prompt intact', () => {
  const prompt = buildUserMessage({
    transcript: [{ speaker: 'them', speakerName: 'Sam', text: 'Seen anything good?' }],
    memory: {
      recent: [
        { when: iso(1), what: 'Watched the new Spider-Man; thought it was much better.' },
      ],
      topics: ['films'],
    },
  });
  assert.match(prompt, /Spider-Man/, 'the film name must survive into the prompt');
  assert.match(prompt, /much better/, 'his opinion must survive too');
});

test('recent events are marked as his own account, not invented', () => {
  const prompt = buildUserMessage({
    transcript: [],
    memory: { recent: [{ when: iso(1), what: 'Went to the match with Sam.' }] },
  });
  // The suggestion prompt forbids inventing facts; recent events must be
  // explicitly licensed or the model will refuse to use them.
  assert.match(prompt, /not invented|his own account/i);
});

test('only the most recent events are sent, oldest dropped', () => {
  const recent = Array.from({ length: 20 }, (_, i) => ({
    when: iso(1),
    what: `event number ${i}`,
  }));
  const prompt = buildUserMessage({ transcript: [], memory: { recent } });
  assert.ok(!prompt.includes('event number 0'), 'oldest should be trimmed');
  assert.match(prompt, /event number 19/, 'newest must be kept');
});

test('an empty profile does not produce a misleading prompt', () => {
  const prompt = buildUserMessage({ transcript: [], memory: {} });
  assert.match(prompt, /Nothing known yet/);
});

test('the steer note is included only when given', () => {
  const withNudge = buildUserMessage({ transcript: [], memory: {}, nudge: 'want to go out' });
  assert.match(withNudge, /want to go out/);
  const without = buildUserMessage({ transcript: [], memory: {}, nudge: '   ' });
  assert.ok(!without.includes('<steer>'));
});

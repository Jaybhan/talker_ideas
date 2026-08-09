import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const FILE = resolve(process.cwd(), 'data/memory.json');

const EMPTY = {
  about: '',
  people: [],
  topics: [],
  notes: [],
  phrases: [],
  /** Tone pick counts, learned locally from his taps — costs no tokens. */
  tonePreference: {},
  updatedAt: null,
};

let cache = null;

export async function load() {
  if (cache) return cache;
  try {
    const raw = await readFile(FILE, 'utf8');
    cache = { ...EMPTY, ...JSON.parse(raw) };
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn('[memory] unreadable, starting fresh:', err.message);
    cache = { ...EMPTY };
  }
  return cache;
}

export async function save(next) {
  cache = { ...EMPTY, ...next, updatedAt: new Date().toISOString() };
  await mkdir(dirname(FILE), { recursive: true });
  await writeFile(FILE, JSON.stringify(cache, null, 2));
  return cache;
}

/**
 * Record which tone he picked. This is the cheap half of the memory layer: it
 * needs no model call, and after a few dozen taps it is a better signal about
 * how he likes to sound than anything an LLM would infer from a transcript.
 */
export async function recordTonePick(tone) {
  const memory = await load();
  if (!tone) return memory;
  const counts = { ...memory.tonePreference };
  counts[tone] = (counts[tone] || 0) + 1;
  return save({ ...memory, tonePreference: counts });
}

/** Merge a model-produced profile update, keeping locally-learned fields intact. */
export async function mergeReflection(update) {
  const memory = await load();
  return save({
    ...memory,
    about: update.about ?? memory.about,
    people: capped(update.people, 12),
    topics: capped(update.topics, 12),
    notes: capped(update.notes, 15),
    phrases: capped(update.phrases, 10),
    tonePreference: memory.tonePreference, // never let the model rewrite this
  });
}

function capped(list, n) {
  return Array.isArray(list) ? list.slice(0, n) : [];
}

import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const FILE = resolve(process.cwd(), 'data/memory.json');

/** How long a specific event stays relevant before it's dropped. */
const RECENT_TTL_DAYS = 21;

const EMPTY = {
  about: '',
  /** Dated specifics — what actually happened. Expires. */
  recent: [],
  people: [],
  topics: [],
  notes: [],
  phrases: [],
  /** Tone pick counts, learned locally from his taps — costs no tokens. */
  tonePreference: {},
  updatedAt: null,
};

let cache = null;
let cacheStamp = 0;

/**
 * Reads through to disk when the file has changed underneath us. The profile is
 * meant to be hand-editable — a caregiver correcting a wrong fact should not
 * have to restart the server for it to take effect.
 */
export async function load() {
  try {
    const { mtimeMs } = await stat(FILE);
    if (cache && mtimeMs === cacheStamp) return cache;
    cache = withoutStaleEvents({ ...EMPTY, ...JSON.parse(await readFile(FILE, 'utf8')) });
    cacheStamp = mtimeMs;
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn('[memory] unreadable, starting fresh:', err.message);
    cache ??= { ...EMPTY };
  }
  return cache;
}

/** Drop events old enough that mentioning them would be odd rather than helpful. */
function withoutStaleEvents(memory) {
  const cutoff = Date.now() - RECENT_TTL_DAYS * 86400000;
  return {
    ...memory,
    recent: (memory.recent || []).filter((item) => {
      const when = new Date(`${item?.when}T00:00:00`).getTime();
      return Number.isNaN(when) ? false : when >= cutoff;
    }),
  };
}

export async function save(next) {
  cache = withoutStaleEvents({ ...EMPTY, ...next, updatedAt: new Date().toISOString() });
  await mkdir(dirname(FILE), { recursive: true });
  await writeFile(FILE, JSON.stringify(cache, null, 2));
  cacheStamp = (await stat(FILE)).mtimeMs;
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
    recent: capped(update.recent, 20, 'tail'),
    people: capped(update.people, 12),
    topics: capped(update.topics, 12),
    notes: capped(update.notes, 15),
    phrases: capped(update.phrases, 10),
    tonePreference: memory.tonePreference, // never let the model rewrite this
  });
}

/** `recent` is newest-last, so trim from the front; every other list from the end. */
function capped(list, n, from = 'head') {
  if (!Array.isArray(list)) return [];
  return from === 'tail' ? list.slice(-n) : list.slice(0, n);
}

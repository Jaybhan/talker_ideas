import Anthropic from '@anthropic-ai/sdk';
import { ArrayItemScanner } from './stream-json.js';
import {
  SYSTEM_PROMPT,
  SUGGESTION_SCHEMA,
  REFLECT_SYSTEM_PROMPT,
  MEMORY_SCHEMA,
  TONES,
  buildUserMessage,
} from './prompts.js';

const MODEL = process.env.TALKER_MODEL || 'claude-opus-5';
const EFFORT = process.env.TALKER_EFFORT || 'low';

const client = new Anthropic(); // reads ANTHROPIC_API_KEY

/** $ per million tokens. Used only for the local spend ledger. */
const PRICING = {
  'claude-opus-5': { in: 5, out: 25 },
  'claude-opus-4-8': { in: 5, out: 25 },
  'claude-sonnet-5': { in: 3, out: 15 },
  'claude-haiku-4-5': { in: 1, out: 5 },
};

/**
 * `effort` and explicit thinking config are only accepted on the newer tiers —
 * Haiku 4.5 rejects `effort` with a 400. Omitting both there gives the same
 * behavior we want anyway (no thinking, fastest path).
 */
const SUPPORTS_EFFORT = !/^claude-haiku/.test(MODEL);

function tuning(effort) {
  return SUPPORTS_EFFORT
    ? { thinking: { type: 'disabled' }, effort }
    : { thinking: undefined, effort: undefined };
}

export const ledger = {
  calls: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costUsd: 0,
};

function record(usage) {
  if (!usage) return;
  const p = PRICING[MODEL] || PRICING['claude-opus-5'];
  const input = usage.input_tokens || 0;
  const output = usage.output_tokens || 0;
  const cacheRead = usage.cache_read_input_tokens || 0;
  const cacheWrite = usage.cache_creation_input_tokens || 0;

  ledger.calls++;
  ledger.inputTokens += input;
  ledger.outputTokens += output;
  ledger.cacheReadTokens += cacheRead;
  ledger.cacheWriteTokens += cacheWrite;
  ledger.costUsd +=
    (input * p.in + cacheWrite * p.in * 1.25 + cacheRead * p.in * 0.1 + output * p.out) /
    1_000_000;
}

/**
 * Generate suggestions for what the AAC user might say next.
 *
 * Two-phase streaming, matching the two-array schema:
 *   `onIntent`  — a tile label, ~1s in. Fires five times, fast.
 *   `onWording` — the three spoken sentences for tile N, as they finish.
 *
 * The UI paints tiles from the first callback and enables them from the second,
 * so he can be reading his options while the sentences are still being written.
 */
export async function suggest({ transcript, memory, nudge, onIntent, onWording } = {}) {
  const started = Date.now();
  const intentScanner = new ArrayItemScanner('intents');
  const wordingScanner = new ArrayItemScanner('wordings');
  const intents = [];
  const wordings = [];
  let firstIntentMs = null;
  let allIntentsMs = null;

  const tune = tuning(EFFORT);
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 2000,
    ...(tune.thinking ? { thinking: tune.thinking } : {}),
    output_config: {
      ...(tune.effort ? { effort: tune.effort } : {}),
      format: { type: 'json_schema', schema: SUGGESTION_SCHEMA },
    },
    system: [
      { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    ],
    messages: [
      { role: 'user', content: buildUserMessage({ transcript, memory, nudge }) },
    ],
  });

  stream.on('text', (delta) => {
    for (const raw of intentScanner.push(delta)) {
      const label = String(raw?.label || '').trim().slice(0, 40);
      if (!label) continue;
      if (firstIntentMs === null) firstIntentMs = Date.now() - started;
      const intent = { index: intents.length, label, emoji: firstGlyph(raw.emoji) || '💬' };
      intents.push(intent);
      allIntentsMs = Date.now() - started;
      onIntent?.(intent);
    }

    for (const raw of wordingScanner.push(delta)) {
      const variants = normalizeVariants(raw?.variants);
      if (!variants.length) continue;
      const wording = { index: wordings.length, variants };
      wordings.push(wording);
      onWording?.(wording);
    }
  });

  const final = await stream.finalMessage();
  record(final.usage);

  // Stitch for non-streaming consumers (tests, any future batch use).
  const combined = intents.map((intent) => ({
    ...intent,
    variants: wordings[intent.index]?.variants || [],
  }));

  return {
    intents: combined.slice(0, 6),
    stopReason: final.stop_reason,
    ms: Date.now() - started,
    firstIntentMs,
    allIntentsMs,
  };
}

/**
 * Update the stored profile from a finished conversation.
 * Runs in the background; a failure here must never break the app.
 */
export async function reflect({ transcript, memory }) {
  const tune = tuning('low');
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1500,
    ...(tune.thinking ? { thinking: tune.thinking } : {}),
    output_config: {
      ...(tune.effort ? { effort: tune.effort } : {}),
      format: { type: 'json_schema', schema: MEMORY_SCHEMA },
    },
    system: REFLECT_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content:
          `<current_profile>\n${JSON.stringify(stripLocalFields(memory), null, 2)}\n</current_profile>\n\n` +
          `<transcript>\n${transcript
            .map((t) => `${t.speaker === 'me' ? 'HIM' : t.speakerName || 'THEM'}: ${t.text}`)
            .join('\n')}\n</transcript>\n\n` +
          'Return the updated profile.',
      },
    ],
  });

  record(response.usage);

  const text = response.content.find((b) => b.type === 'text')?.text;
  if (!text) throw new Error('reflect: no text block in response');
  return JSON.parse(text);
}

function stripLocalFields(memory) {
  const { tonePreference, updatedAt, ...rest } = memory || {};
  return rest;
}

/**
 * Defensive normalization. The schema constrains shape but not sanity — a model
 * can still return an empty string or eight variants. Everything here gets
 * spoken aloud in his voice, so clamp rather than trust the payload.
 */
function normalizeVariants(list) {
  return (Array.isArray(list) ? list : [])
    .map((v) => ({
      tone: TONES.includes(v?.tone) ? v.tone : 'casual',
      text: String(v?.text || '').trim().slice(0, 300),
    }))
    .filter((v) => v.text.length > 0)
    .slice(0, 4);
}

function firstGlyph(s) {
  if (typeof s !== 'string') return null;
  const chars = [...s.trim()];
  return chars.length ? chars[0] : null;
}

import 'dotenv/config';
import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { suggest, reflect, ledger } from './src/claude.js';
import * as memory from './src/memory.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '256kb' }));
app.use(express.static(join(__dirname, 'public')));

/**
 * Suggestion stream.
 *
 * Server-sent events rather than a plain JSON response: intents are emitted as
 * they finish generating, so the first tile lands well before the last one. In
 * an AAC context that difference is the difference between the app feeling
 * responsive and feeling like a wait.
 */
app.post('/api/suggest', async (req, res) => {
  const { transcript = [], nudge = '' } = req.body || {};

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const send = (event, data) =>
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  try {
    const mem = await memory.load();
    const result = await suggest({
      transcript: transcript.slice(-12), // recent context is what matters
      memory: mem,
      nudge,
      onIntent: (intent) => send('intent', intent),
      onWording: (wording) => send('wording', wording),
    });

    send('done', {
      ms: result.ms,
      firstIntentMs: result.firstIntentMs,
      count: result.intents.length,
      spentUsd: Number(ledger.costUsd.toFixed(4)),
    });
  } catch (err) {
    console.error('[suggest]', err);
    send('error', { message: friendlyError(err) });
  } finally {
    res.end();
  }
});

/** Called when he taps a variant — learns his tone preference for free. */
app.post('/api/spoke', async (req, res) => {
  const { tone } = req.body || {};
  try {
    await memory.recordTonePick(tone);
    res.json({ ok: true });
  } catch (err) {
    console.error('[spoke]', err);
    res.status(500).json({ ok: false });
  }
});

app.get('/api/memory', async (_req, res) => {
  res.json(await memory.load());
});

app.put('/api/memory', async (req, res) => {
  try {
    res.json(await memory.save({ ...(await memory.load()), ...req.body }));
  } catch (err) {
    console.error('[memory:put]', err);
    res.status(500).json({ error: 'could not save' });
  }
});

/** End-of-conversation profile update. Fire-and-forget from the client's view. */
app.post('/api/reflect', async (req, res) => {
  const { transcript = [] } = req.body || {};
  if (transcript.length < 4) return res.json({ skipped: 'conversation too short' });

  try {
    const updated = await reflect({ transcript, memory: await memory.load() });
    res.json(await memory.mergeReflection(updated));
  } catch (err) {
    console.error('[reflect]', err);
    res.status(500).json({ error: 'could not update profile' });
  }
});

app.get('/api/usage', (_req, res) => {
  res.json({ ...ledger, costUsd: Number(ledger.costUsd.toFixed(4)) });
});

function friendlyError(err) {
  if (err?.status === 401) return 'API key rejected. Check ANTHROPIC_API_KEY in .env.';
  if (err?.status === 429) return 'Rate limited. Try again in a moment.';
  if (err?.status === 400 && /credit|balance/i.test(err?.message || ''))
    return 'API credit exhausted.';
  if (err?.status >= 500) return 'Claude is having trouble. Try again.';
  return 'Could not get suggestions. Use the quick phrases or the keyboard.';
}

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('\n  Missing ANTHROPIC_API_KEY. Copy .env.example to .env first.\n');
  process.exit(1);
}

app.listen(PORT, () => {
  console.log(`\n  Talker running:  http://localhost:${PORT}`);
  console.log(`  Model:           ${process.env.TALKER_MODEL || 'claude-opus-5'}`);
  console.log(`  Effort:          ${process.env.TALKER_EFFORT || 'low'}\n`);
});

/**
 * Latency/cost/quality comparison across models, for one representative turn.
 *
 * In AAC, time-to-first-tile is not a nice-to-have — a suggestion that arrives
 * after the moment has passed is worth nothing. Run this before changing
 * TALKER_MODEL so the tradeoff is a measured one.
 *
 *   node test/compare-models.js
 */
import 'dotenv/config';

const MODELS = ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'];
const RUNS = 2;

const SCENARIO = {
  memory: {
    about: 'A man in his 20s who uses AAC. Lives with his mother.',
    people: [{ name: 'Mom', relationship: 'mother, main caregiver' }],
    topics: ['football', 'films'],
    notes: ['Dislikes being asked how he is feeling repeatedly.'],
    phrases: [],
    tonePreference: {},
  },
  transcript: [
    { speaker: 'them', speakerName: 'Mom', text: 'How are you doing this morning, love?' },
  ],
};

for (const model of MODELS) {
  process.env.TALKER_MODEL = model;
  // Fresh import per model: the client reads env at module load.
  const { suggest, ledger } = await import(`../src/claude.js?m=${model}`);

  const firsts = [];
  const alls = [];
  const fulls = [];
  let sample = null;

  for (let i = 0; i < RUNS; i++) {
    try {
      const r = await suggest({ ...SCENARIO });
      firsts.push(r.firstIntentMs);
      alls.push(r.allIntentsMs);
      fulls.push(r.ms);
      sample ??= r.intents;
    } catch (err) {
      console.log(`\n  ${model.padEnd(18)} FAILED: ${err.message}`);
      break;
    }
  }

  if (!firsts.length) continue;

  console.log(`\n${'─'.repeat(70)}`);
  console.log(`  ${model}`);
  console.log(`${'─'.repeat(70)}`);
  console.log(
    `  first tile ${med(firsts)}ms   all tiles ${med(alls)}ms   complete ${med(fulls)}ms   ` +
      `$${(ledger.costUsd / firsts.length).toFixed(4)}/turn`
  );
  console.log();
  for (const intent of sample) {
    console.log(`  ${intent.emoji}  ${intent.label.padEnd(24)} ${q(intent.variants[0])}`);
  }
}

function med(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}
function q(v) {
  return v ? `"${v.text}"` : '(none)';
}
console.log();

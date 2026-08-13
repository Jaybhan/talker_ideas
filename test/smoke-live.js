/**
 * Live smoke test — makes real API calls. Run with: npm run smoke
 *
 * Prints the suggestions, the time to first tile, and the cost, so prompt
 * changes can be judged on quality *and* on the two numbers that decide whether
 * this is usable in a real conversation.
 */
import 'dotenv/config';
import { suggest, ledger } from '../src/claude.js';

const SCENARIOS = [
  {
    name: 'Mom asks an open question',
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
  },
  {
    name: 'Serious moment — tone must not be flippant',
    memory: { about: '', people: [], topics: [], notes: [], phrases: [], tonePreference: {} },
    transcript: [
      { speaker: 'them', speakerName: 'Mom', text: "I got the results back from the hospital. It's not what we hoped." },
    ],
  },
  {
    /* Regression: memory used to lock him into a past opinion. With a profile
       entry saying he liked the film, every tile pushed back on Mom's reading
       and there was no way to simply agree with her. Look for a tile that
       concedes — if all five defend the earlier opinion, this has regressed. */
    name: 'Must be able to contradict his own recorded opinion',
    memory: {
      about: '',
      people: [{ name: 'Mom', relationship: 'mother' }],
      topics: ['films'],
      notes: [],
      phrases: [],
      recent: [
        {
          when: new Date().toISOString().slice(0, 10),
          what: 'Watched the new Spider-Man; thought it was much better than the last one and wants to watch it again.',
        },
      ],
      tonePreference: {},
    },
    transcript: [
      { speaker: 'them', speakerName: 'Mom', text: 'Have you seen any films recently?' },
      { speaker: 'me', text: 'New Spider-Man. Last night.' },
      { speaker: 'them', speakerName: 'Mom', text: "Oh that's cool, did you like it?" },
      { speaker: 'me', text: 'Good film, but the snacks did a lot of work.' },
      { speaker: 'them', speakerName: 'Mom', text: "I see, so it wasn't your favourite." },
    ],
  },
  {
    name: 'Mid-conversation, he should be able to ask back',
    memory: {
      about: '',
      people: [{ name: 'Sam', relationship: 'friend from school' }],
      topics: ['football'],
      notes: [],
      phrases: [],
      tonePreference: {},
    },
    transcript: [
      { speaker: 'them', speakerName: 'Sam', text: 'Did you watch the match last night?' },
      { speaker: 'me', text: "No, I missed it." },
      { speaker: 'them', speakerName: 'Sam', text: 'Ah mate, you missed a good one. Two goals in the last ten minutes.' },
    ],
  },
];

const t0 = Date.now();

for (const scenario of SCENARIOS) {
  console.log(`\n${'─'.repeat(72)}\n  ${scenario.name}`);
  console.log(`${'─'.repeat(72)}`);
  for (const turn of scenario.transcript) {
    const who = turn.speaker === 'me' ? 'HIM' : turn.speakerName || 'THEM';
    console.log(`  ${who.padEnd(5)} ${turn.text}`);
  }
  console.log();

  const marks = [];
  const result = await suggest({
    transcript: scenario.transcript,
    memory: scenario.memory,
    onIntent: (i) => marks.push(`tile "${i.label}"`),
    onWording: (w) => marks.push(`wordings[${w.index}]`),
  });

  for (const intent of result.intents) {
    console.log(`  ${intent.emoji}  ${intent.label}`);
    for (const v of intent.variants) {
      console.log(`        ${v.tone.padEnd(8)} "${v.text}"`);
    }
    if (!intent.variants.length) console.log('        (no wordings returned)');
  }
  console.log(
    `\n  first tile ${result.firstIntentMs}ms  ·  all 5 tiles ${result.allIntentsMs}ms  ` +
      `·  complete ${result.ms}ms  ·  stop=${result.stopReason}`
  );
}

console.log(`\n${'═'.repeat(72)}`);
console.log(`  ${ledger.calls} calls in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log(
  `  tokens: ${ledger.inputTokens} in / ${ledger.outputTokens} out / ` +
    `${ledger.cacheWriteTokens} cache-write / ${ledger.cacheReadTokens} cache-read`
);
console.log(`  cost:   $${ledger.costUsd.toFixed(4)}  (~$${(ledger.costUsd / ledger.calls).toFixed(4)}/turn)`);
console.log(`${'═'.repeat(72)}\n`);

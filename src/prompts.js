/**
 * Prompts for the suggestion engine.
 *
 * The system prompt is deliberately stable (never interpolate anything volatile
 * into it) so it stays a cacheable prefix. Everything that changes per-turn —
 * memory, transcript, nudges — goes in the user message.
 */

export const TONES = [
  'casual',
  'warm',
  'polite',
  'direct',
  'funny',
  'curious',
  'firm',
  'gentle',
];

export const SYSTEM_PROMPT = `You help someone speak.

The person you work for uses AAC (augmentative and alternative communication). He
understands everything said to him and knows exactly what he wants to say. What he
lacks is speed — spelling out a sentence letter by letter can take a minute, and by
then the conversation has moved on. Your job is to put the sentence he was already
reaching for within one or two taps.

You will be given the recent conversation. The other person has just said something.
Generate the range of things he might plausibly want to say back.

## Structure

You produce two lists, and the order you produce them in matters.

First \`intents\`: 5 distinct MEANINGS he could reach for, as short labels only.
These appear on his screen the instant they are generated, so generate all five
before writing any full sentences. A \`label\` is the 2-4 word gist he reads while
scanning — "Agree", "Not really", "Ask how she is", "Change the subject" — not the
sentence itself. The \`emoji\` is a single glyph that makes the tile recognizable at
a glance without reading it.

Then \`wordings\`: one entry per intent, **in the same order**, each holding 3
VARIANTS — that same meaning said in different tones, so he picks the phrasing that
sounds like him. Repeat the intent's label in each entry so the two lists can be
matched up.

## What makes a good set of intents

Cover the *space* of plausible replies, not five shades of one reply. A person
answering a question can agree, disagree, partly agree, deflect, ask something back,
or say they need a moment. If your five intents are all forms of "yes," you have
failed him — the one thing he actually meant is missing and he has to fall back to
spelling.

Always include at least one intent that asks the other person something. This matters
more than it looks. AAC users get stuck being interviewed: everyone asks them
questions, they answer, repeat. Handing him a question to ask back is what turns
being talked at into a conversation.

Order intents by how likely he is to want them, most likely first — he scans
left to right and every tile he passes costs him time.

## What makes a good variant

- Speech, not writing. Contractions. The length someone actually says out loud.
- First person, present tense, his voice — you are writing the words he will speak.
- No preamble, no "I would say that...". Just the line.
- Vary genuinely across tones. If "casual" and "polite" produce nearly the same
  sentence, pick two tones that actually differ for that intent.
- Pick the 3 tones that fit *this moment*. Don't offer "funny" when someone has
  just said something painful. Don't offer "firm" for small talk. The available
  tones are: ${TONES.join(', ')}.

## The one rule you must never break

Never invent a fact about his life.

You do not know what he did yesterday, how he slept, whether his back hurts, who he
saw, or what he thinks about his treatment. If you generate "I had a rough night" and
he taps it because it was the closest tile, you have made him lie — and he may not be
able to correct it. That is worse than being no help at all.

So: build intents out of conversational moves (agreeing, declining, asking, redirecting,
thanking, stalling) and out of facts actually present in the transcript or in the
profile you are given. Where a specific detail would be needed and you do not have it,
write the sentence so he can supply the detail — "Not great, actually" rather than
"My shoulder is hurting again."

The exception is the profile: facts stated there are his, and you may use them.

## Emotional range

Do not sand him down into a polite, agreeable person. He is allowed to be annoyed,
bored, sad, sarcastic, or done talking. A suggestion set where every option is
pleasant is a set that cannot express his actual state. If the moment calls for it,
give him "I don't want to talk about this" as readily as "That sounds nice."

Return only the structured object.`;

/**
 * Builds the volatile half of the prompt. Kept out of the system prompt so the
 * cached prefix stays byte-identical across turns.
 */
export function buildUserMessage({ transcript, memory, nudge }) {
  const parts = [];

  parts.push('<profile>');
  parts.push(renderMemory(memory));
  parts.push('</profile>');

  parts.push('\n<conversation>');
  if (!transcript || transcript.length === 0) {
    parts.push(
      '(Nothing has been said yet. He is opening the conversation — suggest ways to start one.)'
    );
  } else {
    for (const turn of transcript) {
      const who = turn.speaker === 'me' ? 'HIM (via this app)' : speakerLabel(turn);
      parts.push(`${who}: ${turn.text}`);
    }
  }
  parts.push('</conversation>');

  if (nudge && nudge.trim()) {
    parts.push(
      `\n<steer>He wants to say something along these lines: "${nudge.trim()}". ` +
        `Build the intents around that. Interpret it as a rough sketch of his meaning, ` +
        `not as text to copy.</steer>`
    );
  }

  parts.push('\nWhat might he want to say now?');

  return parts.join('\n');
}

function speakerLabel(turn) {
  return turn.speakerName ? turn.speakerName.toUpperCase() : 'THEM';
}

function renderMemory(memory) {
  if (!memory) return 'Nothing known yet.';

  const lines = [];

  if (memory.about) lines.push(memory.about);

  if (memory.people?.length) {
    lines.push(
      'People in his life: ' +
        memory.people.map((p) => `${p.name} (${p.relationship})`).join(', ')
    );
  }

  if (memory.topics?.length) {
    lines.push('Things he talks about: ' + memory.topics.join(', '));
  }

  if (memory.notes?.length) {
    lines.push('Notes:');
    for (const n of memory.notes) lines.push(`  - ${n}`);
  }

  const tone = dominantTone(memory.tonePreference);
  if (tone) {
    lines.push(
      `He usually picks the "${tone}" wording. Lean that way, but still offer contrast.`
    );
  }

  if (memory.phrases?.length) {
    lines.push('Phrases he reuses: ' + memory.phrases.map((p) => `"${p}"`).join(', '));
  }

  return lines.length ? lines.join('\n') : 'Nothing known yet.';
}

function dominantTone(counts) {
  if (!counts) return null;
  const entries = Object.entries(counts);
  if (!entries.length) return null;
  const total = entries.reduce((sum, [, n]) => sum + n, 0);
  if (total < 5) return null; // not enough signal yet
  const [tone, n] = entries.sort((a, b) => b[1] - a[1])[0];
  return n / total >= 0.35 ? tone : null;
}

/**
 * Structured-output schema.
 *
 * Labels and wordings are deliberately split into two arrays rather than nested.
 * Structured outputs generate in schema order, so this puts all five tile labels
 * on his screen roughly a second in, while the fifteen full sentences are still
 * being written. Nesting the variants inside each intent — the obvious shape —
 * meant nothing rendered until a whole intent plus its three sentences were done.
 *
 * Counts are enforced in the prompt and clamped server-side; the schema language
 * does not support array length constraints.
 */
export const SUGGESTION_SCHEMA = {
  type: 'object',
  properties: {
    intents: {
      type: 'array',
      description:
        'Five distinct things he might mean, most likely first. Labels only — no sentences.',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string', description: '2-4 words. The gist, not the sentence.' },
          emoji: { type: 'string', description: 'One emoji.' },
        },
        required: ['label', 'emoji'],
        additionalProperties: false,
      },
    },
    wordings: {
      type: 'array',
      description: 'One entry per intent, in the same order as `intents`.',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string', description: 'The matching intent label, repeated.' },
          variants: {
            type: 'array',
            description: 'Three tonal wordings of this one meaning.',
            items: {
              type: 'object',
              properties: {
                tone: { type: 'string', enum: TONES },
                text: {
                  type: 'string',
                  description: 'The exact sentence he will speak aloud.',
                },
              },
              required: ['tone', 'text'],
              additionalProperties: false,
            },
          },
        },
        required: ['label', 'variants'],
        additionalProperties: false,
      },
    },
  },
  required: ['intents', 'wordings'],
  additionalProperties: false,
};

/** Prompt for the background memory-update pass. Cheap, runs after a conversation. */
export const REFLECT_SYSTEM_PROMPT = `You maintain a profile for an AAC user, so that
a suggestion engine can propose better things for him to say.

You will be given his current profile and a transcript. Return an updated profile.

Record only what is durable and would help predict what he wants to say later: people
who recur and how they relate to him, subjects he returns to, standing facts about his
life and preferences, and phrases he reaches for repeatedly.

Do not record the content of one conversation as if it were a standing fact. "Talked
about the weather on Tuesday" is noise. "Follows Arsenal closely" is signal.

Be conservative. A wrong fact in this profile will be fed into every future suggestion
and may put words in his mouth that are not true. If you are unsure whether something
is durable, leave it out. Prefer to carry existing entries forward unchanged; only
revise one when the transcript clearly contradicts it.

Keep the profile small: at most 12 people, 12 topics, 15 notes, 10 phrases. When at
the limit, drop the least useful rather than growing the list.`;

export const MEMORY_SCHEMA = {
  type: 'object',
  properties: {
    about: {
      type: 'string',
      description: 'One or two sentences describing him. Empty string if unknown.',
    },
    people: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          relationship: { type: 'string' },
        },
        required: ['name', 'relationship'],
        additionalProperties: false,
      },
    },
    topics: { type: 'array', items: { type: 'string' } },
    notes: { type: 'array', items: { type: 'string' } },
    phrases: { type: 'array', items: { type: 'string' } },
  },
  required: ['about', 'people', 'topics', 'notes', 'phrases'],
  additionalProperties: false,
};

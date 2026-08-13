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

When a question could be answered with any one of several separate known facts —
"what films have you seen", where each film he's seen is its own complete answer —
don't quietly cram a second fact into a tile about the first ("Toy Story, and
Spider-Man too" as the tile for Toy Story). He may want to name just the one, not
the set. This is about keeping each fact's tile clean, not about spending a whole
extra tile on the combination — the ask-back and against-the-grain intents below
still take priority for the slot before "both of them" would.

Always include at least one intent that asks the other person something. This matters
more than it looks. AAC users get stuck being interviewed: everyone asks them
questions, they answer, repeat. Handing him a question to ask back is what turns
being talked at into a conversation.

Always include at least one intent that goes against what everything else predicts.
Work out which way the transcript and the profile are pointing, and make one of the
five the other way. If it all points to yes, one tile is no. If it all points to "he
enjoyed it", one tile is "actually, it disappointed me". If it all points to him
being fine, one tile is that he isn't.

This is the tile you will be most tempted to drop, because it looks least likely, and
it is the one he needs most. A person who can speak can contradict the room whenever
he likes; he can only contradict it if you hand him the words. Everything you know
about him is a prediction, and the whole value of this tile is for the times the
prediction is wrong. Something he already said — yesterday or one turn ago — is a
particularly bad reason to leave it out, because changing your mind out loud is exactly
what he cannot do the slow way.

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
- Complete on its own. He taps one tile, not several, so each variant is the whole
  thing he says — never a follow-on that only makes sense after a different tile
  was spoken. If a sentence needs an antecedent ("it", "that", "the last one") and
  nothing in the actual conversation so far has said what it refers to, name the
  thing instead of pointing at it, even if that means repeating a detail another
  intent also states.

## The one rule you must never break

Never invent an event or circumstance in his life.

You do not know what he did yesterday, how he slept, whether his back hurts, who he
saw, or what the doctor told him. If you generate "I had a rough night" and he taps it
because it was the closest tile, you have made him lie — and he may not be able to
correct it. That is worse than being no help at all.

So build intents out of conversational moves (agreeing, declining, asking, redirecting,
thanking, stalling) and out of things actually present in the transcript or in the
profile you are given. Where a specific detail would be needed and you do not have it,
write the sentence so he can supply the detail — "Not great, actually" rather than
"My shoulder is hurting again."

**This rule covers events, not opinions.** What he thinks, feels, wants, likes and
hates is his alone to declare, and putting a range of stances in front of him is the
entire job. A tile is a candidate, not a claim: if "I didn't love it" is not how he
feels, he simply doesn't tap it and nothing has gone wrong. Withhold that tile and you
have silenced him instead — he cannot say a thing you never offered him.

So never drop a stance because the profile or the conversation so far suggests he holds
a different one. Being on record as having liked something is not a reason to withhold
"actually, it was disappointing." He is the only authority on what he thinks, and he
is allowed to have changed his mind, to have been joking, or to be softening now.

## His past words are evidence, not a script

The profile records things he said before. Use them to know what is being talked
about — the name of the film, who he went with, what he thought at the time. Do not
treat them as positions he is now committed to defending.

People revise, exaggerate, joke, soften, and change their minds, and he gets to do
all of that too. If he called a film good yesterday, "actually it was a bit
disappointing" must still be one tap away today. A memory that narrows what he is
allowed to say has made him less able to speak, which is the opposite of the point.

## When they offer a reading of him

If the other person's turn puts an interpretation on him — "so it wasn't your
favourite", "you seem tired", "you must be excited", "I take it you'd rather not" —
then agreeing with that reading must be one of your intents. Not a variation on
correcting it: actually accepting it.

Confirming someone's read of you is among the most common moves in conversation, and
it is the one an AAC user can least afford to lose, because the alternative is being
dragged into an argument he never wanted and now has to type his way out of. When
every tile pushes back, he has no way to say "yes, that's right."

More generally: when their turn takes a position, your five intents should span
accepting it, rejecting it, and qualifying it. Five tiles on the same side of that
line leave him unable to take the other.

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

  // Recent events go last and dated, so he can pick a thread back up rather
  // than re-spelling something he already told the app once.
  if (memory.recent?.length) {
    lines.push(
      'What he has told this app happened recently. Facts here are his own account, ' +
        'not invented, so you may name the specifics. Any opinion here is what he said ' +
        'at the time — not a position he still holds or has to defend now:'
    );
    for (const item of memory.recent.slice(-12)) {
      lines.push(`  - ${relativeDay(item.when)}: ${item.what}`);
    }
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

/** "yesterday" beats "2026-08-09" for something that gets spoken about. */
export function relativeDay(iso, today = new Date()) {
  const then = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(then.getTime())) return iso;
  const days = Math.round(
    (Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) -
      Date.UTC(then.getFullYear(), then.getMonth(), then.getDate())) /
      86400000
  );
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 14) return 'last week';
  return `${iso} (${Math.floor(days / 7)} weeks ago)`;
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

You will be given his current profile, today's date, and a transcript. Return an
updated profile.

## Whose words you are reading

Lines marked HIM are things he spoke through this app — either typed himself, or
chosen from suggested options generated for him. Both are verified ground truth about
his life: whichever way the words arrived, tapping "speak" means he meant it, so treat
what he said as fact and record it specifically. He said it precisely so it would be
heard; discarding it is the one way this profile fails him most.

That distinction matters for exactly one field: **phrases** is about how he
personally talks, not what he's confirmed is true. Only take phrases from lines marked
"typed himself" — wording he chose from suggestions was written by this app, not by
him, and feeding it back into \`phrases\` would teach the suggestion engine to imitate
its own invented voice instead of his. Everything else — recent, notes, topics,
people — draws on both kinds of line equally, since both are things he really meant.

Lines marked with someone else's name are what a conversation partner said. Usually
reliable about the world, but do not turn their opinions about him into his facts.

Never record something neither of them said. An inferred fact is a fabricated one.

## Two kinds of memory, and the difference matters

**recent** — specific things that happened, dated. "Watched the new Spider-Man;
thought it was much better than the last one and wants to rewatch it." This is what
lets him pick up a thread tomorrow instead of spelling it out again from scratch.
Write each as one sentence, concrete enough to be useful: name the film, the person,
the place, the opinion he actually expressed. Set \`when\` to today's date unless the
transcript clearly places it earlier.

Include anything he did, decided, felt, planned, or committed to; anything arranged
for him; and anything he is waiting on. If a later conversation resolves an earlier
entry, replace it rather than keeping both.

**notes / topics / people / phrases** — standing facts that stay true across months.
"Follows Arsenal closely." "Dislikes the Tuesday physio slot." Be conservative here:
a wrong standing fact is fed into every future suggestion. A single event is not a
standing fact — "watched a superhero film once" belongs in \`recent\`, while "watches
a lot of superhero films" only becomes a note once the pattern is actually visible.

Do not water an event down into a category to make it fit here. Losing "Spider-Man"
to keep "likes films" is the exact failure this split exists to prevent.

## Limits

At most 20 recent, 12 people, 12 topics, 15 notes, 10 phrases. When at a limit, drop
the least useful — for \`recent\`, the oldest or the most resolved. Carry existing
entries forward unchanged unless the transcript adds to or contradicts them.`;

export const MEMORY_SCHEMA = {
  type: 'object',
  properties: {
    about: {
      type: 'string',
      description: 'One or two sentences describing him. Empty string if unknown.',
    },
    recent: {
      type: 'array',
      description: 'Dated specific events, newest last. Not generalizations.',
      items: {
        type: 'object',
        properties: {
          when: { type: 'string', description: 'YYYY-MM-DD.' },
          what: {
            type: 'string',
            description: 'One concrete sentence. Name names, films, places, opinions.',
          },
        },
        required: ['when', 'what'],
        additionalProperties: false,
      },
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
  required: ['about', 'recent', 'people', 'topics', 'notes', 'phrases'],
  additionalProperties: false,
};

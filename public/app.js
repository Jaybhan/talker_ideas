/* Talker — client.
 *
 * Flow: the partner speaks → recognition transcribes → the server streams back
 * five intent tiles, then their wordings → he taps a meaning, then a tone → the
 * sentence is spoken aloud and appended to the transcript as his turn.
 */

const $ = (id) => document.getElementById(id);

const el = {
  mic: $('mic'),
  micLabel: $('mic-label'),
  status: $('status'),
  transcript: $('transcript'),
  transcriptEmpty: $('transcript-empty'),
  stageTitle: $('stage-title'),
  tiles: $('tiles'),
  back: $('back'),
  regen: $('regen'),
  toast: $('toast'),
  typeDialog: $('type-dialog'),
  typeInput: $('type-input'),
  nudgeDialog: $('nudge-dialog'),
  nudgeInput: $('nudge-input'),
  settingsDialog: $('settings-dialog'),
  voiceSelect: $('voice-select'),
  rate: $('rate'),
  rateOut: $('rate-out'),
  partner: $('partner'),
  autoSuggest: $('auto-suggest'),
  memoryJson: $('memory-json'),
  memoryNote: $('memory-note'),
};

const state = {
  listening: false,
  turns: [],
  intents: [],
  wordings: new Map(), // intent index -> variants
  stage: 'intents',
  chosenIntent: null,
  lastSpoken: null,
  streaming: false,
  settings: loadSettings(),
};

/* ── Settings ─────────────────────────────────────────────────────────── */

function loadSettings() {
  const defaults = { voiceURI: '', rate: 1, partner: 'Mom', autoSuggest: true };
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem('talker.settings') || '{}') };
  } catch {
    return defaults;
  }
}

function saveSettings() {
  localStorage.setItem('talker.settings', JSON.stringify(state.settings));
}

/* ── Speaking ─────────────────────────────────────────────────────────── */

let voices = [];

function refreshVoices() {
  voices = speechSynthesis.getVoices();
  if (!voices.length) return;

  el.voiceSelect.innerHTML = '';
  for (const v of voices) {
    const opt = document.createElement('option');
    opt.value = v.voiceURI;
    opt.textContent = `${v.name} — ${v.lang}`;
    el.voiceSelect.append(opt);
  }
  // Prefer a saved choice, else a natural-sounding local English voice.
  const preferred =
    voices.find((v) => v.voiceURI === state.settings.voiceURI) ||
    voices.find((v) => v.lang.startsWith('en') && /natural|premium|enhanced/i.test(v.name)) ||
    voices.find((v) => v.lang.startsWith('en') && v.localService) ||
    voices.find((v) => v.lang.startsWith('en'));
  if (preferred) {
    el.voiceSelect.value = preferred.voiceURI;
    state.settings.voiceURI = preferred.voiceURI;
  }
}

speechSynthesis.addEventListener('voiceschanged', refreshVoices);
refreshVoices();

/**
 * Speak a line and record it as his turn.
 *
 * Recognition is suspended for the duration — otherwise the microphone hears
 * the synthesized voice and files it as something the partner said, which
 * poisons the next round of suggestions.
 */
function say(text, { tone, source = 'tile' } = {}) {
  if (!text) return;

  const wasListening = state.listening;
  if (wasListening) stopListening({ silent: true });

  const speakNow = () => {
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = Number(state.settings.rate) || 1;
    const voice = voices.find((v) => v.voiceURI === state.settings.voiceURI);
    if (voice) utter.voice = voice;

    const resume = () => {
      if (wasListening && !state.listening) startListening({ silent: true });
    };
    utter.addEventListener('end', resume);
    utter.addEventListener('error', resume);
    speechSynthesis.speak(utter);
  };

  // Chrome silently drops an utterance started in the same tick as cancel(),
  // or while a just-stopped recognition session is still tearing down its own
  // audio stream. Only cancel when something's actually playing, and give the
  // engine a beat to flush before speaking again.
  if (speechSynthesis.speaking || speechSynthesis.pending) {
    speechSynthesis.cancel();
    setTimeout(speakNow, 50);
  } else if (wasListening) {
    setTimeout(speakNow, 50);
  } else {
    speakNow();
  }

  state.lastSpoken = text;
  addTurn({ speaker: 'me', text, source });
  if (tone) fetch('/api/spoke', jsonPost({ tone })).catch(() => {});
}

/* ── Transcript ───────────────────────────────────────────────────────── */

function addTurn(turn) {
  state.turns.push(turn);
  el.transcriptEmpty?.remove();

  const node = document.createElement('div');
  node.className = turn.speaker === 'me' ? 'turn turn-me' : 'turn turn-them';
  const who = document.createElement('span');
  who.className = 'who';
  who.textContent = turn.speaker === 'me' ? 'You' : turn.speakerName || 'Them';
  const body = document.createElement('span');
  body.textContent = turn.text;
  node.append(who, body);

  // Speech recognition mishears, and a wrong turn doesn't just sit there — it
  // is fed into every following suggestion. Let it be dropped.
  if (turn.speaker !== 'me') {
    const drop = document.createElement('button');
    drop.className = 'turn-drop';
    drop.textContent = '×';
    drop.title = 'Misheard — remove this';
    drop.setAttribute('aria-label', `Remove misheard line: ${turn.text}`);
    drop.addEventListener('click', () => {
      const at = state.turns.indexOf(turn);
      if (at !== -1) state.turns.splice(at, 1);
      node.remove();
      if (!state.turns.length) renderMessage('Press Space to start listening, or use ⌨ Type it.');
      toast('Removed');
    });
    node.append(drop);
  }

  document.querySelector('.turn-interim')?.remove();
  el.transcript.append(node);
  el.transcript.scrollTop = el.transcript.scrollHeight;
  scheduleReflect();
}

function showInterim(text) {
  let node = document.querySelector('.turn-interim');
  if (!text) return node?.remove();
  if (!node) {
    node = document.createElement('div');
    node.className = 'turn turn-interim';
    el.transcript.append(node);
  }
  node.textContent = text;
  el.transcript.scrollTop = el.transcript.scrollHeight;
}

/* ── Listening ────────────────────────────────────────────────────────── */

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let settleTimer = null;
let wantListening = false;

function buildRecognition() {
  const rec = new SpeechRecognition();
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = 'en-US';

  rec.addEventListener('result', (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const text = result[0].transcript.trim();
      if (!text) continue;
      if (result.isFinal) {
        addTurn({ speaker: 'them', speakerName: state.settings.partner || 'Them', text });
        // Wait a beat before asking — people pause mid-thought, and firing on
        // the first final result would suggest against half a sentence.
        clearTimeout(settleTimer);
        if (state.settings.autoSuggest) settleTimer = setTimeout(() => requestSuggestions(), 700);
      } else {
        interim += text + ' ';
      }
    }
    showInterim(interim.trim());
  });

  rec.addEventListener('error', (event) => {
    if (event.error === 'no-speech' || event.error === 'aborted') return;
    if (event.error === 'not-allowed') {
      wantListening = false;
      setStatus('Microphone blocked — allow access, or use ⌨ Type it.', 'error');
      setMicUI(false);
      return;
    }
    setStatus(`Mic error: ${event.error}`, 'error');
  });

  // Chrome ends continuous recognition on its own every so often; restart it.
  rec.addEventListener('end', () => {
    if (wantListening) {
      try {
        rec.start();
      } catch {
        /* already starting */
      }
    } else {
      setMicUI(false);
    }
  });

  return rec;
}

function startListening({ silent = false } = {}) {
  if (!SpeechRecognition) {
    setStatus('This browser has no speech recognition — try Chrome.', 'error');
    return;
  }
  recognition ??= buildRecognition();
  wantListening = true;
  try {
    recognition.start();
  } catch {
    /* already running */
  }
  setMicUI(true);
  if (!silent) setStatus('Listening…');
}

function stopListening({ silent = false } = {}) {
  wantListening = false;
  clearTimeout(settleTimer);
  showInterim('');
  try {
    recognition?.stop();
  } catch {
    /* not running */
  }
  setMicUI(false);
  if (!silent) setStatus('');
}

function setMicUI(on) {
  state.listening = on;
  el.mic.setAttribute('aria-pressed', String(on));
  el.micLabel.textContent = on ? 'Listening' : 'Start listening';
}

function toggleListening() {
  state.listening ? stopListening() : startListening();
}

/* ── Suggestions ──────────────────────────────────────────────────────── */

let inFlight = null;

async function requestSuggestions({ nudge = '' } = {}) {
  inFlight?.abort();
  const controller = (inFlight = new AbortController());

  state.intents = [];
  state.wordings.clear();
  state.chosenIntent = null;
  state.stage = 'intents';
  state.streaming = true;
  renderSkeleton();
  setStatus('Thinking…');

  try {
    const res = await fetch(
      '/api/suggest',
      jsonPost({ transcript: state.turns, nudge }, controller.signal)
    );
    if (!res.ok) throw new Error(`server ${res.status}`);

    for await (const { event, data } of readEvents(res.body)) {
      if (event === 'intent') {
        state.intents.push(data);
        renderIntents();
      } else if (event === 'wording') {
        state.wordings.set(data.index, data.variants);
        if (state.stage === 'intents') renderIntents();
        else if (state.chosenIntent === data.index) renderVariants();
      } else if (event === 'error') {
        throw new Error(data.message);
      } else if (event === 'done') {
        setStatus(data.count ? `Ready · ${(data.firstIntentMs / 1000).toFixed(1)}s` : '');
      }
    }

    if (!state.intents.length) renderMessage('No suggestions came back. Try ⌨ Type it.');
  } catch (err) {
    if (err.name === 'AbortError') return;
    console.error(err);
    setStatus(err.message || 'Suggestion failed', 'error');
    renderMessage('Couldn’t reach the suggestion engine. Quick phrases and ⌨ Type it still work.');
  } finally {
    if (inFlight === controller) {
      inFlight = null;
      state.streaming = false;
    }
  }
}

/** Parse a text/event-stream body into {event, data} objects. */
async function* readEvents(body) {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;

    let split;
    while ((split = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);

      let event = 'message';
      const dataLines = [];
      for (const line of frame.split('\n')) {
        if (line.startsWith('event: ')) event = line.slice(7).trim();
        else if (line.startsWith('data: ')) dataLines.push(line.slice(6));
      }
      if (!dataLines.length) continue;
      try {
        yield { event, data: JSON.parse(dataLines.join('\n')) };
      } catch {
        /* ignore malformed frame */
      }
    }
  }
}

/* ── Rendering ────────────────────────────────────────────────────────── */

function renderSkeleton() {
  el.back.hidden = true;
  el.stageTitle.textContent = 'What do you want to say?';
  el.tiles.replaceChildren(
    ...Array.from({ length: 5 }, () => {
      const s = document.createElement('div');
      s.className = 'skeleton';
      return s;
    })
  );
}

function renderMessage(text) {
  el.back.hidden = true;
  const p = document.createElement('p');
  p.className = 'stage-msg';
  p.textContent = text;
  el.tiles.replaceChildren(p);
}

function renderIntents() {
  state.stage = 'intents';
  el.back.hidden = true;
  el.stageTitle.textContent = 'What do you want to say?';

  const nodes = state.intents.map((intent, i) => {
    const variants = state.wordings.get(intent.index);
    const btn = document.createElement('button');
    btn.className = 'tile';
    btn.disabled = !variants;
    btn.addEventListener('click', () => chooseIntent(intent.index));

    const emoji = document.createElement('span');
    emoji.className = 'tile-emoji';
    emoji.textContent = intent.emoji;

    const body = document.createElement('span');
    body.className = 'tile-body';
    const label = document.createElement('span');
    label.className = 'tile-label';
    label.textContent = intent.label;
    const preview = document.createElement('span');
    preview.className = 'tile-preview';
    preview.textContent = variants ? variants[0].text : 'finding the words…';
    body.append(label, preview);

    const key = document.createElement('span');
    key.className = 'tile-key';
    key.textContent = i + 1;

    btn.append(emoji, body, key);
    return btn;
  });

  // Hold the row height steady while the rest stream in, so tiles never jump
  // out from under a finger already moving toward one.
  while (state.streaming && nodes.length < 5) {
    const s = document.createElement('div');
    s.className = 'skeleton';
    nodes.push(s);
  }

  el.tiles.replaceChildren(...nodes);
}

function chooseIntent(index) {
  const variants = state.wordings.get(index);
  if (!variants) return;
  state.chosenIntent = index;
  renderVariants();
}

function renderVariants() {
  state.stage = 'variants';
  const intent = state.intents.find((i) => i.index === state.chosenIntent);
  const variants = state.wordings.get(state.chosenIntent) || [];

  el.back.hidden = false;
  el.stageTitle.textContent = `${intent.emoji} ${intent.label} — how do you want to say it?`;

  el.tiles.replaceChildren(
    ...variants.map((variant, i) => {
      const btn = document.createElement('button');
      btn.className = 'tile tile-variant';
      btn.style.setProperty('--tone', `var(--tone-${variant.tone})`);
      btn.addEventListener('click', () => {
        say(variant.text, { tone: variant.tone });
        renderIntents();
      });

      const tag = document.createElement('span');
      tag.className = 'tone-tag';
      tag.textContent = variant.tone;

      const text = document.createElement('span');
      text.className = 'variant-text';
      text.textContent = variant.text;

      const key = document.createElement('span');
      key.className = 'tile-key';
      key.textContent = i + 1;

      btn.append(tag, text, key);
      return btn;
    })
  );
}

function goBack() {
  if (state.stage !== 'variants') return;
  state.chosenIntent = null;
  renderIntents();
}

/* ── Chrome ───────────────────────────────────────────────────────────── */

let statusTimer = null;
function setStatus(text, kind = '') {
  el.status.textContent = text;
  el.status.dataset.kind = kind;
  clearTimeout(statusTimer);
  if (text && !kind) statusTimer = setTimeout(() => (el.status.textContent = ''), 4000);
}

let toastTimer = null;
function toast(text) {
  el.toast.textContent = text;
  el.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove('show'), 2200);
}

function jsonPost(body, signal) {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  };
}

/* ── Wiring ───────────────────────────────────────────────────────────── */

el.mic.addEventListener('click', toggleListening);
el.back.addEventListener('click', goBack);
el.regen.addEventListener('click', () => {
  if (state.turns.length) requestSuggestions();
  else el.nudgeDialog.showModal();
});

for (const chip of document.querySelectorAll('.chip[data-say]')) {
  chip.addEventListener('click', () => say(chip.dataset.say, { source: 'chip' }));
}

$('repeat-last').addEventListener('click', () => {
  if (!state.lastSpoken) return toast('Nothing said yet');
  speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(state.lastSpoken);
  utter.rate = Number(state.settings.rate) || 1;
  const voice = voices.find((v) => v.voiceURI === state.settings.voiceURI);
  if (voice) utter.voice = voice;
  speechSynthesis.speak(utter);
});

$('open-nudge').addEventListener('click', () => {
  el.nudgeInput.value = '';
  el.nudgeDialog.showModal();
  el.nudgeInput.focus();
});

$('open-type').addEventListener('click', () => {
  el.typeInput.value = '';
  el.typeDialog.showModal();
  el.typeInput.focus();
});

$('type-form').addEventListener('submit', (event) => {
  if (event.submitter?.value !== 'speak') return;
  const text = el.typeInput.value.trim();
  if (text) say(text, { source: 'typed' });
});

// Enter speaks; Shift+Enter makes a new line.
el.typeInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    const text = el.typeInput.value.trim();
    if (text) say(text, { source: 'typed' });
    el.typeDialog.close();
  }
});

$('nudge-form').addEventListener('submit', (event) => {
  if (event.submitter?.value !== 'go') return;
  requestSuggestions({ nudge: el.nudgeInput.value });
  el.nudgeInput.value = '';
});

el.rate.addEventListener('input', () => {
  el.rateOut.textContent = Number(el.rate.value).toFixed(2).replace(/0$/, '');
});

$('open-settings').addEventListener('click', async () => {
  el.rate.value = state.settings.rate;
  el.rateOut.textContent = Number(state.settings.rate).toFixed(2).replace(/0$/, '');
  el.partner.value = state.settings.partner;
  el.autoSuggest.checked = state.settings.autoSuggest;
  if (state.settings.voiceURI) el.voiceSelect.value = state.settings.voiceURI;

  el.memoryJson.value = 'loading…';
  el.settingsDialog.showModal();
  try {
    const memory = await (await fetch('/api/memory')).json();
    el.memoryJson.value = JSON.stringify(memory, null, 2);
  } catch {
    el.memoryJson.value = '{}';
    el.memoryNote.textContent = 'Could not load the profile.';
  }
});

$('settings-form').addEventListener('submit', async (event) => {
  if (event.submitter?.value !== 'save') return;

  state.settings.rate = Number(el.rate.value);
  state.settings.voiceURI = el.voiceSelect.value;
  state.settings.partner = el.partner.value.trim() || 'Them';
  state.settings.autoSuggest = el.autoSuggest.checked;
  saveSettings();

  try {
    const parsed = JSON.parse(el.memoryJson.value);
    await fetch('/api/memory', { ...jsonPost(parsed), method: 'PUT' });
    toast('Saved');
  } catch {
    toast('Settings saved — profile JSON was invalid, not saved');
  }
});

/* Keyboard access. Number keys pick tiles; this is also the path a switch or
   an on-screen keyboard driver uses, so it must reach everything. */
document.addEventListener('keydown', (event) => {
  if (event.target.matches('input, textarea, select') || document.querySelector('dialog[open]'))
    return;

  if (event.code === 'Space') {
    event.preventDefault();
    return toggleListening();
  }
  if (event.key === 'Escape' || event.key === 'Backspace') {
    event.preventDefault();
    return goBack();
  }
  if (event.key === 'r' && state.turns.length) return requestSuggestions();

  const n = Number(event.key);
  if (!Number.isInteger(n) || n < 1 || n > 9) return;
  event.preventDefault();

  if (state.stage === 'intents') {
    const intent = state.intents[n - 1];
    if (intent) chooseIntent(intent.index);
  } else {
    const variant = (state.wordings.get(state.chosenIntent) || [])[n - 1];
    if (variant) {
      say(variant.text, { tone: variant.tone });
      renderIntents();
    }
  }
});

/* Update the stored profile so the next conversation starts better informed.
 *
 * This runs on a lull rather than only on page close: an AAC tablet is left open
 * all day, and `beforeunload` is unreliable exactly when it matters — a sleeping
 * device or a discarded tab would silently lose everything he said. Reflecting
 * mid-session also means the memory is current if the app is reopened later the
 * same day. Only new turns are sent, so a long conversation doesn't get
 * reprocessed from the top each time. */
const LULL_MS = 90_000;
let reflectTimer = null;
let reflectedUpTo = 0;
let reflecting = false;

async function reflectNow() {
  if (reflecting || state.turns.length - reflectedUpTo < 4) return;
  reflecting = true;
  const upTo = state.turns.length;
  try {
    await fetch('/api/reflect', jsonPost({ transcript: state.turns.slice(reflectedUpTo, upTo) }));
    reflectedUpTo = upTo;
  } catch {
    /* try again on the next lull */
  } finally {
    reflecting = false;
  }
}

function scheduleReflect() {
  clearTimeout(reflectTimer);
  reflectTimer = setTimeout(reflectNow, LULL_MS);
}

// Also catch the page actually going away, for anything since the last lull.
addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'hidden') return;
  if (state.turns.length - reflectedUpTo < 4) return;
  navigator.sendBeacon?.(
    '/api/reflect',
    new Blob([JSON.stringify({ transcript: state.turns.slice(reflectedUpTo) })], { type: 'application/json' })
  );
  reflectedUpTo = state.turns.length;
});

/* Debug surface. Lets the UI test drive a conversation without a microphone,
   and lets you rehearse a scenario from the console before a real session. */
window.talker = {
  state,
  say,
  requestSuggestions,
  hear(text, speakerName = state.settings.partner || 'Them') {
    addTurn({ speaker: 'them', speakerName, text });
    return requestSuggestions();
  },
};

renderMessage('Press Space to start listening, or use ⌨ Type it.');
if (!SpeechRecognition) {
  setStatus('No speech recognition in this browser — Chrome works best.', 'error');
}

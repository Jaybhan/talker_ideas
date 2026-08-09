import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ArrayItemScanner } from '../src/stream-json.js';

/** Feed a payload one character at a time — the worst case for a chunk parser. */
function drip(payload, key = 'intents') {
  const scanner = new ArrayItemScanner(key);
  const out = [];
  for (const ch of payload) out.push(...scanner.push(ch));
  return out;
}

test('emits each object as it completes, in order', () => {
  const payload = JSON.stringify({
    intents: [
      { label: 'Agree', variants: [{ tone: 'casual', text: 'Yeah.' }] },
      { label: 'Disagree', variants: [{ tone: 'direct', text: 'No.' }] },
    ],
  });
  const items = drip(payload);
  assert.equal(items.length, 2);
  assert.equal(items[0].label, 'Agree');
  assert.equal(items[1].label, 'Disagree');
});

test('emits an object before the rest of the array has arrived', () => {
  const scanner = new ArrayItemScanner('intents');
  const first = scanner.push('{"intents":[{"label":"Agree","emoji":"👍"}');
  assert.equal(first.length, 1, 'closing brace of item 1 should be enough');
  assert.equal(first[0].label, 'Agree');
  assert.deepEqual(scanner.push(',{"label":"Later"'), [], 'partial item yields nothing');
  assert.equal(scanner.push('}]}').length, 1);
});

test('braces and brackets inside strings do not split objects', () => {
  const payload = JSON.stringify({
    intents: [{ label: 'Odd', text: 'a { b } c [ d ] e' }],
  });
  const items = drip(payload);
  assert.equal(items.length, 1);
  assert.equal(items[0].text, 'a { b } c [ d ] e');
});

test('escaped quotes inside strings are handled', () => {
  const payload = JSON.stringify({
    intents: [{ label: 'Quote', text: 'She said "no way" to me' }],
  });
  const items = drip(payload);
  assert.equal(items.length, 1);
  assert.equal(items[0].text, 'She said "no way" to me');
});

test('nested objects emit once, at the outer close', () => {
  const payload = JSON.stringify({
    intents: [{ label: 'A', variants: [{ tone: 'warm', text: 'Hi' }] }],
  });
  const items = drip(payload);
  assert.equal(items.length, 1);
  assert.equal(items[0].variants[0].text, 'Hi');
});

test('ignores objects that appear before the target array', () => {
  const payload = '{"meta":{"v":1},"intents":[{"label":"Real"}]}';
  const items = drip(payload);
  assert.equal(items.length, 1);
  assert.equal(items[0].label, 'Real');
});

test('stops at the end of the array', () => {
  const payload = '{"intents":[{"label":"A"}],"trailing":{"label":"ignored"}}';
  const items = drip(payload);
  assert.equal(items.length, 1);
  assert.equal(items[0].label, 'A');
});

test('empty array yields nothing and does not throw', () => {
  assert.deepEqual(drip('{"intents":[]}'), []);
});

test('truncated stream yields only completed objects', () => {
  const items = drip('{"intents":[{"label":"Done"},{"label":"Cut off"');
  assert.equal(items.length, 1);
  assert.equal(items[0].label, 'Done');
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_MOODS, isStoredMood } from '../src/studio/config';

test('valid saved moods, including the plain fabric, survive validation', () => {
  for (const mood of DEFAULT_MOODS) assert.ok(isStoredMood(mood), mood.id);
  const plain = structuredClone(DEFAULT_MOODS[0]); plain.material.preset = 4;
  assert.ok(isStoredMood(plain));
});
test('empty, missing, nonfinite and out-of-range saved settings are rejected', () => {
  for (const field of ['wind', 'material', 'lighting', 'background']) {
    const mood = { ...DEFAULT_MOODS[0], [field]: {} };
    assert.equal(isStoredMood(mood), false);
  }
  for (const invalid of [NaN, Infinity, -1, 1000, undefined, '4']) {
    const mood = { ...DEFAULT_MOODS[0], wind: { ...DEFAULT_MOODS[0].wind, strength: invalid } };
    assert.equal(isStoredMood(mood), false);
  }
  assert.equal(isStoredMood({ ...DEFAULT_MOODS[0], accent: 'red' }), false);
});

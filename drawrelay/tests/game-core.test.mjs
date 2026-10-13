import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeGuess,
  classifyGuess,
  calculateGuessScore,
  pickNextDrawer,
  dedupeWords,
  makeEnvelope,
  validateEnvelope,
  canTransition,
  STATES,
  normalizeRoomCode,
  sanitizeNickname,
} from '../game-core.js';

test('normalizes case, accents, punctuation, and whitespace', () => {
  assert.equal(normalizeGuess('  Crème—BRÛLÉE!! '), 'creme brulee');
});

test('matches exact normalized answers', () => {
  assert.equal(classifyGuess('Cafe', 'Café'), 'correct');
  assert.equal(classifyGuess('space-telescope', 'Space telescope'), 'correct');
});

test('uses conservative near-match thresholds', () => {
  assert.equal(classifyGuess('elephent', 'elephant'), 'near');
  assert.equal(classifyGuess('cat', 'car'), 'wrong');
});

test('scoring rewards faster and earlier guesses', () => {
  const fast = calculateGuessScore({ remainingSeconds: 55, roundSeconds: 60, correctOrder: 0 });
  const slow = calculateGuessScore({ remainingSeconds: 5, roundSeconds: 60, correctOrder: 2 });
  assert.ok(fast > slow);
  assert.ok(slow >= 50);
});

test('drawer rotation avoids immediate repeat', () => {
  const players = [
    { id: 'a', connected: true, spectator: false },
    { id: 'b', connected: true, spectator: false },
  ];
  assert.equal(pickNextDrawer(players, 'a'), 'b');
  assert.equal(pickNextDrawer(players, null, 'a'), 'a');
});

test('deduplicates and sanitizes words', () => {
  assert.deepEqual(dedupeWords([' Café ', 'cafe', '', '<cat>', 'Cat']), ['Café', 'cat']);
});

test('validates versioned protocol envelopes', () => {
  assert.equal(validateEnvelope(makeEnvelope('PING', { t: 1 })).ok, true);
  assert.equal(validateEnvelope({ v: 999, type: 'PING', payload: {} }).ok, false);
  assert.equal(validateEnvelope({ v: 1, type: 'BAD', payload: {} }).ok, false);
});

test('enforces state transition table', () => {
  assert.equal(canTransition(STATES.LOBBY, STATES.ROUND_PREPARING), true);
  assert.equal(canTransition(STATES.HOME, STATES.GAME_RESULTS), false);
});

test('sanitizes room codes and nicknames', () => {
  assert.equal(normalizeRoomCode('ab-io-12345'), 'AB2345');
  assert.equal(sanitizeNickname('  <Emmanuel>   Test  '), 'Emmanuel Test');
});

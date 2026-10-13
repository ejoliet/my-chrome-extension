export const PROTOCOL_VERSION = 1;
export const ROOM_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export const MAX_PLAYERS = 12;
export const MAX_MESSAGE_BYTES = 64 * 1024;

export const STATES = Object.freeze({
  HOME: 'HOME',
  CREATING_ROOM: 'CREATING_ROOM',
  JOINING_ROOM: 'JOINING_ROOM',
  LOBBY: 'LOBBY',
  ROUND_PREPARING: 'ROUND_PREPARING',
  ROUND_ACTIVE: 'ROUND_ACTIVE',
  ROUND_RESULTS: 'ROUND_RESULTS',
  GAME_RESULTS: 'GAME_RESULTS',
  CONNECTION_LOST: 'CONNECTION_LOST',
  FATAL_ERROR: 'FATAL_ERROR',
});

export const MESSAGE_TYPES = Object.freeze({
  HELLO: 'HELLO',
  WELCOME: 'WELCOME',
  ERROR: 'ERROR',
  SNAPSHOT: 'SNAPSHOT',
  PLAYER_UPDATE: 'PLAYER_UPDATE',
  SETTINGS_UPDATE: 'SETTINGS_UPDATE',
  START_GAME: 'START_GAME',
  WORD_OPTIONS: 'WORD_OPTIONS',
  WORD_CHOICE: 'WORD_CHOICE',
  ROUND_START: 'ROUND_START',
  ROUND_TICK: 'ROUND_TICK',
  ROUND_PAUSE: 'ROUND_PAUSE',
  ROUND_RESUME: 'ROUND_RESUME',
  ROUND_END: 'ROUND_END',
  NEXT_ROUND: 'NEXT_ROUND',
  GAME_END: 'GAME_END',
  REMATCH: 'REMATCH',
  GUESS: 'GUESS',
  GUESS_EVENT: 'GUESS_EVENT',
  DRAW_START: 'DRAW_START',
  DRAW_POINTS: 'DRAW_POINTS',
  DRAW_END: 'DRAW_END',
  DRAW_UNDO: 'DRAW_UNDO',
  DRAW_CLEAR: 'DRAW_CLEAR',
  PING: 'PING',
  PONG: 'PONG',
});

const allowedTypes = new Set(Object.values(MESSAGE_TYPES));

export function randomId(length = 16) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ROOM_ALPHABET[b % ROOM_ALPHABET.length]).join('');
}

export function createRoomCode(length = 8) {
  return randomId(length);
}

export function normalizeRoomCode(value) {
  return String(value || '').toUpperCase().replace(/[^2-9A-HJ-NP-Z]/g, '').slice(0, 8);
}

export function sanitizeNickname(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[<>\u0000-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 24);
}

export function normalizeGuess(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function levenshtein(a, b) {
  const x = normalizeGuess(a);
  const y = normalizeGuess(b);
  if (x === y) return 0;
  if (!x.length) return y.length;
  if (!y.length) return x.length;
  const prev = Array.from({ length: y.length + 1 }, (_, i) => i);
  const curr = new Array(y.length + 1);
  for (let i = 1; i <= x.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= y.length; j += 1) {
      const cost = x[i - 1] === y[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= y.length; j += 1) prev[j] = curr[j];
  }
  return prev[y.length];
}

export function classifyGuess(guess, answer) {
  const normalizedGuess = normalizeGuess(guess);
  const normalizedAnswer = normalizeGuess(answer);
  if (!normalizedGuess) return 'empty';
  if (normalizedGuess === normalizedAnswer) return 'correct';
  if (normalizedAnswer.length >= 5) {
    const distance = levenshtein(normalizedGuess, normalizedAnswer);
    const threshold = normalizedAnswer.length >= 9 ? 2 : 1;
    if (distance <= threshold) return 'near';
  }
  return 'wrong';
}

export function calculateGuessScore({ remainingSeconds, roundSeconds, correctOrder }) {
  const safeRound = Math.max(1, Number(roundSeconds) || 60);
  const remaining = Math.max(0, Math.min(safeRound, Number(remainingSeconds) || 0));
  const order = Math.max(0, Number(correctOrder) || 0);
  const speed = Math.round((remaining / safeRound) * 120);
  return Math.max(50, 100 + speed - order * 12);
}

export function pickNextDrawer(players, previousDrawerId = null, preferredId = null) {
  const eligible = players.filter((p) => p.connected && !p.spectator);
  if (!eligible.length) return null;
  if (preferredId) {
    const preferred = eligible.find((p) => p.id === preferredId);
    if (preferred) return preferred.id;
  }
  const withoutPrevious = eligible.filter((p) => p.id !== previousDrawerId);
  const pool = withoutPrevious.length ? withoutPrevious : eligible;
  return pool[Math.floor(Math.random() * pool.length)].id;
}

export function dedupeWords(words, maxWords = 500) {
  const seen = new Set();
  const result = [];
  for (const raw of words || []) {
    const word = String(raw || '').normalize('NFKC').replace(/[<>\u0000-\u001F\u007F]/g, '').trim().replace(/\s+/g, ' ').slice(0, 60);
    const key = normalizeGuess(word);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(word);
    if (result.length >= maxWords) break;
  }
  return result;
}

export function chooseWords(words, count = 3, excluded = new Set()) {
  const pool = dedupeWords(words).filter((word) => !excluded.has(normalizeGuess(word)));
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

export function makeEnvelope(type, payload = {}) {
  return { v: PROTOCOL_VERSION, type, payload, ts: Date.now() };
}

export function serializedSize(value) {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).length;
  } catch {
    return Infinity;
  }
}

export function validateEnvelope(message) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return { ok: false, reason: 'Message must be an object.' };
  if (message.v !== PROTOCOL_VERSION) return { ok: false, reason: 'Unsupported protocol version.' };
  if (!allowedTypes.has(message.type)) return { ok: false, reason: 'Unknown message type.' };
  if (!message.payload || typeof message.payload !== 'object' || Array.isArray(message.payload)) return { ok: false, reason: 'Payload must be an object.' };
  if (serializedSize(message) > MAX_MESSAGE_BYTES) return { ok: false, reason: 'Message is too large.' };
  return { ok: true };
}

export function canTransition(from, to) {
  const allowed = {
    [STATES.HOME]: [STATES.CREATING_ROOM, STATES.JOINING_ROOM],
    [STATES.CREATING_ROOM]: [STATES.LOBBY, STATES.FATAL_ERROR],
    [STATES.JOINING_ROOM]: [STATES.LOBBY, STATES.CONNECTION_LOST, STATES.FATAL_ERROR],
    [STATES.LOBBY]: [STATES.ROUND_PREPARING, STATES.CONNECTION_LOST, STATES.FATAL_ERROR],
    [STATES.ROUND_PREPARING]: [STATES.ROUND_ACTIVE, STATES.CONNECTION_LOST, STATES.FATAL_ERROR],
    [STATES.ROUND_ACTIVE]: [STATES.ROUND_RESULTS, STATES.CONNECTION_LOST, STATES.FATAL_ERROR],
    [STATES.ROUND_RESULTS]: [STATES.ROUND_PREPARING, STATES.GAME_RESULTS, STATES.CONNECTION_LOST, STATES.FATAL_ERROR],
    [STATES.GAME_RESULTS]: [STATES.LOBBY, STATES.CONNECTION_LOST, STATES.FATAL_ERROR],
    [STATES.CONNECTION_LOST]: [STATES.LOBBY, STATES.ROUND_PREPARING, STATES.ROUND_ACTIVE, STATES.ROUND_RESULTS, STATES.GAME_RESULTS, STATES.FATAL_ERROR],
    [STATES.FATAL_ERROR]: [STATES.HOME],
  };
  return Boolean(allowed[from]?.includes(to));
}

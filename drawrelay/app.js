import {
  STATES,
  MESSAGE_TYPES,
  MAX_PLAYERS,
  createRoomCode,
  normalizeRoomCode,
  sanitizeNickname,
  normalizeGuess,
  classifyGuess,
  calculateGuessScore,
  pickNextDrawer,
  dedupeWords,
  chooseWords,
  randomId,
  makeEnvelope,
  validateEnvelope,
  serializedSize,
} from './game-core.js';
import { storage, encryptKit, decryptKit } from './storage.js';

const PEERJS_LOCAL = './vendor/peerjs.min.js';
const PEERJS_CDN = 'https://unpkg.com/peerjs@1.5.5/dist/peerjs.min.js';
const QRCODE_LOCAL = './vendor/qrcode.min.js';
const QRCODE_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
const PEER_PREFIX = 'drawrelay-v1-';
const MAX_STROKES = 320;
const MAX_POINTS = 24000;
const MAX_GUESSES_PER_10S = 8;
const HOST_SAVE_KEY_VERSION = 1;

const FAMILY_WORDS = dedupeWords(`
Airplane
Alarm clock
Alligator
Apple
Astronaut
Backpack
Balloon
Banana
Baseball
Basketball
Bathtub
Beach
Bear
Bee
Bicycle
Birthday cake
Book
Bowling
Bridge
Butterfly
Cactus
Camera
Campfire
Candle
Car
Carrot
Castle
Cat
Chair
Cheese
Cloud
Coffee cup
Cookie
Crab
Crown
Cupcake
Dinosaur
Dog
Dolphin
Door
Dragon
Drum
Duck
Elephant
Eye
Fire truck
Fish
Flower
Football
Fork
Frog
Giraffe
Glasses
Guitar
Hamburger
Hat
Helicopter
Horse
Hot dog
Ice cream
Jellyfish
Kangaroo
Key
Kite
Ladybug
Lamp
Laptop
Lemon
Lion
Lollipop
Mailbox
Mermaid
Moon
Mountain
Mouse
Mushroom
Octopus
Orange
Owl
Panda
Penguin
Piano
Pizza
Popcorn
Rabbit
Rainbow
Robot
Rocket
Sandcastle
Sandwich
Shark
Shoe
Snowman
Soccer ball
Space telescope
Spider
Star
Strawberry
Sun
Sunglasses
Taco
Teapot
Tiger
Toothbrush
Train
Tree
Turtle
Umbrella
Unicorn
Volcano
Watermelon
Whale
Windmill
Zebra
`.trim().split('\n'));

const EASY_WORDS = dedupeWords(`
Ant
Ball
Bed
Bird
Boat
Boot
Box
Bread
Broom
Bus
Cake
Clock
Coat
Cow
Desk
Donut
Egg
Fan
Flag
Gift
Goat
Grapes
Hammer
Hand
Heart
House
Leaf
Milk
Monkey
Nose
Pencil
Pig
Plane
Rain
Ring
River
Shirt
Snake
Spoon
Table
Tent
Truck
Watch
Window
`.trim().split('\n'));

const defaultSettings = Object.freeze({
  roundCount: 5,
  roundSeconds: 60,
  drawerMode: 'random',
  wordPack: 'family',
  customWords: [],
});

const app = {
  role: 'none',
  state: STATES.HOME,
  roomCode: '',
  peer: null,
  peerOpen: false,
  hostConnection: null,
  connections: new Map(),
  connectionPlayers: new Map(),
  playerId: '',
  reconnectToken: '',
  nickname: '',
  deviceId: storage.getDeviceId(),
  hostRestoring: false,
  reconnectTimer: null,
  heartbeatTimer: null,
  hostTimer: null,
  wordChoiceTimer: null,
  wakeLock: null,
  lastTickSent: null,
  preferredDrawerId: null,
  preferences: {
    largeType: false,
    highContrast: false,
    reduceMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    sound: true,
    vibration: true,
    ...storage.getPreferences(),
  },
  premium: Boolean(storage.getLicense()?.valid),
  game: createInitialGame(),
  view: createInitialView(),
  localDrawing: { strokes: [] },
  drawingTool: { tool: 'pen', color: '#171722', width: 7 },
  activeStroke: null,
  pendingPoints: [],
  pointFlushTimer: null,
  lastPointerPoint: null,
  guessRate: [],
  loadedScripts: new Map(),
};

const els = {};

function createInitialGame() {
  return {
    phase: STATES.LOBBY,
    players: [],
    settings: { ...defaultSettings },
    round: 0,
    drawerId: null,
    previousDrawerId: null,
    answer: '',
    pendingWords: [],
    usedWords: [],
    wordHint: '',
    secondsLeft: defaultSettings.roundSeconds,
    roundEndsAt: 0,
    pauseRemaining: 0,
    paused: false,
    guesses: [],
    drawing: { strokes: [] },
    result: null,
    startedAt: null,
  };
}

function createInitialView() {
  return {
    phase: STATES.LOBBY,
    players: [],
    settings: { ...defaultSettings },
    round: 0,
    drawerId: null,
    wordHint: '',
    secondsLeft: defaultSettings.roundSeconds,
    paused: false,
    guesses: [],
    drawing: { strokes: [] },
    result: null,
  };
}

function cacheElements() {
  const ids = [
    'offline-banner', 'brand-button', 'connection-pill', 'settings-button',
    'home-screen', 'join-screen', 'lobby-screen', 'game-screen', 'results-screen', 'final-screen',
    'create-room-button', 'join-room-form', 'room-code-input', 'join-room-code', 'nickname-form', 'nickname-input', 'join-now-button', 'join-status',
    'lobby-room-code', 'copy-code-button', 'qrcode', 'share-room-button', 'copy-link-button', 'fullscreen-lobby-button',
    'player-count', 'player-limit', 'players-list', 'empty-players', 'lobby-waiting-badge', 'host-lobby-controls', 'player-lobby-message',
    'round-count-select', 'round-seconds-select', 'drawer-mode-select', 'word-pack-select', 'custom-words-input', 'start-game-button', 'start-help',
    'round-label', 'game-role-title', 'timer-value', 'timer-progress', 'word-hint', 'drawer-word', 'drawing-canvas', 'canvas-overlay', 'drawing-toolbar',
    'brush-size-select', 'undo-button', 'clear-button', 'guess-form', 'guess-input', 'guess-feedback', 'scoreboard', 'guess-feed',
    'host-round-controls', 'pause-round-button', 'skip-round-button', 'fullscreen-game-button',
    'results-eyebrow', 'results-title', 'result-word', 'round-winner', 'results-scoreboard', 'host-results-actions', 'next-round-button', 'player-results-message',
    'champion-card', 'final-scoreboard', 'premium-cta', 'save-kit-cta-button', 'host-final-actions', 'rematch-button', 'new-room-button', 'player-final-message',
    'word-choice-modal', 'word-options', 'settings-modal', 'large-type-toggle', 'high-contrast-toggle', 'reduce-motion-toggle', 'sound-toggle', 'vibration-toggle',
    'premium-status', 'unlock-premium-button', 'kit-controls', 'save-current-kit-button', 'import-kit-button', 'kit-file-input', 'kits-list',
    'license-modal', 'license-form', 'license-input', 'license-feedback', 'error-modal', 'error-title', 'error-message', 'error-action-button', 'toast-region', 'live-region',
  ];
  ids.forEach((id) => { els[id] = document.getElementById(id); });
}

function setAppState(next) {
  app.state = next;
  const screenMap = {
    [STATES.HOME]: 'home-screen',
    [STATES.CREATING_ROOM]: 'home-screen',
    [STATES.JOINING_ROOM]: 'join-screen',
    [STATES.LOBBY]: 'lobby-screen',
    [STATES.ROUND_PREPARING]: 'game-screen',
    [STATES.ROUND_ACTIVE]: 'game-screen',
    [STATES.ROUND_RESULTS]: 'results-screen',
    [STATES.GAME_RESULTS]: 'final-screen',
    [STATES.CONNECTION_LOST]: app.role === 'none' ? 'home-screen' : (app.view.phase === STATES.LOBBY ? 'lobby-screen' : 'game-screen'),
    [STATES.FATAL_ERROR]: 'home-screen',
  };
  document.querySelectorAll('.screen').forEach((screen) => screen.classList.remove('active'));
  document.getElementById(screenMap[next] || 'home-screen')?.classList.add('active');
  window.scrollTo({ top: 0, behavior: app.preferences.reduceMotion ? 'auto' : 'smooth' });
}

function setConnectionStatus(label, status = '') {
  const text = els['connection-pill'].querySelector('span:last-child');
  text.textContent = label;
  els['connection-pill'].classList.remove('connected', 'connecting', 'error');
  if (status) els['connection-pill'].classList.add(status);
}

function announce(text) {
  els['live-region'].textContent = '';
  requestAnimationFrame(() => { els['live-region'].textContent = text; });
}

function toast(text, duration = 2600) {
  const item = document.createElement('div');
  item.className = 'toast';
  item.textContent = text;
  els['toast-region'].append(item);
  window.setTimeout(() => item.remove(), duration);
}

function openModal(id) {
  document.getElementById(id)?.classList.remove('hidden');
  const focusable = document.getElementById(id)?.querySelector('button, input, select, textarea');
  focusable?.focus();
}

function closeModal(id) {
  document.getElementById(id)?.classList.add('hidden');
}

function showError(title, message, actionLabel = 'Return home', action = resetApp) {
  els['error-title'].textContent = title;
  els['error-message'].textContent = message;
  els['error-action-button'].textContent = actionLabel;
  els['error-action-button'].onclick = () => {
    closeModal('error-modal');
    action();
  };
  openModal('error-modal');
}

function updateOnlineStatus() {
  els['offline-banner'].classList.toggle('hidden', navigator.onLine);
  if (!navigator.onLine) setConnectionStatus('Offline', 'error');
}

function applyPreferences() {
  document.body.classList.toggle('large-type', app.preferences.largeType);
  document.body.classList.toggle('high-contrast', app.preferences.highContrast);
  document.body.classList.toggle('reduce-motion', app.preferences.reduceMotion);
  els['large-type-toggle'].checked = app.preferences.largeType;
  els['high-contrast-toggle'].checked = app.preferences.highContrast;
  els['reduce-motion-toggle'].checked = app.preferences.reduceMotion;
  els['sound-toggle'].checked = app.preferences.sound;
  els['vibration-toggle'].checked = app.preferences.vibration;
  storage.savePreferences(app.preferences);
}

function bindPreference(id, key) {
  els[id].addEventListener('change', (event) => {
    app.preferences[key] = event.target.checked;
    applyPreferences();
  });
}

function getBaseUrl() {
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  return url.toString();
}

function getJoinUrl(roomCode = app.roomCode) {
  const url = new URL(getBaseUrl());
  url.searchParams.set('room', roomCode);
  return url.toString();
}

function setUrl(params = {}) {
  const url = new URL(getBaseUrl());
  Object.entries(params).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== '') url.searchParams.set(key, value);
  });
  history.replaceState({}, '', url);
}

async function copyText(text, successText = 'Copied') {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const input = document.createElement('textarea');
    input.value = text;
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.append(input);
    input.select();
    document.execCommand('copy');
    input.remove();
  }
  toast(successText);
}

function loadScript(src) {
  if (app.loadedScripts.has(src)) return app.loadedScripts.get(src);
  const promise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === 'true') resolve();
      else {
        existing.addEventListener('load', resolve, { once: true });
        existing.addEventListener('error', reject, { once: true });
      }
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.addEventListener('load', () => { script.dataset.loaded = 'true'; resolve(); }, { once: true });
    script.addEventListener('error', () => reject(new Error(`Could not load ${src}`)), { once: true });
    document.head.append(script);
  });
  app.loadedScripts.set(src, promise);
  return promise;
}

async function ensureGlobal(globalName, localSrc, fallbackSrc) {
  if (window[globalName]) return window[globalName];
  try { await loadScript(localSrc); } catch { /* use network fallback */ }
  if (!window[globalName]) await loadScript(fallbackSrc);
  if (!window[globalName]) throw new Error(`${globalName} could not be loaded.`);
  return window[globalName];
}

async function ensurePeerJS() {
  return ensureGlobal('Peer', PEERJS_LOCAL, PEERJS_CDN);
}

async function ensureQRCode() {
  return ensureGlobal('QRCode', QRCODE_LOCAL, QRCODE_CDN);
}

function peerIdForRoom(roomCode) {
  return `${PEER_PREFIX}${roomCode.toLowerCase()}`;
}

function destroyPeer() {
  clearInterval(app.heartbeatTimer);
  clearInterval(app.hostTimer);
  clearTimeout(app.reconnectTimer);
  clearTimeout(app.wordChoiceTimer);
  app.connections.forEach((conn) => {
    try { conn.close(); } catch { /* ignored */ }
  });
  app.connections.clear();
  app.connectionPlayers.clear();
  try { app.hostConnection?.close(); } catch { /* ignored */ }
  app.hostConnection = null;
  try { app.peer?.destroy(); } catch { /* ignored */ }
  app.peer = null;
  app.peerOpen = false;
}

function resetApp() {
  destroyPeer();
  releaseWakeLock();
  app.role = 'none';
  app.roomCode = '';
  app.playerId = '';
  app.nickname = '';
  app.reconnectToken = '';
  app.game = createInitialGame();
  app.view = createInitialView();
  app.localDrawing = { strokes: [] };
  setUrl({});
  renderAll();
  setAppState(STATES.HOME);
  setConnectionStatus('Ready');
}

function createPeerAndWait(id) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const peer = id ? new window.Peer(id, { debug: 1 }) : new window.Peer(undefined, { debug: 1 });
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        try { peer.destroy(); } catch { /* ignored */ }
        reject(new Error('The signaling service did not respond.'));
      }
    }, 12000);
    peer.on('open', (peerId) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ peer, peerId });
    });
    peer.on('error', (error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(error);
      } else {
        handlePeerRuntimeError(error);
      }
    });
  });
}

function handlePeerRuntimeError(error) {
  console.warn('PeerJS error', error);
  if (error?.type === 'network' || error?.type === 'server-error' || error?.type === 'socket-error') {
    setConnectionStatus('Connection issue', 'error');
  }
}

async function createRoom({ restore = false, requestedCode = '' } = {}) {
  if (!navigator.onLine) {
    showError('Internet connection needed', 'Creating an internet room requires access to the signaling service.', 'Try again', () => createRoom({ restore, requestedCode }));
    return;
  }
  setAppState(STATES.CREATING_ROOM);
  setConnectionStatus('Creating room', 'connecting');
  els['create-room-button'].disabled = true;
  try {
    await ensurePeerJS();
    let lastError = null;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const code = requestedCode || createRoomCode();
      try {
        const { peer } = await createPeerAndWait(peerIdForRoom(code));
        app.role = 'host';
        app.roomCode = code;
        app.peer = peer;
        app.peerOpen = true;
        app.hostRestoring = restore;
        peer.on('connection', attachIncomingConnection);
        peer.on('disconnected', () => attemptHostPeerReconnect());
        peer.on('close', () => setConnectionStatus('Room closed', 'error'));
        if (restore) restoreHostSession(code);
        else app.game = createInitialGame();
        setUrl({ host: '1', room: code });
        persistHostSession();
        setConnectionStatus('Room live', 'connected');
        renderLobby();
        setAppState(STATES.LOBBY);
        requestWakeLock();
        renderQrCode();
        startHostHeartbeat();
        return;
      } catch (error) {
        lastError = error;
        if (requestedCode || error?.type !== 'unavailable-id') throw error;
      }
    }
    throw lastError || new Error('Could not reserve a room code.');
  } catch (error) {
    console.error(error);
    setConnectionStatus('Could not connect', 'error');
    setAppState(STATES.HOME);
    const collision = error?.type === 'unavailable-id';
    showError(
      collision ? 'Room is still active' : 'Could not create the room',
      collision ? 'That room code is already in use. Create a new room or wait a moment after refreshing.' : humanPeerError(error),
      'Try again',
      () => createRoom({ restore: false }),
    );
  } finally {
    els['create-room-button'].disabled = false;
  }
}

function humanPeerError(error) {
  const type = error?.type || '';
  if (type === 'browser-incompatible') return 'This browser does not support the WebRTC features DrawRelay needs.';
  if (type === 'peer-unavailable') return 'The room could not be found. Check the code and ask the host to keep the room open.';
  if (type === 'network' || type === 'server-error' || type === 'socket-error') return 'The signaling service is unavailable or blocked by this network. Check the connection and try again.';
  if (type === 'webrtc') return 'This network or browser blocked the direct WebRTC connection.';
  return error?.message || 'Check the internet connection and try again.';
}

function attemptHostPeerReconnect() {
  if (app.role !== 'host' || !app.peer || app.peer.destroyed) return;
  setConnectionStatus('Reconnecting host', 'connecting');
  try { app.peer.reconnect(); } catch { /* PeerJS may still be transitioning */ }
}

function restoreHostSession(roomCode) {
  const saved = storage.getHostSession(roomCode);
  if (!saved || saved.version !== HOST_SAVE_KEY_VERSION) {
    app.game = createInitialGame();
    return;
  }
  try {
    app.game = {
      ...createInitialGame(),
      ...saved.game,
      players: (saved.game.players || []).map((player) => ({ ...player, connected: false })),
      paused: saved.game.phase === STATES.ROUND_ACTIVE ? true : Boolean(saved.game.paused),
      pauseRemaining: saved.game.phase === STATES.ROUND_ACTIVE ? Math.max(1, saved.game.secondsLeft || 30) : saved.game.pauseRemaining,
    };
    app.view = publicSnapshot();
    app.localDrawing = structuredClone(app.game.drawing || { strokes: [] });
    toast(app.game.phase === STATES.ROUND_ACTIVE ? 'Room restored. The round is paused.' : 'Room restored.');
  } catch {
    app.game = createInitialGame();
  }
}

function persistHostSession() {
  if (app.role !== 'host' || !app.roomCode) return;
  storage.saveHostSession(app.roomCode, {
    version: HOST_SAVE_KEY_VERSION,
    savedAt: Date.now(),
    game: app.game,
  });
}

function attachIncomingConnection(conn) {
  if (app.role !== 'host') {
    conn.close();
    return;
  }
  const attemptKey = conn.peer || randomId(6);
  app.connections.set(attemptKey, conn);
  conn.on('data', (message) => handleHostMessage(conn, message));
  conn.on('close', () => handleConnectionClose(conn));
  conn.on('error', () => handleConnectionClose(conn));
}

function getPlayerByConnection(conn) {
  const playerId = app.connectionPlayers.get(conn.connectionId || conn.peer);
  return app.game.players.find((player) => player.id === playerId) || null;
}

function mapConnectionToPlayer(conn, playerId) {
  app.connectionPlayers.set(conn.connectionId || conn.peer, playerId);
  app.connections.set(playerId, conn);
  if (conn.peer && app.connections.get(conn.peer) === conn) app.connections.delete(conn.peer);
}

function handleConnectionClose(conn) {
  if (app.role === 'host') {
    const player = getPlayerByConnection(conn);
    if (player) {
      player.connected = false;
      player.disconnectedAt = Date.now();
      broadcastSnapshot();
      renderAll();
      persistHostSession();
      announce(`${player.nickname} disconnected.`);
    }
    return;
  }
  if (conn === app.hostConnection) schedulePlayerReconnect();
}

function handleHostMessage(conn, raw) {
  const validation = validateEnvelope(raw);
  if (!validation.ok) {
    sendConn(conn, MESSAGE_TYPES.ERROR, { code: 'invalid-message', message: validation.reason });
    return;
  }
  const player = getPlayerByConnection(conn);
  if (raw.type !== MESSAGE_TYPES.HELLO && !player) {
    sendConn(conn, MESSAGE_TYPES.ERROR, { code: 'hello-required', message: 'Join handshake required.' });
    return;
  }
  switch (raw.type) {
    case MESSAGE_TYPES.HELLO: handleHello(conn, raw.payload); break;
    case MESSAGE_TYPES.WORD_CHOICE: handleWordChoice(player, raw.payload); break;
    case MESSAGE_TYPES.GUESS: handleGuess(player, raw.payload); break;
    case MESSAGE_TYPES.DRAW_START:
    case MESSAGE_TYPES.DRAW_POINTS:
    case MESSAGE_TYPES.DRAW_END:
    case MESSAGE_TYPES.DRAW_UNDO:
    case MESSAGE_TYPES.DRAW_CLEAR:
      handleDrawingMessage(player, raw.type, raw.payload); break;
    case MESSAGE_TYPES.PING: sendConn(conn, MESSAGE_TYPES.PONG, { t: raw.payload.t }); break;
    default: break;
  }
}

function handleHello(conn, payload) {
  if (getPlayerByConnection(conn)) return;
  const nicknameBase = sanitizeNickname(payload.nickname);
  const deviceId = String(payload.deviceId || '').slice(0, 80);
  const reconnectToken = String(payload.reconnectToken || '').slice(0, 80);
  if (!nicknameBase || !deviceId) {
    sendConn(conn, MESSAGE_TYPES.ERROR, { code: 'invalid-profile', message: 'Enter a valid nickname and try again.' });
    conn.close();
    return;
  }

  let player = app.game.players.find((candidate) => candidate.reconnectToken === reconnectToken && candidate.deviceId === deviceId);
  if (!player) {
    if (app.game.players.filter((candidate) => candidate.connected).length >= MAX_PLAYERS) {
      sendConn(conn, MESSAGE_TYPES.ERROR, { code: 'room-full', message: 'This room is full.' });
      conn.close();
      return;
    }
    let nickname = nicknameBase;
    const existingNames = new Set(app.game.players.map((candidate) => normalizeGuess(candidate.nickname)));
    let suffix = 2;
    while (existingNames.has(normalizeGuess(nickname))) {
      nickname = `${nicknameBase.slice(0, 20)} ${suffix}`;
      suffix += 1;
    }
    player = {
      id: `p_${randomId(12)}`,
      deviceId,
      reconnectToken: randomId(24),
      nickname,
      score: 0,
      connected: true,
      spectator: false,
      solved: false,
      joinedAt: Date.now(),
    };
    app.game.players.push(player);
  } else {
    player.connected = true;
    player.disconnectedAt = null;
    player.nickname = player.nickname || nicknameBase;
  }

  mapConnectionToPlayer(conn, player.id);
  sendConn(conn, MESSAGE_TYPES.WELCOME, {
    playerId: player.id,
    reconnectToken: player.reconnectToken,
    assignedNickname: player.nickname,
    roomCode: app.roomCode,
    snapshot: publicSnapshot(),
  });
  if (app.game.drawerId === player.id && app.game.answer && [STATES.ROUND_PREPARING, STATES.ROUND_ACTIVE].includes(app.game.phase)) {
    if (app.game.phase === STATES.ROUND_PREPARING && app.game.pendingWords.length) sendConn(conn, MESSAGE_TYPES.WORD_OPTIONS, { words: app.game.pendingWords });
    if (app.game.phase === STATES.ROUND_ACTIVE) sendConn(conn, MESSAGE_TYPES.ROUND_START, { answer: app.game.answer });
  }
  broadcastSnapshot();
  renderAll();
  persistHostSession();
  announce(`${player.nickname} joined.`);
}

function sendConn(conn, type, payload = {}) {
  if (!conn?.open) return false;
  const envelope = makeEnvelope(type, payload);
  if (serializedSize(envelope) > 64 * 1024) return false;
  try {
    const channel = conn.dataChannel;
    if (channel && channel.bufferedAmount > 6 * 1024 * 1024) return false;
    conn.send(envelope);
    return true;
  } catch {
    return false;
  }
}

function sendToPlayer(playerId, type, payload = {}) {
  return sendConn(app.connections.get(playerId), type, payload);
}

function broadcast(type, payload = {}, { exclude = null } = {}) {
  app.game.players.forEach((player) => {
    if (player.connected && player.id !== exclude) sendToPlayer(player.id, type, payload);
  });
}

function publicSnapshot() {
  const exposeAnswer = [STATES.ROUND_RESULTS, STATES.GAME_RESULTS].includes(app.game.phase);
  return {
    phase: app.game.phase,
    players: app.game.players.map(({ id, nickname, score, connected, spectator, solved }) => ({ id, nickname, score, connected, spectator, solved })),
    settings: {
      roundCount: app.game.settings.roundCount,
      roundSeconds: app.game.settings.roundSeconds,
      drawerMode: app.game.settings.drawerMode,
      wordPack: app.game.settings.wordPack,
    },
    round: app.game.round,
    drawerId: app.game.drawerId,
    wordHint: app.game.wordHint,
    secondsLeft: app.game.secondsLeft,
    paused: app.game.paused,
    guesses: app.game.guesses.slice(-30),
    drawing: app.game.drawing,
    result: exposeAnswer ? app.game.result : null,
  };
}

function broadcastSnapshot() {
  app.view = publicSnapshot();
  broadcast(MESSAGE_TYPES.SNAPSHOT, { snapshot: app.view });
  renderAll();
  persistHostSession();
}

async function showDrawerDialog(players) {
  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    const card = document.createElement('div');
    card.className = 'modal-card word-choice-card';
    const eyebrow = document.createElement('p');
    eyebrow.className = 'eyebrow';
    eyebrow.textContent = 'Host choice';
    const title = document.createElement('h2');
    title.textContent = 'Who draws next?';
    const options = document.createElement('div');
    options.className = 'word-options';
    players.forEach((player) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'word-option-button';
      button.textContent = player.nickname;
      button.addEventListener('click', () => { modal.remove(); resolve(player.id); });
      options.append(button);
    });
    card.append(eyebrow, title, options);
    modal.append(card);
    document.body.append(modal);
  });
}

function getActiveWords() {
  if (app.game.settings.wordPack === 'easy') return EASY_WORDS;
  if (app.game.settings.wordPack === 'custom') return dedupeWords(app.game.settings.customWords);
  return FAMILY_WORDS;
}

async function startGame() {
  if (app.role !== 'host') return;
  const eligible = app.game.players.filter((player) => player.connected && !player.spectator);
  if (eligible.length < 2) {
    toast('At least 2 connected players are needed.');
    return;
  }
  const words = getActiveWords();
  if (words.length < 3) {
    showError('Add more words', 'The selected pack needs at least 3 valid words before the game can start.', 'Return to lobby', () => closeModal('error-modal'));
    return;
  }
  app.game.players.forEach((player) => { player.score = 0; player.solved = false; });
  app.game.round = 0;
  app.game.previousDrawerId = null;
  app.game.usedWords = [];
  app.game.startedAt = Date.now();
  await prepareRound();
}

async function prepareRound() {
  if (app.role !== 'host') return;
  clearInterval(app.hostTimer);
  clearTimeout(app.wordChoiceTimer);
  const eligible = app.game.players.filter((player) => player.connected && !player.spectator);
  if (eligible.length < 2) {
    showError('Not enough players', 'Two connected players are needed to continue.', 'Return to lobby', returnToLobby);
    return;
  }
  app.game.round += 1;
  app.game.phase = STATES.ROUND_PREPARING;
  app.game.answer = '';
  app.game.pendingWords = [];
  app.game.result = null;
  app.game.guesses = [];
  app.game.drawing = { strokes: [] };
  app.game.players.forEach((player) => { player.solved = false; });
  let preferred = null;
  if (app.game.settings.drawerMode === 'host') preferred = await showDrawerDialog(eligible);
  const drawerId = pickNextDrawer(eligible, app.game.previousDrawerId, preferred);
  if (!drawerId) return;
  app.game.drawerId = drawerId;
  app.game.previousDrawerId = drawerId;
  const words = chooseWords(getActiveWords(), 3, new Set(app.game.usedWords));
  if (words.length < 3) {
    app.game.usedWords = [];
    words.push(...chooseWords(getActiveWords(), 3, new Set()));
  }
  app.game.pendingWords = dedupeWords(words).slice(0, 3);
  app.game.wordHint = '';
  app.game.secondsLeft = app.game.settings.roundSeconds;
  broadcastSnapshot();
  sendToPlayer(drawerId, MESSAGE_TYPES.WORD_OPTIONS, { words: app.game.pendingWords });
  setAppState(STATES.ROUND_PREPARING);
  renderAll();
  app.wordChoiceTimer = setTimeout(() => {
    if (app.game.phase === STATES.ROUND_PREPARING && app.game.pendingWords.length) selectWord(app.game.pendingWords[0]);
  }, 12000);
}

function handleWordChoice(player, payload) {
  if (!player || player.id !== app.game.drawerId || app.game.phase !== STATES.ROUND_PREPARING) return;
  const word = String(payload.word || '');
  if (!app.game.pendingWords.includes(word)) return;
  selectWord(word);
}

function selectWord(word) {
  clearTimeout(app.wordChoiceTimer);
  app.game.answer = word;
  app.game.usedWords.push(normalizeGuess(word));
  app.game.pendingWords = [];
  app.game.wordHint = word.split('').map((char) => (char === ' ' ? '  ' : '_')).join(' ');
  startRound();
}

function startRound() {
  app.game.phase = STATES.ROUND_ACTIVE;
  app.game.paused = false;
  app.game.secondsLeft = app.game.settings.roundSeconds;
  app.game.roundEndsAt = Date.now() + app.game.settings.roundSeconds * 1000;
  app.game.pauseRemaining = 0;
  sendToPlayer(app.game.drawerId, MESSAGE_TYPES.ROUND_START, { answer: app.game.answer });
  broadcastSnapshot();
  setAppState(STATES.ROUND_ACTIVE);
  playTone('start');
  vibrate([40, 40, 40]);
  startHostRoundTimer();
}

function startHostRoundTimer() {
  clearInterval(app.hostTimer);
  app.lastTickSent = null;
  app.hostTimer = setInterval(() => {
    if (app.game.phase !== STATES.ROUND_ACTIVE || app.game.paused) return;
    const remaining = Math.max(0, Math.ceil((app.game.roundEndsAt - Date.now()) / 1000));
    app.game.secondsLeft = remaining;
    if (remaining !== app.lastTickSent) {
      app.lastTickSent = remaining;
      broadcast(MESSAGE_TYPES.ROUND_TICK, { secondsLeft: remaining });
      app.view.secondsLeft = remaining;
      updateTimer(remaining, app.game.settings.roundSeconds);
      persistHostSession();
    }
    if (remaining <= 0) endRound('time');
  }, 250);
}

function pauseRound() {
  if (app.role !== 'host' || app.game.phase !== STATES.ROUND_ACTIVE) return;
  if (!app.game.paused) {
    app.game.pauseRemaining = Math.max(1, Math.ceil((app.game.roundEndsAt - Date.now()) / 1000));
    app.game.secondsLeft = app.game.pauseRemaining;
    app.game.paused = true;
    broadcast(MESSAGE_TYPES.ROUND_PAUSE, { secondsLeft: app.game.secondsLeft });
    els['pause-round-button'].textContent = 'Resume';
    toast('Round paused');
  } else {
    app.game.paused = false;
    app.game.roundEndsAt = Date.now() + app.game.pauseRemaining * 1000;
    broadcast(MESSAGE_TYPES.ROUND_RESUME, { secondsLeft: app.game.pauseRemaining });
    els['pause-round-button'].textContent = 'Pause';
    toast('Round resumed');
  }
  broadcastSnapshot();
}

function endRound(reason = 'host') {
  if (app.role !== 'host' || ![STATES.ROUND_ACTIVE, STATES.ROUND_PREPARING].includes(app.game.phase)) return;
  clearInterval(app.hostTimer);
  clearTimeout(app.wordChoiceTimer);
  const correctPlayers = app.game.players.filter((player) => player.solved).sort((a, b) => b.score - a.score);
  app.game.phase = STATES.ROUND_RESULTS;
  app.game.paused = false;
  app.game.result = {
    answer: app.game.answer || app.game.pendingWords[0] || 'Skipped',
    reason,
    correctIds: correctPlayers.map((player) => player.id),
    topGuesserId: correctPlayers[0]?.id || null,
  };
  app.game.answer = app.game.result.answer;
  broadcast(MESSAGE_TYPES.ROUND_END, { result: app.game.result, snapshot: publicSnapshot() });
  app.view = publicSnapshot();
  setAppState(STATES.ROUND_RESULTS);
  renderResults();
  playTone('end');
  persistHostSession();
}

async function nextRound() {
  if (app.game.round >= app.game.settings.roundCount) {
    endGame();
    return;
  }
  await prepareRound();
}

function endGame() {
  clearInterval(app.hostTimer);
  app.game.phase = STATES.GAME_RESULTS;
  app.game.result = { final: true };
  broadcast(MESSAGE_TYPES.GAME_END, { snapshot: publicSnapshot() });
  app.view = publicSnapshot();
  setAppState(STATES.GAME_RESULTS);
  renderFinal();
  playTone('win');
  persistHostSession();
}

function rematch() {
  if (app.role !== 'host') return;
  app.game.phase = STATES.LOBBY;
  app.game.round = 0;
  app.game.answer = '';
  app.game.result = null;
  app.game.guesses = [];
  app.game.drawing = { strokes: [] };
  app.game.players.forEach((player) => { player.score = 0; player.solved = false; });
  broadcast(MESSAGE_TYPES.REMATCH, { snapshot: publicSnapshot() });
  broadcastSnapshot();
  setAppState(STATES.LOBBY);
  renderLobby();
}

function returnToLobby() {
  closeModal('error-modal');
  if (app.role === 'host') rematch();
  else setAppState(STATES.LOBBY);
}

function handleGuess(player, payload) {
  if (!player || app.game.phase !== STATES.ROUND_ACTIVE || app.game.paused) return;
  if (player.id === app.game.drawerId || player.solved) return;
  const now = Date.now();
  player.guessTimes = (player.guessTimes || []).filter((time) => now - time < 10000);
  if (player.guessTimes.length >= MAX_GUESSES_PER_10S) {
    sendToPlayer(player.id, MESSAGE_TYPES.GUESS_EVENT, { kind: 'rate', message: 'Please wait a moment before guessing again.' });
    return;
  }
  player.guessTimes.push(now);
  const guess = String(payload.guess || '').slice(0, 80);
  const normalized = normalizeGuess(guess);
  if (!normalized) return;
  const classification = classifyGuess(guess, app.game.answer);
  if (classification === 'correct') {
    const correctOrder = app.game.players.filter((candidate) => candidate.solved).length;
    const points = calculateGuessScore({
      remainingSeconds: app.game.secondsLeft,
      roundSeconds: app.game.settings.roundSeconds,
      correctOrder,
    });
    player.solved = true;
    player.score += points;
    const drawer = app.game.players.find((candidate) => candidate.id === app.game.drawerId);
    if (drawer) drawer.score += 25;
    const event = { id: randomId(8), playerId: player.id, nickname: player.nickname, kind: 'correct', text: 'guessed it!', points, at: now };
    app.game.guesses.push(event);
    sendToPlayer(player.id, MESSAGE_TYPES.GUESS_EVENT, { kind: 'correct', points, message: `Correct! +${points}` });
    broadcast(MESSAGE_TYPES.GUESS_EVENT, { event });
    broadcastSnapshot();
    const remainingGuessers = app.game.players.filter((candidate) => candidate.connected && !candidate.spectator && candidate.id !== app.game.drawerId && !candidate.solved);
    if (!remainingGuessers.length) setTimeout(() => endRound('all-guessed'), 1000);
    return;
  }
  if (classification === 'near') {
    sendToPlayer(player.id, MESSAGE_TYPES.GUESS_EVENT, { kind: 'near', message: 'Very close!' });
  }
  const event = { id: randomId(8), playerId: player.id, nickname: player.nickname, kind: 'guess', text: guess.slice(0, 80), at: now };
  app.game.guesses.push(event);
  if (app.game.guesses.length > 30) app.game.guesses.shift();
  broadcast(MESSAGE_TYPES.GUESS_EVENT, { event });
  app.view.guesses = app.game.guesses;
  renderGuessFeed();
}

function validatePoint(point) {
  return Array.isArray(point) && point.length >= 2 && point.length <= 4 && point.every((value) => Number.isFinite(Number(value))) && Number(point[0]) >= 0 && Number(point[0]) <= 1 && Number(point[1]) >= 0 && Number(point[1]) <= 1;
}

function totalPointCount() {
  return app.game.drawing.strokes.reduce((sum, stroke) => sum + stroke.points.length, 0);
}

function handleDrawingMessage(player, type, payload) {
  if (!player || player.id !== app.game.drawerId || app.game.phase !== STATES.ROUND_ACTIVE || app.game.paused) return;
  if (type === MESSAGE_TYPES.DRAW_START) {
    if (app.game.drawing.strokes.length >= MAX_STROKES || totalPointCount() >= MAX_POINTS) return;
    const id = String(payload.id || '').slice(0, 40);
    const point = payload.point;
    if (!id || !validatePoint(point) || app.game.drawing.strokes.some((stroke) => stroke.id === id)) return;
    const tool = payload.tool === 'eraser' ? 'eraser' : 'pen';
    const color = /^#[0-9a-f]{6}$/i.test(payload.color || '') ? payload.color : '#171722';
    const width = Math.max(1, Math.min(30, Number(payload.width) || 7));
    app.game.drawing.strokes.push({ id, tool, color, width, points: [point.map(Number)], complete: false });
    broadcast(type, { id, tool, color, width, point }, { exclude: player.id });
  } else if (type === MESSAGE_TYPES.DRAW_POINTS) {
    const id = String(payload.id || '').slice(0, 40);
    const stroke = app.game.drawing.strokes.find((candidate) => candidate.id === id);
    const points = Array.isArray(payload.points) ? payload.points.slice(0, 64).filter(validatePoint).map((point) => point.map(Number)) : [];
    if (!stroke || !points.length || stroke.complete || totalPointCount() + points.length > MAX_POINTS) return;
    stroke.points.push(...points);
    broadcast(type, { id, points }, { exclude: player.id });
  } else if (type === MESSAGE_TYPES.DRAW_END) {
    const stroke = app.game.drawing.strokes.find((candidate) => candidate.id === String(payload.id || ''));
    if (!stroke) return;
    stroke.complete = true;
    broadcast(type, { id: stroke.id }, { exclude: player.id });
    persistHostSession();
  } else if (type === MESSAGE_TYPES.DRAW_UNDO) {
    app.game.drawing.strokes.pop();
    broadcast(type, {}, { exclude: player.id });
    renderCanvas();
    persistHostSession();
  } else if (type === MESSAGE_TYPES.DRAW_CLEAR) {
    app.game.drawing.strokes = [];
    broadcast(type, {}, { exclude: player.id });
    renderCanvas();
    persistHostSession();
  }
  app.localDrawing = app.game.drawing;
  renderCanvas();
}

async function joinRoom(roomCode, nickname, { automatic = false } = {}) {
  const code = normalizeRoomCode(roomCode);
  const cleanName = sanitizeNickname(nickname);
  if (code.length !== 8) {
    toast('Enter the complete 8-character room code.');
    return;
  }
  if (!cleanName) {
    toast('Enter a nickname.');
    els['nickname-input'].focus();
    return;
  }
  if (!navigator.onLine) {
    showError('Internet connection needed', 'Joining an internet room requires access to the signaling service.', 'Try again', () => joinRoom(code, cleanName));
    return;
  }
  app.role = 'player';
  app.roomCode = code;
  app.nickname = cleanName;
  app.playerId = '';
  app.reconnectToken = storage.getReconnect(code)?.token || '';
  setUrl({ room: code });
  setAppState(STATES.JOINING_ROOM);
  setConnectionStatus('Joining room', 'connecting');
  els['join-status'].classList.remove('hidden');
  els['join-status'].textContent = automatic ? 'Reconnecting to the room…' : 'Connecting securely to the host…';
  els['join-now-button'].disabled = true;
  try {
    await ensurePeerJS();
    destroyPeer();
    const { peer } = await createPeerAndWait();
    app.peer = peer;
    app.peerOpen = true;
    peer.on('disconnected', () => {
      setConnectionStatus('Signaling disconnected', 'connecting');
      try { peer.reconnect(); } catch { /* ignored */ }
    });
    peer.on('close', schedulePlayerReconnect);
    await connectToHost();
  } catch (error) {
    console.error(error);
    setConnectionStatus('Could not join', 'error');
    els['join-status'].textContent = humanPeerError(error);
    els['join-now-button'].disabled = false;
    if (automatic) showError('Could not rejoin the room', humanPeerError(error), 'Enter room again', () => showJoinScreen(code));
  }
}

function connectToHost() {
  return new Promise((resolve, reject) => {
    const conn = app.peer.connect(peerIdForRoom(app.roomCode), {
      reliable: true,
      serialization: 'json',
      metadata: { app: 'drawrelay', version: 1 },
    });
    app.hostConnection = conn;
    const timeout = setTimeout(() => {
      reject(Object.assign(new Error('The host did not answer.'), { type: 'peer-unavailable' }));
      try { conn.close(); } catch { /* ignored */ }
    }, 12000);
    conn.on('open', () => {
      clearTimeout(timeout);
      sendConn(conn, MESSAGE_TYPES.HELLO, {
        nickname: app.nickname,
        deviceId: app.deviceId,
        reconnectToken: app.reconnectToken,
      });
      resolve();
    });
    conn.on('data', handlePlayerMessage);
    conn.on('close', () => {
      if (app.role === 'player') schedulePlayerReconnect();
    });
    conn.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

function handlePlayerMessage(raw) {
  const validation = validateEnvelope(raw);
  if (!validation.ok) return;
  switch (raw.type) {
    case MESSAGE_TYPES.WELCOME: {
      app.playerId = String(raw.payload.playerId || '');
      app.reconnectToken = String(raw.payload.reconnectToken || '');
      app.nickname = sanitizeNickname(raw.payload.assignedNickname || app.nickname);
      storage.saveReconnect(app.roomCode, { token: app.reconnectToken, nickname: app.nickname, savedAt: Date.now() });
      app.view = raw.payload.snapshot || createInitialView();
      app.localDrawing = structuredClone(app.view.drawing || { strokes: [] });
      els['nickname-input'].value = app.nickname;
      setConnectionStatus('Connected', 'connected');
      els['join-status'].classList.add('hidden');
      els['join-now-button'].disabled = false;
      renderAll();
      setAppState(app.view.phase || STATES.LOBBY);
      requestWakeLock();
      startPlayerHeartbeat();
      toast(`Joined as ${app.nickname}`);
      break;
    }
    case MESSAGE_TYPES.SNAPSHOT:
      applySnapshot(raw.payload.snapshot);
      break;
    case MESSAGE_TYPES.WORD_OPTIONS:
      if (app.playerId === app.view.drawerId) showWordOptions(raw.payload.words || []);
      break;
    case MESSAGE_TYPES.ROUND_START:
      if (app.playerId === app.view.drawerId) {
        els['drawer-word'].querySelector('strong').textContent = String(raw.payload.answer || '');
        els['drawer-word'].classList.remove('hidden');
        closeModal('word-choice-modal');
      }
      playTone('start');
      vibrate([40, 40, 40]);
      break;
    case MESSAGE_TYPES.ROUND_TICK:
      app.view.secondsLeft = Math.max(0, Number(raw.payload.secondsLeft) || 0);
      updateTimer(app.view.secondsLeft, app.view.settings.roundSeconds);
      break;
    case MESSAGE_TYPES.ROUND_PAUSE:
      app.view.paused = true;
      app.view.secondsLeft = Number(raw.payload.secondsLeft) || app.view.secondsLeft;
      renderGame();
      toast('The host paused the round.');
      break;
    case MESSAGE_TYPES.ROUND_RESUME:
      app.view.paused = false;
      renderGame();
      toast('Round resumed.');
      break;
    case MESSAGE_TYPES.ROUND_END:
      app.view = raw.payload.snapshot || app.view;
      app.view.result = raw.payload.result;
      setAppState(STATES.ROUND_RESULTS);
      renderResults();
      playTone('end');
      break;
    case MESSAGE_TYPES.GAME_END:
      app.view = raw.payload.snapshot || app.view;
      setAppState(STATES.GAME_RESULTS);
      renderFinal();
      playTone('win');
      break;
    case MESSAGE_TYPES.REMATCH:
      applySnapshot(raw.payload.snapshot);
      break;
    case MESSAGE_TYPES.GUESS_EVENT:
      handleGuessEvent(raw.payload);
      break;
    case MESSAGE_TYPES.DRAW_START:
    case MESSAGE_TYPES.DRAW_POINTS:
    case MESSAGE_TYPES.DRAW_END:
    case MESSAGE_TYPES.DRAW_UNDO:
    case MESSAGE_TYPES.DRAW_CLEAR:
      applyRemoteDrawing(raw.type, raw.payload);
      break;
    case MESSAGE_TYPES.ERROR:
      handleServerError(raw.payload);
      break;
    case MESSAGE_TYPES.PONG:
      setConnectionStatus('Connected', 'connected');
      break;
    default: break;
  }
}

function applySnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return;
  const previousPhase = app.view.phase;
  app.view = snapshot;
  app.localDrawing = structuredClone(snapshot.drawing || { strokes: [] });
  renderAll();
  if (snapshot.phase !== previousPhase) {
    setAppState(snapshot.phase);
    if (snapshot.phase === STATES.ROUND_RESULTS) renderResults();
    if (snapshot.phase === STATES.GAME_RESULTS) renderFinal();
  }
}

function handleServerError(payload) {
  const message = String(payload.message || 'The host rejected the connection.');
  if (payload.code === 'room-full' || payload.code === 'invalid-profile') {
    showError(payload.code === 'room-full' ? 'Room is full' : 'Could not join', message, 'Return home', resetApp);
  } else {
    toast(message, 4200);
  }
}

function schedulePlayerReconnect() {
  if (app.role !== 'player' || !app.roomCode) return;
  clearTimeout(app.reconnectTimer);
  setConnectionStatus('Reconnecting', 'connecting');
  setAppState(STATES.CONNECTION_LOST);
  app.reconnectTimer = setTimeout(async () => {
    try {
      if (!app.peer || app.peer.destroyed) {
        const { peer } = await createPeerAndWait();
        app.peer = peer;
      }
      await connectToHost();
    } catch {
      schedulePlayerReconnect();
    }
  }, 2800);
}

function startPlayerHeartbeat() {
  clearInterval(app.heartbeatTimer);
  app.heartbeatTimer = setInterval(() => {
    if (app.hostConnection?.open) sendConn(app.hostConnection, MESSAGE_TYPES.PING, { t: Date.now() });
  }, 15000);
}

function startHostHeartbeat() {
  clearInterval(app.heartbeatTimer);
  app.heartbeatTimer = setInterval(() => {
    const cutoff = Date.now() - 5 * 60 * 1000;
    app.game.players = app.game.players.filter((player) => player.connected || !player.disconnectedAt || player.disconnectedAt > cutoff || player.score > 0);
    broadcast(MESSAGE_TYPES.PING, { t: Date.now() });
  }, 15000);
}

function showJoinScreen(roomCode) {
  const code = normalizeRoomCode(roomCode);
  app.roomCode = code;
  els['join-room-code'].textContent = code;
  const remembered = storage.getReconnect(code)?.nickname || localStorage.getItem('drawrelay:lastNickname') || '';
  els['nickname-input'].value = sanitizeNickname(remembered);
  setAppState(STATES.JOINING_ROOM);
  setTimeout(() => els['nickname-input'].focus(), 100);
}

async function renderQrCode() {
  if (app.role !== 'host' || !app.roomCode) return;
  els.qrcode.textContent = '';
  try {
    await ensureQRCode();
    new window.QRCode(els.qrcode, {
      text: getJoinUrl(),
      width: 210,
      height: 210,
      colorDark: '#171722',
      colorLight: '#ffffff',
      correctLevel: window.QRCode.CorrectLevel.M,
    });
  } catch {
    const placeholder = document.createElement('div');
    placeholder.className = 'qr-placeholder';
    placeholder.textContent = 'QR unavailable — use the room code';
    els.qrcode.append(placeholder);
  }
}

function renderAll() {
  renderLobby();
  renderGame();
  renderResults();
  renderFinal();
  renderPremium();
}

function renderLobby() {
  const snapshot = app.role === 'host' ? publicSnapshot() : app.view;
  els['lobby-room-code'].textContent = app.roomCode || '--------';
  els['player-limit'].textContent = String(MAX_PLAYERS);
  const players = snapshot.players || [];
  els['player-count'].textContent = String(players.filter((player) => player.connected).length);
  els['players-list'].textContent = '';
  players.forEach((player) => {
    const row = document.createElement('div');
    row.className = 'player-row';
    const avatar = document.createElement('div');
    avatar.className = 'player-avatar';
    avatar.textContent = player.nickname.slice(0, 1).toUpperCase();
    const info = document.createElement('div');
    const name = document.createElement('span');
    name.className = 'player-name';
    name.textContent = player.nickname;
    const meta = document.createElement('span');
    meta.className = 'player-meta';
    meta.textContent = player.id === app.playerId ? 'You' : (player.connected ? 'Connected' : 'Reconnecting…');
    info.append(name, meta);
    const ready = document.createElement('span');
    ready.className = 'player-ready';
    ready.textContent = player.connected ? 'Ready' : 'Away';
    row.append(avatar, info, ready);
    els['players-list'].append(row);
  });
  els['empty-players'].classList.toggle('hidden', players.length > 0);
  els['host-lobby-controls'].classList.toggle('hidden', app.role !== 'host');
  els['player-lobby-message'].classList.toggle('hidden', app.role !== 'player');
  const connectedCount = players.filter((player) => player.connected && !player.spectator).length;
  els['start-game-button'].disabled = connectedCount < 2;
  els['start-help'].textContent = connectedCount < 2 ? 'At least 2 players are needed.' : `${connectedCount} players ready.`;
  els['lobby-waiting-badge'].textContent = connectedCount ? `${connectedCount} ready` : 'Waiting';
  if (app.role === 'host') {
    els['round-count-select'].value = String(app.game.settings.roundCount);
    els['round-seconds-select'].value = String(app.game.settings.roundSeconds);
    els['drawer-mode-select'].value = app.game.settings.drawerMode;
    els['word-pack-select'].value = app.game.settings.wordPack;
    els['custom-words-input'].value = app.game.settings.customWords.join('\n');
  }
}

function renderGame() {
  const snapshot = app.role === 'host' ? publicSnapshot() : app.view;
  if (!snapshot) return;
  const me = snapshot.players?.find((player) => player.id === app.playerId);
  const drawer = snapshot.players?.find((player) => player.id === snapshot.drawerId);
  const isDrawer = app.role === 'player' && app.playerId === snapshot.drawerId;
  els['round-label'].textContent = `Round ${snapshot.round || 1} of ${snapshot.settings?.roundCount || 5}`;
  if (snapshot.phase === STATES.ROUND_PREPARING) {
    els['game-role-title'].textContent = isDrawer ? 'Choose your word' : `${drawer?.nickname || 'A player'} is choosing`;
  } else if (app.role === 'host') {
    els['game-role-title'].textContent = `${drawer?.nickname || 'Player'} is drawing`;
  } else if (isDrawer) {
    els['game-role-title'].textContent = 'Draw the word';
  } else if (me?.solved) {
    els['game-role-title'].textContent = 'You got it!';
  } else {
    els['game-role-title'].textContent = 'Watch and guess';
  }
  els['word-hint'].textContent = snapshot.wordHint || 'Waiting for a word…';
  els['drawing-toolbar'].classList.toggle('hidden', !isDrawer || snapshot.phase !== STATES.ROUND_ACTIVE || snapshot.paused);
  els['guess-form'].classList.toggle('hidden', app.role !== 'player' || isDrawer || me?.solved || snapshot.phase !== STATES.ROUND_ACTIVE || snapshot.paused);
  els['host-round-controls'].classList.toggle('hidden', app.role !== 'host' || snapshot.phase !== STATES.ROUND_ACTIVE);
  els['pause-round-button'].textContent = snapshot.paused ? 'Resume' : 'Pause';
  const preparing = snapshot.phase === STATES.ROUND_PREPARING;
  els['canvas-overlay'].classList.toggle('hidden', !preparing && !snapshot.paused);
  if (snapshot.paused) els['canvas-overlay'].querySelector('strong').textContent = 'Round paused by the host';
  else els['canvas-overlay'].querySelector('strong').textContent = isDrawer ? 'Choose a word to begin…' : 'The drawer is choosing a word…';
  if (!isDrawer) els['drawer-word'].classList.add('hidden');
  updateTimer(snapshot.secondsLeft ?? snapshot.settings?.roundSeconds ?? 60, snapshot.settings?.roundSeconds || 60);
  app.localDrawing = structuredClone(snapshot.drawing || app.localDrawing || { strokes: [] });
  renderCanvas();
  renderScoreboard(els.scoreboard, snapshot.players || [], snapshot.drawerId);
  renderGuessFeed();
}

function updateTimer(seconds, total) {
  const safeTotal = Math.max(1, Number(total) || 60);
  const safeSeconds = Math.max(0, Number(seconds) || 0);
  els['timer-value'].textContent = String(safeSeconds);
  const circumference = 125.66;
  const progress = Math.max(0, Math.min(1, safeSeconds / safeTotal));
  els['timer-progress'].style.strokeDashoffset = String(circumference * (1 - progress));
  els['timer-progress'].style.stroke = safeSeconds <= 10 ? '#cf3f53' : 'var(--primary)';
}

function renderScoreboard(container, players, drawerId = null) {
  container.textContent = '';
  [...players].sort((a, b) => b.score - a.score || a.nickname.localeCompare(b.nickname)).forEach((player, index) => {
    const row = document.createElement('li');
    row.className = 'score-row';
    if (player.id === drawerId) row.classList.add('drawer');
    if (player.solved) row.classList.add('solved');
    const rank = document.createElement('span'); rank.className = 'score-rank'; rank.textContent = String(index + 1);
    const name = document.createElement('span'); name.className = 'score-name'; name.textContent = player.nickname;
    const value = document.createElement('span'); value.className = 'score-value'; value.textContent = String(player.score);
    row.append(rank, name, value);
    container.append(row);
  });
}

function renderGuessFeed() {
  const snapshot = app.role === 'host' ? publicSnapshot() : app.view;
  els['guess-feed'].textContent = '';
  const guesses = snapshot.guesses || [];
  if (!guesses.length) {
    const empty = document.createElement('div');
    empty.className = 'field-help';
    empty.textContent = 'Guesses will appear here.';
    els['guess-feed'].append(empty);
    return;
  }
  guesses.slice(-15).forEach((guess) => {
    const bubble = document.createElement('div');
    bubble.className = `guess-bubble ${guess.kind === 'correct' ? 'correct' : ''}`;
    const name = document.createElement('strong');
    name.textContent = guess.nickname;
    const text = document.createElement('span');
    text.textContent = guess.kind === 'correct' ? 'guessed it!' : guess.text;
    bubble.append(name, text);
    els['guess-feed'].append(bubble);
  });
  els['guess-feed'].scrollTop = els['guess-feed'].scrollHeight;
}

function renderResults() {
  const snapshot = app.role === 'host' ? publicSnapshot() : app.view;
  const result = snapshot.result || {};
  els['result-word'].textContent = result.answer || '—';
  els['results-eyebrow'].textContent = snapshot.round >= snapshot.settings?.roundCount ? 'Final round complete' : 'Round complete';
  const winner = snapshot.players?.find((player) => player.id === result.topGuesserId);
  els['round-winner'].textContent = winner ? `${winner.nickname} was first to guess correctly.` : 'No one guessed it this round.';
  renderScoreboard(els['results-scoreboard'], snapshot.players || [], null);
  els['host-results-actions'].classList.toggle('hidden', app.role !== 'host');
  els['player-results-message'].classList.toggle('hidden', app.role !== 'player');
  els['next-round-button'].textContent = snapshot.round >= snapshot.settings?.roundCount ? 'See final scores' : 'Next round';
}

function renderFinal() {
  const snapshot = app.role === 'host' ? publicSnapshot() : app.view;
  const sorted = [...(snapshot.players || [])].sort((a, b) => b.score - a.score);
  const champion = sorted[0];
  els['champion-card'].textContent = '';
  if (champion) {
    const crown = document.createElement('div'); crown.textContent = '🏆'; crown.setAttribute('aria-hidden', 'true');
    const name = document.createElement('span'); name.className = 'champion-name'; name.textContent = champion.nickname;
    const score = document.createElement('span'); score.textContent = `${champion.score} points`;
    els['champion-card'].append(crown, name, score);
  }
  renderScoreboard(els['final-scoreboard'], sorted, null);
  els['host-final-actions'].classList.toggle('hidden', app.role !== 'host');
  els['player-final-message'].classList.toggle('hidden', app.role !== 'player');
  els['premium-cta'].classList.toggle('hidden', app.role !== 'host' || app.premium);
}

function showWordOptions(words) {
  els['word-options'].textContent = '';
  dedupeWords(words).slice(0, 3).forEach((word) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'word-option-button';
    button.textContent = word;
    button.addEventListener('click', () => {
      sendConn(app.hostConnection, MESSAGE_TYPES.WORD_CHOICE, { word });
      els['word-options'].querySelectorAll('button').forEach((item) => { item.disabled = true; });
    });
    els['word-options'].append(button);
  });
  openModal('word-choice-modal');
}

function handleGuessEvent(payload) {
  if (payload.event) {
    app.view.guesses = [...(app.view.guesses || []), payload.event].slice(-30);
    const player = app.view.players?.find((candidate) => candidate.id === payload.event.playerId);
    if (payload.event.kind === 'correct' && player) player.solved = true;
    renderGuessFeed();
    renderScoreboard(els.scoreboard, app.view.players || [], app.view.drawerId);
    if (payload.event.kind === 'correct') playTone('correct');
  }
  if (payload.message) {
    els['guess-feedback'].textContent = payload.message;
    els['guess-feedback'].className = `guess-feedback ${payload.kind || ''}`;
    if (payload.kind === 'correct') {
      els['guess-input'].disabled = true;
      vibrate([60, 40, 80]);
    }
    setTimeout(() => {
      if (payload.kind !== 'correct') {
        els['guess-feedback'].textContent = '';
        els['guess-feedback'].className = 'guess-feedback';
      }
    }, 2200);
  }
}

function applyRemoteDrawing(type, payload) {
  const drawing = app.localDrawing;
  if (type === MESSAGE_TYPES.DRAW_START) {
    if (drawing.strokes.some((stroke) => stroke.id === payload.id)) return;
    drawing.strokes.push({ id: payload.id, tool: payload.tool, color: payload.color, width: payload.width, points: [payload.point], complete: false });
  } else if (type === MESSAGE_TYPES.DRAW_POINTS) {
    const stroke = drawing.strokes.find((candidate) => candidate.id === payload.id);
    if (stroke) stroke.points.push(...(payload.points || []));
  } else if (type === MESSAGE_TYPES.DRAW_END) {
    const stroke = drawing.strokes.find((candidate) => candidate.id === payload.id);
    if (stroke) stroke.complete = true;
  } else if (type === MESSAGE_TYPES.DRAW_UNDO) {
    drawing.strokes.pop();
  } else if (type === MESSAGE_TYPES.DRAW_CLEAR) {
    drawing.strokes = [];
  }
  renderCanvas();
}

function canvasMetrics() {
  const canvas = els['drawing-canvas'];
  const rect = canvas.getBoundingClientRect();
  const ratio = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  return { canvas, rect, ratio };
}

function resizeCanvas() {
  const { canvas, rect, ratio } = canvasMetrics();
  const width = Math.max(1, Math.round(rect.width * ratio));
  const height = Math.max(1, Math.round(rect.height * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
    renderCanvas();
  }
}

function renderCanvas() {
  const canvas = els['drawing-canvas'];
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const ratio = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  const expectedWidth = Math.round(rect.width * ratio);
  const expectedHeight = Math.round(rect.height * ratio);
  if (canvas.width !== expectedWidth || canvas.height !== expectedHeight) {
    canvas.width = expectedWidth;
    canvas.height = expectedHeight;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, rect.width, rect.height);
  (app.localDrawing.strokes || []).forEach((stroke) => drawStroke(ctx, stroke, rect.width, rect.height));
}

function drawStroke(ctx, stroke, width, height) {
  const points = stroke.points || [];
  if (!points.length) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = stroke.tool === 'eraser' ? '#ffffff' : stroke.color;
  ctx.lineWidth = Number(stroke.width) || 7;
  ctx.beginPath();
  const first = points[0];
  ctx.moveTo(first[0] * width, first[1] * height);
  if (points.length === 1) {
    ctx.lineTo(first[0] * width + 0.01, first[1] * height + 0.01);
  } else {
    for (let index = 1; index < points.length; index += 1) {
      const current = points[index];
      const previous = points[index - 1];
      const midX = ((previous[0] + current[0]) / 2) * width;
      const midY = ((previous[1] + current[1]) / 2) * height;
      ctx.quadraticCurveTo(previous[0] * width, previous[1] * height, midX, midY);
    }
  }
  ctx.stroke();
  ctx.restore();
}

function pointerToPoint(event) {
  const rect = els['drawing-canvas'].getBoundingClientRect();
  const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
  const pressure = Number.isFinite(event.pressure) && event.pressure > 0 ? event.pressure : 0.5;
  return [Number(x.toFixed(5)), Number(y.toFixed(5)), Number(pressure.toFixed(2)), Date.now() % 1000000];
}

function isCurrentDrawer() {
  const snapshot = app.role === 'host' ? publicSnapshot() : app.view;
  return app.role === 'player' && app.playerId === snapshot.drawerId && snapshot.phase === STATES.ROUND_ACTIVE && !snapshot.paused;
}

function beginStroke(event) {
  if (!isCurrentDrawer()) return;
  event.preventDefault();
  const canvas = els['drawing-canvas'];
  canvas.setPointerCapture?.(event.pointerId);
  const point = pointerToPoint(event);
  const stroke = {
    id: `s_${randomId(10)}`,
    tool: app.drawingTool.tool,
    color: app.drawingTool.color,
    width: app.drawingTool.tool === 'eraser' ? app.drawingTool.width * 2.2 : app.drawingTool.width,
    points: [point],
    complete: false,
  };
  app.activeStroke = stroke;
  app.pendingPoints = [];
  app.lastPointerPoint = point;
  app.localDrawing.strokes.push(stroke);
  sendConn(app.hostConnection, MESSAGE_TYPES.DRAW_START, {
    id: stroke.id,
    tool: stroke.tool,
    color: stroke.color,
    width: stroke.width,
    point,
  });
  renderCanvas();
}

function continueStroke(event) {
  if (!app.activeStroke || !isCurrentDrawer()) return;
  event.preventDefault();
  const point = pointerToPoint(event);
  const previous = app.lastPointerPoint;
  const dx = point[0] - previous[0];
  const dy = point[1] - previous[1];
  if (Math.hypot(dx, dy) < 0.0012) return;
  app.lastPointerPoint = point;
  app.activeStroke.points.push(point);
  app.pendingPoints.push(point);
  renderCanvas();
  if (!app.pointFlushTimer) {
    app.pointFlushTimer = setTimeout(flushStrokePoints, 34);
  }
}

function flushStrokePoints() {
  clearTimeout(app.pointFlushTimer);
  app.pointFlushTimer = null;
  if (!app.activeStroke || !app.pendingPoints.length) return;
  const points = app.pendingPoints.splice(0, 48);
  sendConn(app.hostConnection, MESSAGE_TYPES.DRAW_POINTS, { id: app.activeStroke.id, points });
  if (app.pendingPoints.length) app.pointFlushTimer = setTimeout(flushStrokePoints, 20);
}

function endStroke(event) {
  if (!app.activeStroke) return;
  event?.preventDefault();
  flushStrokePoints();
  sendConn(app.hostConnection, MESSAGE_TYPES.DRAW_END, { id: app.activeStroke.id });
  app.activeStroke.complete = true;
  app.activeStroke = null;
  app.lastPointerPoint = null;
}

function undoDrawing() {
  if (!isCurrentDrawer()) return;
  app.localDrawing.strokes.pop();
  sendConn(app.hostConnection, MESSAGE_TYPES.DRAW_UNDO, {});
  renderCanvas();
}

function clearDrawing() {
  if (!isCurrentDrawer()) return;
  if (!window.confirm('Clear the entire drawing?')) return;
  app.localDrawing.strokes = [];
  sendConn(app.hostConnection, MESSAGE_TYPES.DRAW_CLEAR, {});
  renderCanvas();
}

async function requestWakeLock() {
  if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
  try {
    app.wakeLock = await navigator.wakeLock.request('screen');
    app.wakeLock.addEventListener('release', () => { app.wakeLock = null; });
  } catch { /* optional API */ }
}

async function releaseWakeLock() {
  try { await app.wakeLock?.release(); } catch { /* ignored */ }
  app.wakeLock = null;
}

function playTone(kind) {
  if (!app.preferences.sound) return;
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    const context = new AudioContextClass();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const map = { start: [520, .12], correct: [760, .16], end: [330, .15], win: [880, .24] };
    const [frequency, duration] = map[kind] || [440, .1];
    oscillator.frequency.value = frequency;
    oscillator.type = 'sine';
    gain.gain.setValueAtTime(0.001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.15, context.currentTime + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + duration);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + duration + .02);
    oscillator.addEventListener('ended', () => context.close());
  } catch { /* optional feedback */ }
}

function vibrate(pattern) {
  if (app.preferences.vibration && navigator.vibrate) navigator.vibrate(pattern);
}

async function toggleFullscreen() {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
    else await document.exitFullscreen();
  } catch {
    toast('Fullscreen was not allowed by this browser.');
  }
}

// AIDEV-TODO: Replace this local mock with server-side Lemon Squeezy or Stripe
// license verification. Never embed a production verification secret in this app.
export async function validateLicense(key) {
  await new Promise((resolve) => setTimeout(resolve, 650));
  const normalized = String(key || '').trim().toUpperCase();
  const valid = normalized === 'DRAWRELAY-PREMIUM' || /^DR-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(normalized);
  return { valid, licenseId: valid ? `local-${normalized.slice(-6)}` : null, status: valid ? 'active' : 'invalid' };
}

function renderPremium() {
  app.premium = Boolean(storage.getLicense()?.valid);
  els['premium-status'].textContent = app.premium ? 'Unlocked' : 'Premium';
  els['unlock-premium-button'].textContent = app.premium ? 'Unlocked' : 'Unlock';
  els['unlock-premium-button'].disabled = app.premium;
  els['kit-controls'].classList.toggle('locked', !app.premium);
  loadKits();
}

async function saveCurrentKit() {
  if (!app.premium) {
    openModal('license-modal');
    return;
  }
  const name = sanitizeNickname(window.prompt('Name this Game Night Kit:', 'Family Game Night') || '');
  if (!name) return;
  const settings = app.role === 'host' ? app.game.settings : defaultSettings;
  const kit = {
    id: crypto.randomUUID?.() || `kit-${Date.now()}`,
    name,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    settings: {
      roundCount: settings.roundCount,
      roundSeconds: settings.roundSeconds,
      drawerMode: settings.drawerMode,
      wordPack: settings.wordPack,
      customWords: dedupeWords(settings.customWords || []),
    },
    preferences: { ...app.preferences },
    theme: 'classic-violet',
  };
  try {
    await storage.saveKit(kit);
    toast('Game Night Kit saved.');
    closeModal('settings-modal');
    await loadKits();
  } catch (error) {
    showError('Could not save the kit', error.message, 'Close', () => closeModal('error-modal'));
  }
}

async function loadKits() {
  if (!els['kits-list'] || !app.premium) {
    if (els['kits-list']) els['kits-list'].textContent = '';
    return;
  }
  try {
    const kits = await storage.listKits();
    els['kits-list'].textContent = '';
    if (!kits.length) {
      const empty = document.createElement('p');
      empty.className = 'field-help';
      empty.textContent = 'No saved kits on this device yet.';
      els['kits-list'].append(empty);
      return;
    }
    kits.sort((a, b) => b.updatedAt - a.updatedAt).forEach((kit) => {
      const row = document.createElement('div');
      row.className = 'kit-row';
      const info = document.createElement('div');
      const name = document.createElement('strong'); name.textContent = kit.name;
      const meta = document.createElement('div'); meta.className = 'field-help'; meta.textContent = `${kit.settings.roundCount} rounds · ${kit.settings.roundSeconds}s`;
      info.append(name, meta);
      const actions = document.createElement('div'); actions.className = 'kit-actions';
      const use = document.createElement('button'); use.type = 'button'; use.textContent = 'Use'; use.addEventListener('click', () => applyKit(kit));
      const exportButton = document.createElement('button'); exportButton.type = 'button'; exportButton.textContent = 'Export'; exportButton.addEventListener('click', () => exportKit(kit));
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Delete'; remove.addEventListener('click', async () => {
        if (!window.confirm(`Delete “${kit.name}”?`)) return;
        await storage.deleteKit(kit.id);
        loadKits();
      });
      actions.append(use, exportButton, remove);
      row.append(info, actions);
      els['kits-list'].append(row);
    });
  } catch {
    els['kits-list'].textContent = '';
  }
}

function applyKit(kit) {
  if (app.role === 'host') {
    app.game.settings = { ...defaultSettings, ...kit.settings, customWords: dedupeWords(kit.settings.customWords || []) };
  }
  app.preferences = { ...app.preferences, ...kit.preferences };
  applyPreferences();
  renderLobby();
  persistHostSession();
  closeModal('settings-modal');
  toast(`Loaded ${kit.name}`);
}

async function exportKit(kit) {
  const passphrase = window.prompt('Create an export passphrase (at least 6 characters):');
  if (!passphrase) return;
  try {
    const encrypted = await encryptKit(kit, passphrase);
    const blob = new Blob([JSON.stringify(encrypted, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${kit.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'drawrelay-kit'}.drawrelay`;
    anchor.click();
    URL.revokeObjectURL(url);
    toast('Encrypted kit exported.');
  } catch (error) {
    toast(error.message, 4000);
  }
}

async function importKitFile(file) {
  if (!app.premium || !file) return;
  const passphrase = window.prompt('Enter the kit export passphrase:');
  if (!passphrase) return;
  try {
    const encrypted = JSON.parse(await file.text());
    const kit = await decryptKit(encrypted, passphrase);
    kit.id = crypto.randomUUID?.() || `kit-${Date.now()}`;
    kit.name = sanitizeNickname(kit.name) || 'Imported Kit';
    kit.updatedAt = Date.now();
    kit.settings = { ...defaultSettings, ...kit.settings, customWords: dedupeWords(kit.settings?.customWords || []) };
    await storage.saveKit(kit);
    await loadKits();
    toast('Encrypted kit imported.');
  } catch (error) {
    toast(error.message, 5000);
  } finally {
    els['kit-file-input'].value = '';
  }
}

function bindEvents() {
  els['brand-button'].addEventListener('click', () => {
    if (app.role !== 'none' && !window.confirm('Leave the current room?')) return;
    resetApp();
  });
  els['create-room-button'].addEventListener('click', () => createRoom());
  els['join-room-form'].addEventListener('submit', (event) => {
    event.preventDefault();
    const code = normalizeRoomCode(els['room-code-input'].value);
    els['room-code-input'].value = code;
    showJoinScreen(code);
  });
  els['room-code-input'].addEventListener('input', (event) => { event.target.value = normalizeRoomCode(event.target.value); });
  els['nickname-form'].addEventListener('submit', (event) => {
    event.preventDefault();
    const nickname = sanitizeNickname(els['nickname-input'].value);
    localStorage.setItem('drawrelay:lastNickname', nickname);
    joinRoom(app.roomCode, nickname);
  });
  document.querySelectorAll('[data-action="home"]').forEach((button) => button.addEventListener('click', resetApp));
  els['settings-button'].addEventListener('click', () => { renderPremium(); openModal('settings-modal'); });
  document.querySelectorAll('[data-close-modal]').forEach((button) => button.addEventListener('click', () => closeModal(button.dataset.closeModal)));
  document.querySelectorAll('.modal').forEach((modal) => modal.addEventListener('click', (event) => {
    if (event.target === modal && !['word-choice-modal', 'error-modal'].includes(modal.id)) closeModal(modal.id);
  }));
  els['copy-code-button'].addEventListener('click', () => copyText(app.roomCode, 'Room code copied'));
  els['copy-link-button'].addEventListener('click', () => copyText(getJoinUrl(), 'Invite link copied'));
  els['share-room-button'].addEventListener('click', async () => {
    const data = { title: 'Join my DrawRelay game', text: `Join room ${app.roomCode}`, url: getJoinUrl() };
    if (navigator.share) {
      try { await navigator.share(data); } catch { /* user cancelled */ }
    } else copyText(getJoinUrl(), 'Invite link copied');
  });
  els['fullscreen-lobby-button'].addEventListener('click', toggleFullscreen);
  els['fullscreen-game-button'].addEventListener('click', toggleFullscreen);
  ['round-count-select', 'round-seconds-select', 'drawer-mode-select', 'word-pack-select'].forEach((id) => {
    els[id].addEventListener('change', () => {
      if (app.role !== 'host') return;
      app.game.settings.roundCount = Number(els['round-count-select'].value);
      app.game.settings.roundSeconds = Number(els['round-seconds-select'].value);
      app.game.settings.drawerMode = els['drawer-mode-select'].value;
      app.game.settings.wordPack = els['word-pack-select'].value;
      persistHostSession();
    });
  });
  els['custom-words-input'].addEventListener('input', () => {
    if (app.role !== 'host') return;
    app.game.settings.customWords = dedupeWords(els['custom-words-input'].value.split('\n'));
    persistHostSession();
  });
  els['start-game-button'].addEventListener('click', startGame);
  els['pause-round-button'].addEventListener('click', pauseRound);
  els['skip-round-button'].addEventListener('click', () => {
    if (window.confirm('End this round now?')) endRound('host');
  });
  els['next-round-button'].addEventListener('click', nextRound);
  els['rematch-button'].addEventListener('click', rematch);
  els['new-room-button'].addEventListener('click', () => {
    if (app.roomCode) storage.clearHostSession(app.roomCode);
    destroyPeer();
    createRoom();
  });
  els['guess-form'].addEventListener('submit', (event) => {
    event.preventDefault();
    const guess = String(els['guess-input'].value || '').trim();
    if (!guess) return;
    sendConn(app.hostConnection, MESSAGE_TYPES.GUESS, { guess });
    els['guess-input'].value = '';
    els['guess-input'].focus();
  });
  document.querySelectorAll('[data-tool]').forEach((button) => button.addEventListener('click', () => {
    app.drawingTool.tool = button.dataset.tool;
    document.querySelectorAll('[data-tool]').forEach((item) => { item.classList.toggle('active', item === button); item.setAttribute('aria-pressed', String(item === button)); });
  }));
  document.querySelectorAll('[data-color]').forEach((button) => button.addEventListener('click', () => {
    app.drawingTool.color = button.dataset.color;
    app.drawingTool.tool = 'pen';
    document.querySelectorAll('[data-color]').forEach((item) => { item.classList.toggle('active', item === button); item.setAttribute('aria-pressed', String(item === button)); });
    document.querySelectorAll('[data-tool]').forEach((item) => { const active = item.dataset.tool === 'pen'; item.classList.toggle('active', active); item.setAttribute('aria-pressed', String(active)); });
  }));
  els['brush-size-select'].addEventListener('change', () => { app.drawingTool.width = Number(els['brush-size-select'].value); });
  els['undo-button'].addEventListener('click', undoDrawing);
  els['clear-button'].addEventListener('click', clearDrawing);
  const canvas = els['drawing-canvas'];
  canvas.addEventListener('pointerdown', beginStroke);
  canvas.addEventListener('pointermove', continueStroke);
  canvas.addEventListener('pointerup', endStroke);
  canvas.addEventListener('pointercancel', endStroke);
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  window.addEventListener('resize', resizeCanvas);
  bindPreference('large-type-toggle', 'largeType');
  bindPreference('high-contrast-toggle', 'highContrast');
  bindPreference('reduce-motion-toggle', 'reduceMotion');
  bindPreference('sound-toggle', 'sound');
  bindPreference('vibration-toggle', 'vibration');
  els['unlock-premium-button'].addEventListener('click', () => openModal('license-modal'));
  els['save-current-kit-button'].addEventListener('click', saveCurrentKit);
  els['save-kit-cta-button'].addEventListener('click', saveCurrentKit);
  els['import-kit-button'].addEventListener('click', () => app.premium ? els['kit-file-input'].click() : openModal('license-modal'));
  els['kit-file-input'].addEventListener('change', () => importKitFile(els['kit-file-input'].files?.[0]));
  els['license-form'].addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.submitter || els['license-form'].querySelector('button[type="submit"]');
    if (button) button.disabled = true;
    els['license-feedback'].textContent = 'Checking license…';
    const result = await validateLicense(els['license-input'].value);
    if (button) button.disabled = false;
    if (result.valid) {
      storage.saveLicense({ valid: true, licenseId: result.licenseId, verifiedAt: Date.now() });
      app.premium = true;
      els['license-feedback'].textContent = 'Premium unlocked on this device.';
      renderPremium();
      setTimeout(() => { closeModal('license-modal'); openModal('settings-modal'); }, 600);
    } else {
      els['license-feedback'].textContent = 'That license key is not valid.';
    }
  });
  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && app.role !== 'none') requestWakeLock();
  });
  window.addEventListener('beforeunload', () => {
    if (app.role === 'host') persistHostSession();
  });
}

async function registerServiceWorker() {
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    try { await navigator.serviceWorker.register('./sw.js', { scope: './' }); } catch (error) { console.warn('Service worker registration failed', error); }
  }
}

async function init() {
  cacheElements();
  bindEvents();
  applyPreferences();
  updateOnlineStatus();
  renderAll();
  setAppState(STATES.HOME);
  registerServiceWorker();
  const params = new URLSearchParams(location.search);
  const room = normalizeRoomCode(params.get('room'));
  const isHost = params.get('host') === '1';
  if (room && isHost && storage.getHostSession(room)) {
    await createRoom({ restore: true, requestedCode: room });
  } else if (room) {
    showJoinScreen(room);
    const reconnect = storage.getReconnect(room);
    if (reconnect?.nickname && reconnect?.token) joinRoom(room, reconnect.nickname, { automatic: true });
  }
}

init();

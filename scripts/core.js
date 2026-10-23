import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const VERSION = '0.1.0';
export const MAX_PAIRS = 50;
export const MAX_LEDGER = 1000;

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);

/**
 * A terminal opens a Grok chat and stays in it. A call with no terminal, such as
 * one made inside a builder turn, prints a single reply. `--once` and `--chat` override that.
 */
export function launchKind({ tty = false, once = false, chat = false } = {}) {
  if (once && chat) {
    const error = new Error('Use either --once or --chat.');
    error.code = 'launch-conflict';
    throw error;
  }
  if (once) return 'once';
  if (chat) return 'chat';
  return tty ? 'chat' : 'once';
}

const BLOCKED_TOOLS = [
  'Agent',
  'write',
  'search_replace',
  'web_search',
  'web_fetch',
  'image_gen',
  'image_edit',
  'image_to_video',
  'reference_to_video',
  'search_tool',
  'use_tool',
];

/** Args for the fresh Grok process. `chat` is an interactive session. `once` prints one reply. */
export function buildGrokLaunch({
  agent,
  cwd,
  mode = 'run',
  sessionId,
  prompt = '',
  promptPath = '',
  kind = 'once',
  resume = false,
} = {}) {
  const blocked = mode === 'look' ? [...BLOCKED_TOOLS, 'run_terminal_command'] : [...BLOCKED_TOOLS];
  const args = [
    '--no-memory',
    '--no-leader',
    '--agent',
    agent,
    '--cwd',
    cwd,
    '--permission-mode',
    'plan',
    '--disable-web-search',
    '--disallowed-tools',
    blocked.join(','),
  ];
  if (resume) args.push('-r', sessionId);
  else args.push('-s', sessionId);
  if (kind === 'once') {
    args.push(
      '--output-format',
      'json',
      '--max-turns',
      mode === 'look' ? '8' : '16',
      '--verbatim',
      '--prompt-file',
      promptPath,
    );
  } else if (prompt) {
    args.push('--verbatim', prompt);
  }
  return args;
}

/** Flags that never take a value. A following prompt stays positional. */
const BOOLEAN_FLAGS = new Set(['once', 'chat', 'print', 'switch']);

export function parseCli(argv) {
  const flags = {};
  const images = [];
  const thenRead = [];
  const position = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') {
      position.push(...argv.slice(i + 1));
      break;
    }
    if (arg === '--image') {
      images.push(argv[++i]);
      continue;
    }
    if (arg === '--then-read') {
      thenRead.push(argv[++i]);
      continue;
    }
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      if (BOOLEAN_FLAGS.has(key)) {
        flags[key] = true;
        continue;
      }
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next;
        i += 1;
      } else {
        flags[key] = true;
      }
      continue;
    }
    position.push(arg);
  }
  return { position, flags, images, thenRead };
}

/** Grok session ids are time-ordered, so the first 8 characters collide. 13 reaches the next group. */
export function shortId(id) {
  const text = String(id || '').trim();
  return text ? text.slice(0, 13) : 'unknown';
}

export function defaultStore() {
  return {
    version: VERSION,
    pairs: {},
    ledger: [],
    lastOpen: null,
  };
}

export function defaultStorePath(env = process.env, homeDir = os.homedir()) {
  const override = String(env.CYCLOPS_FRESHEYE_GROK_STORE || '').trim();
  if (override) return path.resolve(override);
  const stateRoot = String(env.XDG_STATE_HOME || '').trim() || path.join(homeDir, '.local', 'state');
  return path.join(stateRoot, 'cyclops-fresheye-grok', 'store.json');
}

export function loadStore(storePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return defaultStore();
    const pairs = {};
    if (parsed.pairs && typeof parsed.pairs === 'object' && !Array.isArray(parsed.pairs)) {
      for (const [freshId, entry] of Object.entries(parsed.pairs)) {
        if (
          freshId &&
          entry &&
          typeof entry === 'object' &&
          typeof entry.originId === 'string' &&
          entry.originId.trim() &&
          entry.originId !== freshId
        ) {
          pairs[freshId] = {
            originId: entry.originId.trim(),
            originRoot: typeof entry.originRoot === 'string' ? entry.originRoot : '',
            model: typeof entry.model === 'string' ? entry.model : '',
            mode: typeof entry.mode === 'string' ? entry.mode : 'run',
            promptPreview: typeof entry.promptPreview === 'string' ? entry.promptPreview : '',
            createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : new Date(0).toISOString(),
          };
        }
      }
    }
    const ledger = [];
    if (Array.isArray(parsed.ledger)) {
      for (const item of parsed.ledger.slice(-MAX_LEDGER)) {
        if (item && typeof item === 'object' && typeof item.event === 'string' && typeof item.at === 'string') {
          ledger.push({
            at: item.at,
            event: item.event,
            fromId: typeof item.fromId === 'string' ? item.fromId : '',
            toId: typeof item.toId === 'string' ? item.toId : '',
            originId: typeof item.originId === 'string' ? item.originId : '',
            freshId: typeof item.freshId === 'string' ? item.freshId : '',
            model: typeof item.model === 'string' ? item.model : '',
            mode: typeof item.mode === 'string' ? item.mode : '',
            promptPreview: typeof item.promptPreview === 'string' ? item.promptPreview : '',
            note: typeof item.note === 'string' ? item.note : '',
          });
        }
      }
    }
    const lastOpen =
      parsed.lastOpen &&
      typeof parsed.lastOpen === 'object' &&
      typeof parsed.lastOpen.freshId === 'string'
        ? {
            freshId: parsed.lastOpen.freshId,
            originId: typeof parsed.lastOpen.originId === 'string' ? parsed.lastOpen.originId : '',
          }
        : null;
    return { version: VERSION, pairs: prunePairs(pairs), ledger, lastOpen };
  } catch {
    return defaultStore();
  }
}

export function saveStore(storePath, store) {
  const dir = path.dirname(storePath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const normalized = {
    version: VERSION,
    pairs: prunePairs(store?.pairs || {}),
    ledger: Array.isArray(store?.ledger) ? store.ledger.slice(-MAX_LEDGER) : [],
    lastOpen: store?.lastOpen || null,
  };
  const tmpPath = `${storePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(normalized, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmpPath, storePath);
  return normalized;
}

/** Reload, update, and save under a lock so two opens cannot drop each other's pair. */
export function withStore(storePath, fn) {
  const lockPath = `${storePath}.lock`;
  fs.mkdirSync(path.dirname(storePath), { recursive: true, mode: 0o700 });
  const started = Date.now();
  let fd;
  for (;;) {
    try {
      fd = fs.openSync(lockPath, 'wx', 0o600);
      break;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      let stale = false;
      try {
        stale = Date.now() - fs.statSync(lockPath).mtimeMs > 30000;
      } catch {
        stale = true;
      }
      if (stale) {
        try {
          fs.unlinkSync(lockPath);
        } catch {
          // Another waiter removed it.
        }
        continue;
      }
      if (Date.now() - started > 5000) {
        const busy = new Error('FreshEye store is busy.');
        busy.code = 'store-lock';
        throw busy;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
  try {
    const store = loadStore(storePath);
    const result = fn(store);
    saveStore(storePath, store);
    return result;
  } finally {
    fs.closeSync(fd);
    try {
      fs.unlinkSync(lockPath);
    } catch {
      // The lock is best-effort. The next waiter treats a stale file as free.
    }
  }
}

/** Warm amber, so the mark is not the same grey as the shortcut row or Rift's cool colours. */
const FRESHEYE_MARK = '\x1b[1;38;2;255;186;64m';
const FRESHEYE_RESET = '\x1b[0m';

/** One status row. Rift already uses the line budget, so this stays a single mark. */
export function buildGrokStatusLine(store, sessionId, agentName = '') {
  const id = String(sessionId || '').trim();
  if (!id) return '';
  const pair = store?.pairs?.[id];
  const agent = String(agentName || '').trim();
  if (!pair && agent !== 'fresheye') return '';
  const origin = String(pair?.originId || '').trim();
  const originMark = origin.includes('-') ? ` · original ${shortId(origin)} kept` : '';
  return `${FRESHEYE_MARK}◎ FreshEye · Fresh Context (${shortId(id)})${originMark}${FRESHEYE_RESET}`;
}

export function readSessionAgentName(cwd, sessionId, homeDir = os.homedir()) {
  const id = String(sessionId || '').trim();
  const dir = String(cwd || '').trim();
  if (!id || !dir) return '';
  const file = path.join(homeDir, '.grok', 'sessions', encodeURIComponent(dir), id, 'summary.json');
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    const name = parsed?.agent_name || parsed?.agent?.name || '';
    return typeof name === 'string' ? name.trim() : '';
  } catch {
    return '';
  }
}

/** Keep Rift's lines. Add the FreshEye mark on the last line once five lines are already used. */
export function stackStatusLines(riftStdout, freshLine) {
  const mark = String(freshLine || '').trim();
  const text = String(riftStdout || '');
  if (!mark) return text;
  const lines = text.split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  if (lines.length >= 5) lines[lines.length - 1] = `${lines[lines.length - 1]}  ${mark}`;
  else lines.push(mark);
  return `${lines.join('\n')}\n`;
}

export function prunePairs(pairs, maxPairs = MAX_PAIRS) {
  const entries = Object.entries(pairs || {}).filter(
    ([freshId, entry]) =>
      Boolean(freshId) &&
      entry &&
      typeof entry === 'object' &&
      typeof entry.originId === 'string' &&
      Boolean(entry.originId.trim()) &&
      entry.originId !== freshId,
  );
  entries.sort((a, b) => (Date.parse(b[1].createdAt || '') || 0) - (Date.parse(a[1].createdAt || '') || 0));
  return Object.fromEntries(entries.slice(0, maxPairs));
}

/** A FreshEye opened from another FreshEye stays paired to the true original. */
export function originFor(pairs, currentId) {
  const id = String(currentId || '').trim();
  if (!id) return '';
  const existing = pairs?.[id];
  if (existing && typeof existing.originId === 'string' && existing.originId.trim()) {
    return existing.originId.trim();
  }
  return id;
}

/** Where status would point from currentId. Null when this id has no pair. */
export function pickTarget(pairs, currentId) {
  const id = String(currentId || '').trim();
  if (!id || !pairs || typeof pairs !== 'object') return null;

  const currentPair = pairs[id];
  if (currentPair && currentPair.originId && currentPair.originId !== id) {
    return { direction: 'return', targetId: currentPair.originId, freshId: id, pair: currentPair };
  }

  let newestFreshId = '';
  let newestPair = null;
  let newestTime = -1;
  for (const [freshId, entry] of Object.entries(pairs)) {
    if (!entry || entry.originId !== id || freshId === id) continue;
    const ts = Date.parse(entry.createdAt || '') || 0;
    if (ts >= newestTime) {
      newestTime = ts;
      newestFreshId = freshId;
      newestPair = entry;
    }
  }
  if (newestFreshId && newestPair) {
    return { direction: 'enter', targetId: newestFreshId, freshId: newestFreshId, pair: newestPair };
  }
  return null;
}

export function appendLedger(ledger, entry, maxEntries = MAX_LEDGER) {
  const list = Array.isArray(ledger) ? ledger : [];
  if (!entry || typeof entry !== 'object' || typeof entry.event !== 'string') return list.slice(-maxEntries);
  list.push({
    at: typeof entry.at === 'string' && entry.at ? entry.at : new Date().toISOString(),
    event: entry.event,
    fromId: typeof entry.fromId === 'string' ? entry.fromId : '',
    toId: typeof entry.toId === 'string' ? entry.toId : '',
    originId: typeof entry.originId === 'string' ? entry.originId : '',
    freshId: typeof entry.freshId === 'string' ? entry.freshId : '',
    model: typeof entry.model === 'string' ? entry.model : '',
    mode: typeof entry.mode === 'string' ? entry.mode : '',
    promptPreview:
      typeof entry.promptPreview === 'string' ? entry.promptPreview.replace(/\s+/g, ' ').trim().slice(0, 80) : '',
    note: typeof entry.note === 'string' ? entry.note.replace(/\s+/g, ' ').trim().slice(0, 160) : '',
  });
  return list.length > maxEntries ? list.slice(-maxEntries) : list;
}

export function recordOpenPair(
  store,
  { freshId, originId, originRoot = '', model = '', prompt = '', mode = 'run', createdAt } = {},
) {
  const fId = String(freshId || '').trim();
  const rawOrigin = String(originId || '').trim();
  const nowIso = createdAt || new Date().toISOString();
  const preview = String(prompt || '').trim().replace(/\s+/g, ' ').slice(0, 80);

  if (!fId || !rawOrigin || fId === rawOrigin) {
    store.ledger = appendLedger(store.ledger, {
      at: nowIso,
      event: 'open-failed',
      fromId: rawOrigin,
      originId: rawOrigin,
      freshId: fId,
      model,
      mode,
      promptPreview: preview,
      note: !fId ? 'missing freshId' : !rawOrigin ? 'missing originId' : 'session id did not change',
    });
    return { ok: false, reason: 'invalid-ids' };
  }

  const trueOriginId = originFor(store.pairs, rawOrigin);
  if (!trueOriginId || trueOriginId === fId) {
    store.ledger = appendLedger(store.ledger, {
      at: nowIso,
      event: 'open-failed',
      fromId: rawOrigin,
      originId: trueOriginId,
      freshId: fId,
      model,
      mode,
      promptPreview: preview,
      note: 'resolved origin matches fresh id',
    });
    return { ok: false, reason: 'origin-equals-fresh' };
  }

  if (store.pairs[fId] && store.pairs[fId].originId === trueOriginId) {
    return { ok: true, pair: store.pairs[fId], duplicate: true };
  }

  const pairEntry = {
    originId: trueOriginId,
    originRoot,
    model,
    mode,
    promptPreview: preview,
    createdAt: nowIso,
  };
  store.pairs[fId] = pairEntry;
  store.pairs = prunePairs(store.pairs);
  store.lastOpen = { freshId: fId, originId: trueOriginId };
  store.ledger = appendLedger(store.ledger, {
    at: nowIso,
    event: 'open',
    fromId: rawOrigin,
    toId: fId,
    originId: trueOriginId,
    freshId: fId,
    model,
    mode,
    promptPreview: preview,
    note: mode,
  });
  return { ok: true, pair: pairEntry, duplicate: false };
}

export function formatStamp(iso) {
  const ts = Date.parse(iso || '');
  if (!ts) return 'unknown-time';
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatLedger(ledger, limit = 20) {
  const list = Array.isArray(ledger) ? ledger : [];
  if (list.length === 0) {
    return 'FreshEye ledger is empty. Open one with: grok-fresheye "your prompt"';
  }
  const count = Math.max(1, Math.min(200, Number(limit) || 20));
  const recent = list.slice(-count).reverse();
  const lines = [`FreshEye ledger (newest first, ${recent.length} of ${list.length}):`];
  for (const item of recent) {
    const ids = [shortId(item.originId || item.fromId), shortId(item.freshId || item.toId)].filter((id) => id !== 'unknown');
    lines.push(
      `${formatStamp(item.at)}  ${item.event}  ${ids.join(' -> ') || '—'}${item.promptPreview ? `  ${item.promptPreview}` : ''}${item.note ? `  (${item.note})` : ''}`,
    );
  }
  return lines.join('\n');
}

export function formatStatus(target, currentId) {
  if (!target) {
    return `No FreshEye pair for ${shortId(currentId)}. Open one with: grok-fresheye "your prompt"`;
  }
  if (target.direction === 'return') {
    return [
      `◎ FreshEye ${shortId(target.freshId)} is paired to original ${shortId(target.targetId)}.`,
      'This Grok window stays here. Resume the original with: grok -r ' + target.targetId,
    ].join('\n');
  }
  return [
    `◎ Original ${shortId(currentId)} has FreshEye ${shortId(target.freshId)} (${target.pair?.mode || 'run'}, ${formatStamp(target.pair?.createdAt)}).`,
    `Resume it with: grok-fresheye resume`,
    target.pair?.promptPreview ? `Prompt: ${target.pair.promptPreview}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Prompt for a Chroma / Electric Eye look.
 * Carries the question and the picture paths. Does not carry a verdict.
 * Refuses source.png: that file is the colour-field input, not the rendered projection.
 */
export function buildChromaLookPrompt({ question, images, thenRead = [] } = {}) {
  const asked = String(question || '').trim();
  if (!asked) {
    const error = new Error('A look needs a question.');
    error.code = 'question-required';
    throw error;
  }
  if (!Array.isArray(images) || images.length === 0) {
    const error = new Error('A look needs at least one image.');
    error.code = 'images-required';
    throw error;
  }

  const pictures = [];
  for (const image of images) {
    const file = path.resolve(String(image || ''));
    const base = path.basename(file);
    if (base === 'source.png') {
      const error = new Error(`Refusing ${file}. source.png is the colour-field input, not the rendered projection.`);
      error.code = 'source-png';
      throw error;
    }
    const ext = path.extname(base).toLowerCase();
    if (!IMAGE_EXT.has(ext)) {
      const error = new Error(`Refusing ${file}. A look image must be png, jpg, jpeg, webp, or gif.`);
      error.code = 'not-image';
      throw error;
    }
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      const error = new Error(`Image not found: ${file}`);
      error.code = 'missing-image';
      throw error;
    }
    pictures.push(file);
  }

  const extras = [];
  for (const extra of thenRead) {
    const file = path.resolve(String(extra || ''));
    if (path.basename(file) === 'source.png') {
      const error = new Error(`Refusing to add ${file} as a follow-up read.`);
      error.code = 'source-png';
      throw error;
    }
    extras.push(file);
  }

  const lines = [
    'Look at these rendered projection images in the order given.',
    'Open each one with your read tool and look at the picture. The picture is the observation.',
    'A directory listing, a JSON sidecar, dimensions printed as text, or any file named source.png is not the projection.',
    'Say what stays put across the images and what changes.',
    'When a change could be the camera, a transform of the drawing, or the colour field itself, say unknown.',
    'Do not open findings, transcripts, memory notes, or instruction files unless a path is listed under "You may read".',
    '',
    'Question:',
    asked,
    '',
    'Images, in order:',
    ...pictures.map((file) => `- ${file}`),
  ];
  if (extras.length) {
    lines.push('', 'You may read these paths only after you have written what you see:', ...extras.map((file) => `- ${file}`));
  }
  return lines.join('\n');
}

/** Markers that mean a system prompt still carries the builder's memory or home rules. */
export function promptLeakReport(systemPrompt) {
  const text = String(systemPrompt || '');
  const checks = [
    ['memory-context', text.includes('<memory-context>') || text.includes('Workspace memory index')],
    ['hamster-wheel-memory', text.includes('hamster-wheel')],
    ['home-agents', text.includes('Cyclops — Shared Machine Rules')],
    ['agents-md-attached', /<agents_md>|AGENTS\.md instructions/i.test(text) && text.includes('Shared Machine Rules')],
  ];
  return {
    leaked: checks.filter(([, hit]) => hit).map(([name]) => name),
    clean: checks.every(([, hit]) => !hit),
  };
}

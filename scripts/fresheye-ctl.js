#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  appendLedger,
  buildChromaLookPrompt,
  buildGrokLaunch,
  defaultStorePath,
  formatLedger,
  formatStatus,
  launchKind,
  loadStore,
  parseCli,
  pickTarget,
  recordOpenPair,
  shortId,
  withStore,
} from './core.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AGENT = path.join(ROOT, 'agents', 'fresheye.md');

const CHAT_PROMPT_LIMIT = 100_000;

function originIdFrom(flags) {
  const explicit = String(flags.origin || '').trim();
  if (explicit) return explicit;
  return String(process.env.GROK_SESSION_ID || '').trim();
}

function cwdFrom(flags) {
  const requested = String(flags.cwd || process.cwd()).trim();
  return path.resolve(requested);
}

function sessionDir(cwd, sessionId, homeDir = os.homedir()) {
  return path.join(homeDir, '.grok', 'sessions', encodeURIComponent(cwd), sessionId);
}

function freshEnv() {
  const env = {
    ...process.env,
    GROK_MEMORY: '0',
    GROK_CLAUDE_AGENTS_ENABLED: '0',
    GROK_CLAUDE_RULES_ENABLED: '0',
    GROK_CLAUDE_SKILLS_ENABLED: '0',
    GROK_CLAUDE_HOOKS_ENABLED: '0',
    GROK_CLAUDE_MCPS_ENABLED: '0',
    GROK_CURSOR_AGENTS_ENABLED: '0',
    GROK_CURSOR_RULES_ENABLED: '0',
    GROK_CURSOR_SKILLS_ENABLED: '0',
    GROK_CURSOR_HOOKS_ENABLED: '0',
    GROK_CURSOR_MCPS_ENABLED: '0',
  };
  delete env.GROK_SESSION_ID;
  delete env.GROK_AGENT;
  return env;
}

function writePrompt(prompt) {
  const stateDir = path.dirname(defaultStorePath());
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const promptPath = path.join(stateDir, 'last-prompt.txt');
  fs.writeFileSync(promptPath, prompt, { mode: 0o600 });
  return promptPath;
}

function hasTTY() {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

function runOnce(prompt, { cwd, mode, sessionId }) {
  const promptPath = writePrompt(prompt);
  const args = buildGrokLaunch({
    agent: AGENT,
    cwd,
    mode,
    sessionId,
    promptPath,
    kind: 'once',
  });
  const result = spawnSync('grok', args, {
    cwd,
    env: freshEnv(),
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    timeout: 180000,
  });
  return { ...result, promptPath };
}

function grokArgs(cwd, sessionId, { mode, prompt = '', resume = false } = {}) {
  return buildGrokLaunch({
    agent: AGENT,
    cwd,
    mode,
    sessionId,
    prompt,
    kind: 'chat',
    resume,
  });
}

function parseGrokJson(stdout) {
  const text = String(stdout || '').trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function commitPair(fields) {
  return withStore(defaultStorePath(), (store) => recordOpenPair(store, fields));
}

function forgetUnstarted(sessionId, note) {
  withStore(defaultStorePath(), (store) => {
    if (store.pairs[sessionId]) delete store.pairs[sessionId];
    if (store.lastOpen?.freshId === sessionId) store.lastOpen = null;
    store.ledger = appendLedger(store.ledger, {
      event: 'open-failed',
      freshId: sessionId,
      note,
    });
  });
}

function openChat(prompt, { cwd, originId, mode }) {
  if (Buffer.byteLength(prompt) > CHAT_PROMPT_LIMIT) {
    process.stderr.write('That prompt is too long for an interactive chat. Run the same command with --once.\n');
    process.exitCode = 1;
    return;
  }
  const sessionId = crypto.randomUUID();
  const recorded = commitPair({
    freshId: sessionId,
    originId,
    originRoot: cwd,
    prompt,
    mode,
  });
  if (!recorded.ok) {
    process.stderr.write('FreshEye could not record the new chat.\n');
    process.exitCode = 1;
    return;
  }
  writePrompt(prompt);
  const kept = shortId(recorded.pair?.originId || originId);
  process.stderr.write(
    `◎ FreshEye · opening chat ${sessionId} (original ${kept} kept). Follow up in this chat. Another terminal: grok-fresheye status\n`,
  );
  const child = spawnSync('grok', grokArgs(cwd, sessionId, { mode, prompt }), {
    cwd,
    env: freshEnv(),
    stdio: 'inherit',
  });
  const started = fs.existsSync(sessionDir(cwd, sessionId));
  if (child.error || (child.status && !started)) {
    const note = child.error ? child.error.message : `grok exit ${child.status}`;
    forgetUnstarted(sessionId, note);
    process.stderr.write(`\n◎ FreshEye did not open a chat. ${note}\n`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = child.status || 0;
}

function openOnce(prompt, { cwd, originId, mode }) {
  const sessionId = crypto.randomUUID();
  const result = runOnce(prompt, { cwd, mode, sessionId });
  const payload = parseGrokJson(result.stdout);
  const freshId = String(payload?.sessionId || payload?.session_id || '').trim();
  const reply = typeof payload?.text === 'string' ? payload.text.trim() : '';

  if (result.error || result.status !== 0 || !freshId || !reply) {
    const note = result.error
      ? result.error.message
      : `grok exit ${result.status}; ${String(result.stderr || '').trim().slice(0, 140)}`;
    commitPair({ freshId, originId, originRoot: cwd, prompt, mode });
    process.stderr.write(String(result.stderr || ''));
    if (result.stdout && !payload) process.stderr.write(String(result.stdout).slice(0, 2000));
    process.stderr.write(`\n◎ FreshEye did not return a review. ${note}\n`);
    process.exitCode = 1;
    return;
  }

  const recorded = commitPair({
    freshId,
    originId,
    originRoot: cwd,
    model: typeof payload.model === 'string' ? payload.model : '',
    prompt,
    mode,
  });
  const header = `◎ FreshEye · Fresh Context (${shortId(freshId)} · original ${shortId(recorded.pair?.originId || originId)} kept)`;
  process.stdout.write(`${header}\n\n${reply}\n\nResume: grok-fresheye resume --id ${freshId}\n`);
}

function openFresh(prompt, { cwd, origin, mode, flags }) {
  let kind;
  try {
    kind = launchKind({ tty: hasTTY(), once: flags.once === true, chat: flags.chat === true });
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
    return;
  }
  if (kind === 'chat' && !hasTTY()) {
    process.stderr.write('A chat needs a terminal. Open a new terminal and run the same command there, or pass --once.\n');
    process.exitCode = 1;
    return;
  }
  const originId = origin || `cli-${process.pid}`;
  if (kind === 'chat') {
    openChat(prompt, { cwd, originId, mode });
    return;
  }
  openOnce(prompt, { cwd, originId, mode });
}

function commandStatus(flags) {
  const store = loadStore(defaultStorePath());
  const current = originIdFrom(flags) || store.lastOpen?.originId || '';
  if (!current) {
    process.stdout.write('No FreshEye pair yet. Open one with: grok-fresheye "your prompt"\n');
    return;
  }
  const target = pickTarget(store.pairs, current) || (store.lastOpen ? pickTarget(store.pairs, store.lastOpen.originId) : null);
  process.stdout.write(`${formatStatus(target, current)}\n`);
}

function commandResume(flags) {
  const store = loadStore(defaultStorePath());
  const requested = String(flags.id || '').trim();
  let freshId = requested;
  let pair = requested ? store.pairs[requested] : null;
  if (!freshId) {
    const current = originIdFrom(flags);
    const target = current ? pickTarget(store.pairs, current) : null;
    if (target?.direction === 'enter') {
      freshId = target.freshId;
      pair = target.pair;
    } else if (store.lastOpen?.freshId) {
      freshId = store.lastOpen.freshId;
      pair = store.pairs[freshId];
    }
  }
  if (!freshId || !pair) {
    process.stderr.write('No paired FreshEye session to resume.\n');
    process.exitCode = 1;
    return;
  }
  const cwd = pair.originRoot || cwdFrom(flags);
  const dir = sessionDir(cwd, freshId);
  if (!fs.existsSync(dir)) {
    process.stderr.write(`FreshEye session ${freshId} is not on disk at ${dir}. Nothing was resumed.\n`);
    process.exitCode = 1;
    return;
  }
  const enter = hasTTY() && flags.print !== true;
  if (!enter) {
    process.stdout.write(`${formatResumeCommand(cwd, freshId, pair.mode)}\n`);
    if ((flags.switch || flags.chat) && !hasTTY()) {
      process.stderr.write('A chat needs a terminal. Open a new terminal and run: grok-fresheye resume\n');
      process.exitCode = 1;
    }
    return;
  }
  process.stderr.write(`◎ FreshEye · resuming ${freshId}\n`);
  const child = spawnSync('grok', grokArgs(cwd, freshId, { mode: pair.mode, resume: true }), {
    cwd,
    env: freshEnv(),
    stdio: 'inherit',
  });
  if (child.error) {
    process.stderr.write(`${child.error.message}\n`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = child.status || 0;
}

function formatResumeCommand(cwd, freshId, mode) {
  const args = grokArgs(cwd, freshId, { mode, resume: true }).map(shellQuote).join(' ');
  const envPrefix = [
    'GROK_MEMORY=0',
    'GROK_CLAUDE_AGENTS_ENABLED=0',
    'GROK_CLAUDE_RULES_ENABLED=0',
    'GROK_CLAUDE_SKILLS_ENABLED=0',
    'GROK_CLAUDE_HOOKS_ENABLED=0',
    'GROK_CLAUDE_MCPS_ENABLED=0',
    'GROK_CURSOR_AGENTS_ENABLED=0',
    'GROK_CURSOR_RULES_ENABLED=0',
    'GROK_CURSOR_SKILLS_ENABLED=0',
    'GROK_CURSOR_HOOKS_ENABLED=0',
    'GROK_CURSOR_MCPS_ENABLED=0',
  ].join(' ');
  return `${envPrefix} grok ${args}`;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function main() {
  const { position, flags, images, thenRead } = parseCli(process.argv.slice(2));
  const head = position[0] || '';
  const known = new Set(['status', 'log', 'resume', 'run', 'look']);

  if (!head || head === 'status') {
    commandStatus(flags);
    return;
  }
  if (head === 'log') {
    const store = loadStore(defaultStorePath());
    process.stdout.write(`${formatLedger(store.ledger, position[1] || flags.count || 20)}\n`);
    return;
  }
  if (head === 'resume') {
    commandResume(flags);
    return;
  }
  if (head === 'look') {
    let prompt;
    try {
      prompt = buildChromaLookPrompt({ question: flags.question, images, thenRead });
    } catch (error) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
      return;
    }
    const cwd = flags.cwd ? cwdFrom(flags) : path.dirname(path.resolve(images[0]));
    openFresh(prompt, { cwd, origin: originIdFrom(flags), mode: 'look', flags });
    return;
  }

  let prompt = '';
  if (head === 'run') {
    if (flags['prompt-file']) prompt = fs.readFileSync(flags['prompt-file'], 'utf8');
    else prompt = position.slice(1).join(' ').trim();
  } else if (!known.has(head)) {
    prompt = position.join(' ').trim();
  }
  if (!prompt) {
    process.stderr.write('Give a prompt: grok-fresheye "Review these files."\n');
    process.exitCode = 1;
    return;
  }
  openFresh(prompt, { cwd: cwdFrom(flags), origin: originIdFrom(flags), mode: 'run', flags });
}

main();

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  buildChromaLookPrompt,
  buildGrokLaunch,
  buildGrokStatusLine,
  formatStatus,
  launchKind,
  loadStore,
  originFor,
  parseCli,
  pickTarget,
  promptLeakReport,
  readSessionAgentName,
  recordOpenPair,
  saveStore,
  shortId,
  stackStatusLines,
  withStore,
} from '../scripts/core.js';

const SCRATCH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.tmp-tests');

function scratchDir(name) {
  const dir = path.join(SCRATCH, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

test('boolean flags leave the prompt in place', () => {
  const parsed = parseCli(['--chat', 'review this plugin']);
  assert.equal(parsed.flags.chat, true);
  assert.deepEqual(parsed.position, ['review this plugin']);

  const forced = parseCli(['look', '--once', '--image', 'a.png', '--question', 'What stays put?']);
  assert.equal(forced.flags.once, true);
  assert.deepEqual(forced.position, ['look']);
  assert.deepEqual(forced.images, ['a.png']);
  assert.equal(forced.flags.question, 'What stays put?');
});

test('a terminal opens a chat and a builder turn prints one reply', () => {
  assert.equal(launchKind({ tty: true }), 'chat');
  assert.equal(launchKind({ tty: false }), 'once');
  assert.equal(launchKind({ tty: true, once: true }), 'once');
  assert.equal(launchKind({ tty: false, chat: true }), 'chat');
  assert.throws(() => launchKind({ once: true, chat: true }), /either --once or --chat/);
});

test('a chat launch stays interactive and a one-shot launch does not', () => {
  const chat = buildGrokLaunch({
    agent: '/agent.md',
    cwd: '/work',
    sessionId: '11111111-1111-4111-8111-111111111111',
    prompt: 'review this plugin',
    kind: 'chat',
  });
  assert.ok(chat.includes('-s'));
  assert.ok(chat.includes('review this plugin'));
  assert.equal(chat.includes('--prompt-file'), false);
  assert.equal(chat.includes('--output-format'), false);

  const once = buildGrokLaunch({
    agent: '/agent.md',
    cwd: '/work',
    mode: 'look',
    sessionId: '22222222-2222-4222-8222-222222222222',
    promptPath: '/tmp/prompt.txt',
    kind: 'once',
  });
  assert.ok(once.includes('--prompt-file'));
  assert.ok(once.some((arg) => arg.includes('run_terminal_command')));
  assert.equal(once.includes('--verbatim'), true);

  const again = buildGrokLaunch({
    agent: '/agent.md',
    cwd: '/work',
    sessionId: '33333333-3333-4333-8333-333333333333',
    kind: 'chat',
    resume: true,
  });
  assert.ok(again.includes('-r'));
  assert.equal(again.includes('-s'), false);
});

test('a FreshEye mark stacks on Rift and stays off an ordinary session', () => {
  const store = { pairs: {}, ledger: [], lastOpen: null };
  recordOpenPair(store, {
    freshId: '82625d8f-02d7-4cab-9793-35cb9e498198',
    originId: '01a16aae-1ae4-75d3-a8b0-d63cb540cd72',
    prompt: 'review this plugin for release',
    mode: 'run',
  });
  const marked = buildGrokStatusLine(store, '82625d8f-02d7-4cab-9793-35cb9e498198', '');
  assert.match(marked, /◎ FreshEye · Fresh Context \(82625d8f-02d7\)/);
  assert.match(marked, /original 01a16aae-1ae4 kept/);
  assert.equal(buildGrokStatusLine(store, 'someone-else', ''), '');
  assert.match(buildGrokStatusLine({ pairs: {} }, '82625d8f-02d7-4cab-9793-35cb9e498198', 'fresheye'), /◎ FreshEye/);

  const roomy = stackStatusLines('rift · working\n', marked);
  assert.equal(roomy, `rift · working\n${marked}\n`);
  const full = stackStatusLines('1\n2\n3\n4\nrift · working\n', marked);
  assert.equal(full, `1\n2\n3\n4\nrift · working  ${marked}\n`);
  assert.equal(stackStatusLines('rift · working\n', ''), 'rift · working\n');
});

test('a second open keeps the pair the first open already saved', () => {
  const dir = scratchDir('store-lock');
  const storePath = path.join(dir, 'store.json');
  withStore(storePath, (store) => {
    recordOpenPair(store, { freshId: 'fresh-a', originId: 'origin-a', prompt: 'first', mode: 'run' });
  });
  withStore(storePath, (store) => {
    recordOpenPair(store, { freshId: 'fresh-b', originId: 'origin-b', prompt: 'second', mode: 'run' });
  });
  const loaded = loadStore(storePath);
  assert.equal(loaded.pairs['fresh-a'].originId, 'origin-a');
  assert.equal(loaded.pairs['fresh-b'].originId, 'origin-b');
});

test('the session file names a FreshEye agent when the pair was lost', () => {
  const dir = scratchDir('agent-name');
  const cwd = '/work/demo';
  const id = '82625d8f-02d7-4cab-9793-35cb9e498198';
  const sessionDir = path.join(dir, '.grok', 'sessions', encodeURIComponent(cwd), id);
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.writeFileSync(path.join(sessionDir, 'summary.json'), JSON.stringify({ agent_name: 'fresheye' }));
  assert.equal(readSessionAgentName(cwd, id, dir), 'fresheye');
  assert.equal(readSessionAgentName(cwd, 'missing', dir), '');
});

test('short ids distinguish Grok sessions opened close together', () => {
  assert.notEqual(
    shortId('01a16aba-2b03-7472-8f5f-7567a90bc25d'),
    shortId('01a16aba-d60e-71e1-9e6e-df434b6a1803'),
  );
});

test('a second open from a FreshEye stays paired to the original', () => {
  const store = { pairs: {}, ledger: [], lastOpen: null };
  recordOpenPair(store, { freshId: 'fresh-1', originId: 'origin', prompt: 'first look', mode: 'look' });
  const chained = recordOpenPair(store, { freshId: 'fresh-2', originId: 'fresh-1', prompt: 'second look', mode: 'run' });
  assert.equal(chained.ok, true);
  assert.equal(chained.pair.originId, 'origin');
  assert.equal(originFor(store.pairs, 'fresh-2'), 'origin');
});

test('pickTarget returns to the original or enters the newest FreshEye and does not guess', () => {
  const pairs = {
    'fresh-older': { originId: 'origin-1', createdAt: '2026-10-23T12:00:00.000Z', mode: 'look', promptPreview: 'older' },
    'fresh-newer': { originId: 'origin-1', createdAt: '2026-10-23T12:05:00.000Z', mode: 'look', promptPreview: 'newer' },
  };
  assert.equal(pickTarget(pairs, 'fresh-older').direction, 'return');
  assert.equal(pickTarget(pairs, 'fresh-older').targetId, 'origin-1');
  assert.equal(pickTarget(pairs, 'origin-1').targetId, 'fresh-newer');
  assert.equal(pickTarget(pairs, 'unpaired'), null);
  assert.match(formatStatus(null, 'unpaired'), /No FreshEye pair/);
});

test('recordOpenPair fails closed when the id does not change', () => {
  const store = { pairs: {}, ledger: [], lastOpen: null };
  const result = recordOpenPair(store, { freshId: 'same', originId: 'same', prompt: 'x' });
  assert.equal(result.ok, false);
  assert.equal(store.ledger.at(-1).event, 'open-failed');
  assert.equal(store.pairs.same, undefined);
});

test('a chroma look names the pictures and the question and refuses source.png', () => {
  const dir = scratchDir('look');
  const picture = path.join(dir, 'frame.png');
  const source = path.join(dir, 'source.png');
  fs.writeFileSync(picture, 'png');
  fs.writeFileSync(source, 'png');

  const prompt = buildChromaLookPrompt({
    question: 'What stays put, and what changes?',
    images: [picture],
  });
  assert.match(prompt, /What stays put, and what changes\?/);
  assert.match(prompt, new RegExp(picture.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(prompt, /say unknown/);
  assert.doesNotMatch(prompt, /rings|ripple|HOLD|active_nodes|verdict/i);

  assert.throws(() => buildChromaLookPrompt({ question: 'look', images: [source] }), /source\.png/);
  assert.throws(() => buildChromaLookPrompt({ question: '   ', images: [picture] }), /question/);
});

test('the store round-trips a pair and drops a torn file back to empty', () => {
  const dir = scratchDir('store');
  const storePath = path.join(dir, 'store.json');
  const store = { pairs: {}, ledger: [], lastOpen: null };
  recordOpenPair(store, { freshId: 'fresh-9', originId: 'origin-9', originRoot: '/work', prompt: 'hello', mode: 'run' });
  saveStore(storePath, store);
  const loaded = loadStore(storePath);
  assert.equal(loaded.pairs['fresh-9'].originId, 'origin-9');
  assert.equal(loaded.lastOpen.freshId, 'fresh-9');
  fs.writeFileSync(storePath, '{');
  assert.deepEqual(loadStore(storePath).pairs, {});
});

test('leak report catches a memory index and stays quiet on the FreshEye instructions', () => {
  const leaked = promptLeakReport('prefix <memory-context>\n## Workspace memory index\nhamster-wheel\n');
  assert.equal(leaked.clean, false);
  assert.ok(leaked.leaked.includes('memory-context'));
  const clean = promptLeakReport('Open the image with your read tool. Say unknown when the cause is not in the picture.');
  assert.equal(clean.clean, true);
});

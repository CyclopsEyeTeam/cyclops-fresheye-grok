#!/usr/bin/env node
/**
 * Keep the Cyclops Rift status line, then mark a FreshEye session.
 * Prints Rift's own lines unchanged. Adds the FreshEye mark only when this
 * session is one. An ordinary Grok session stays exactly Rift's row.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildGrokStatusLine, defaultStorePath, loadStore, readSessionAgentName, stackStatusLines } from './core.js';

function riftCommand() {
  const override = String(process.env.CYCLOPS_RIFT_STATUSLINE || '').trim();
  if (override) return override;
  return path.join(os.homedir(), '.grok', 'plugins', 'cyclops-rift', 'rift', 'statusline.py');
}

function readPayload() {
  let raw = '';
  try {
    raw = fs.readFileSync(0, 'utf8');
  } catch {
    raw = '';
  }
  let payload = {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) payload = parsed;
  } catch {
    payload = {};
  }
  return { raw, payload };
}

function riftStdout(raw) {
  const command = riftCommand();
  if (!fs.existsSync(command)) return '';
  try {
    const result = spawnSync(command, { input: raw, encoding: 'utf8', timeout: 8000 });
    return String(result.stdout || '');
  } catch {
    return '';
  }
}

function main() {
  const { raw, payload } = readPayload();
  const sessionId = String(payload.session_id || '').trim();
  const cwd = String(payload.cwd || payload.workspace?.current_dir || '').trim();
  let store = { pairs: {} };
  try {
    store = loadStore(defaultStorePath());
  } catch {
    store = { pairs: {} };
  }
  const agentName = readSessionAgentName(cwd, sessionId);
  const mark = buildGrokStatusLine(store, sessionId, agentName);
  process.stdout.write(stackStatusLines(riftStdout(raw), mark));
}

main();

// Knowledge Base Engine tests (Milestone 5).
// Uses node:test + node:assert/strict against the real seed docs in
// knowledge/ — no mocks, no invented facts.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadKnowledgeBase } from '../../src/kb/index.js';

const KB_DIR = fileURLToPath(new URL('../../knowledge', import.meta.url));

test('discovers the 3 seed docs with title, path, content and verified flag', async () => {
  const kb = await loadKnowledgeBase(KB_DIR);
  assert.equal(kb.docs.length, 3);
  const ids = kb.docs.map((d) => d.id).sort();
  assert.deepEqual(ids, [
    'customer-reply-rules.md',
    'hostarise-background.md',
    'support-playbook.md',
  ]);
  for (const doc of kb.docs) {
    assert.equal(typeof doc.title, 'string');
    assert.ok(doc.title.length > 0, `missing title in ${doc.id}`);
    assert.equal(typeof doc.path, 'string');
    assert.ok(doc.path.endsWith(doc.id), doc.path);
    assert.equal(typeof doc.content, 'string');
    assert.ok(doc.content.length > 0, `empty content in ${doc.id}`);
    // Seed docs are background notes, not verified Hostarise policy.
    assert.equal(doc.verified, false, `${doc.id} must be verified: false`);
  }
  const titles = Object.fromEntries(kb.docs.map((d) => [d.id, d.title]));
  assert.equal(titles['hostarise-background.md'], 'Hostarise Background (UNVERIFIED)');
  assert.equal(titles['customer-reply-rules.md'], 'Customer Reply Rules');
  assert.equal(titles['support-playbook.md'], 'Hosting Support Playbook (General Guidance)');
});

test('search ranking: a query about prices finds hostarise-background first', async () => {
  const kb = await loadKnowledgeBase(KB_DIR);
  const results = kb.search('plans price 719 per year');
  assert.ok(results.length > 0);
  assert.equal(results[0].id, 'hostarise-background.md');
  assert.ok(results[0].score > 0);
  assert.equal(typeof results[0].snippet, 'string');
  assert.ok(results[0].snippet.length > 0);
  assert.ok(results[0].snippet.length <= 200, `snippet too long: ${results[0].snippet.length}`);
  assert.equal(results[0].verified, false);
});

test('search ranking: a query about reply rules finds customer-reply-rules first', async () => {
  const kb = await loadKnowledgeBase(KB_DIR);
  const results = kb.search('Bengali English reply password');
  assert.ok(results.length > 0);
  assert.equal(results[0].id, 'customer-reply-rules.md');
  assert.ok(results[0].score > 0);
  assert.ok(results[0].snippet.length <= 200);
});

test('search respects limit and returns nothing for an empty query', async () => {
  const kb = await loadKnowledgeBase(KB_DIR);
  const results = kb.search('hosting', { limit: 1 });
  assert.equal(results.length, 1);
  assert.deepEqual(kb.search(''), []);
  assert.deepEqual(kb.search('   '), []);
});

test('getDoc returns a doc by id and null for unknown ids', async () => {
  const kb = await loadKnowledgeBase(KB_DIR);
  const doc = kb.getDoc('support-playbook.md');
  assert.ok(doc);
  assert.equal(doc.title, 'Hosting Support Playbook (General Guidance)');
  assert.match(doc.content, /DNS propagation/);
  assert.equal(kb.getDoc('no-such-doc.md'), null);
  assert.equal(kb.getDoc(''), null);
});

test('getDoc rejects paths that escape the KB directory', async () => {
  const kb = await loadKnowledgeBase(KB_DIR);
  assert.equal(kb.getDoc('../SPEC.md'), null);
  assert.equal(kb.getDoc('../../SPEC.md'), null);
  assert.equal(kb.getDoc('/etc/passwd'), null);
  assert.equal(kb.getDoc('subdir/../../SPEC.md'), null);
  // And the escape must not have leaked file content anywhere.
  const doc = kb.getDoc('../SPEC.md');
  assert.equal(doc, null);
});

test('no seed doc claims verified Hostarise facts it does not have', async () => {
  const kb = await loadKnowledgeBase(KB_DIR);
  const background = kb.getDoc('hostarise-background.md');
  assert.ok(background);
  // The background doc labels its spec-sourced facts UNVERIFIED with the
  // 2026-11-01 check date, and warns prices may have changed.
  assert.match(background.content, /UNVERIFIED/);
  assert.match(background.content, /2026-11-01/);
  assert.match(background.content, /may have changed/);
  assert.match(background.content, /ownership/i);
  assert.match(background.content, /NOT confirmed/);
  // No seed doc may claim to be verified Hostarise policy.
  for (const doc of kb.docs) {
    assert.equal(doc.verified, false);
  }
  // The raw files themselves start with the verified: false line.
  for (const id of ['hostarise-background.md', 'customer-reply-rules.md', 'support-playbook.md']) {
    const raw = await fs.readFile(path.join(KB_DIR, id), 'utf8');
    assert.ok(raw.startsWith('verified: false'), `${id} must start with 'verified: false'`);
  }
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

// Minimal DOM stand in: lockPageScroll only reads and writes inline styles
const html = { style: { overflow: '' }, clientWidth: 985 };
const body = { style: { overflow: '', paddingRight: '' } };
(globalThis as Record<string, unknown>).document = { documentElement: html, body };
(globalThis as Record<string, unknown>).window = { innerWidth: 1000 };

const { lockPageScroll } = await import('../src/core/scrollLock.ts');

test('page lock only touches html overflow, never body, so the sticky side panel stays put', () => {
  const unlock = lockPageScroll();
  assert.equal(html.style.overflow, 'hidden');
  assert.equal(body.style.overflow, '', 'body must never get overflow hidden');
  assert.equal(body.style.paddingRight, '15px', 'scrollbar width is compensated');

  unlock();
  assert.equal(html.style.overflow, '');
  assert.equal(body.style.paddingRight, '');
});

test('stacked locks release the page only when the last one closes, and double release is safe', () => {
  const unlockDrawer = lockPageScroll();
  const unlockDialog = lockPageScroll();
  assert.equal(html.style.overflow, 'hidden');

  unlockDrawer();
  assert.equal(html.style.overflow, 'hidden', 'dialog still open, page stays locked');
  unlockDrawer(); // releasing twice must not unlock the dialog
  assert.equal(html.style.overflow, 'hidden');

  unlockDialog();
  assert.equal(html.style.overflow, '');
  assert.equal(body.style.overflow, '');
});

test('no component sets overflow on document.body (that breaks the sticky side panel)', () => {
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry.name) && !full.endsWith('scrollLock.ts')) {
        const text = fs.readFileSync(full, 'utf8');
        if (/body\.style\.overflow(Y|X)?\s*=/.test(text)) offenders.push(full);
      }
    }
  };
  walk(path.join(process.cwd(), 'src'));
  assert.deepEqual(offenders, [], 'use lockPageScroll() from src/core/scrollLock.ts instead');
});

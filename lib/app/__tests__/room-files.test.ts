/**
 * Guardrail , the Back Room file allowlist (lib/app/backroom/room-files.ts).
 *
 * Members may attach non-threatening files only. This locks the invariant that
 * executables, scripts, active-content, and archives are rejected, that the
 * stored MIME is derived from the extension (not the client), and that names
 * are stripped of any path. If someone loosens the allowlist, this fails first.
 *
 * Run via:   npm run test
 * Direct:    node --test --experimental-strip-types lib/app/__tests__/room-files.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkFile, backroomFilePath, MAX_FILE_BYTES } from '../backroom/room-files.ts';

test('accepts an image and marks it as an image object with a derived mime', () => {
  const r = checkFile('holiday.JPG', 2048);
  assert.equal(r.ok, true);
  if (r.ok) { assert.equal(r.object_type, 'image'); assert.equal(r.mime, 'image/jpeg'); }
});

test('accepts common documents as file objects', () => {
  for (const [name, mime] of [
    ['brief.pdf', 'application/pdf'],
    ['deck.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
    ['notes.txt', 'text/plain'],
    ['sheet.csv', 'text/csv'],
  ] as const) {
    const r = checkFile(name, 1000);
    assert.equal(r.ok, true, name);
    if (r.ok) { assert.equal(r.object_type, 'file'); assert.equal(r.mime, mime); }
  }
});

test('rejects every executable / script / active-content / archive type', () => {
  for (const bad of [
    'malware.exe', 'run.bat', 'go.cmd', 'x.sh', 'evil.ps1', 'legacy.com', 'setup.msi',
    'x.scr', 'macro.vbs', 'app.js', 'mod.mjs', 'thing.jar', 'lib.dll', 'tool.py', 'r.rb',
    'vector.svg', 'page.html', 'p.htm', 'data.xml', 'bundle.zip', 'a.rar', 'b.7z', 'c.tar', 'd.gz',
  ]) {
    const r = checkFile(bad, 1000);
    assert.equal(r.ok, false, `${bad} must be rejected`);
  }
});

test('rejects a missing extension and a double-extension exe', () => {
  assert.equal(checkFile('noext', 1000).ok, false);
  // "invoice.pdf.exe" ends in .exe -> not allowed.
  assert.equal(checkFile('invoice.pdf.exe', 1000).ok, false);
});

test('rejects an oversized file and an empty file', () => {
  assert.equal(checkFile('big.png', MAX_FILE_BYTES + 1).ok, false);
  assert.equal(checkFile('empty.png', 0).ok, false);
});

test('strips any path from the stored name', () => {
  const r = checkFile('C:\\Users\\rich\\..\\report.pdf', 1000);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.ok(!r.safeName.includes('/') && !r.safeName.includes('\\'), 'no path separators');
    assert.ok(r.safeName.endsWith('report.pdf') || r.safeName.includes('report'), 'keeps the basename');
  }
});

test('storage path is scoped under the room', () => {
  const p = backroomFilePath('room-123', 'uuid-abc', 'report.pdf');
  assert.equal(p, 'backroom/room-123/uuid-abc-report.pdf');
});

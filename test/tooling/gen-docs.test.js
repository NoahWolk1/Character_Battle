// gen-docs: optional fields whose schema `required` is only an unknown-reference code
// (startForm, hitbox use, form slots) must show their default, not **required**.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const GUIDE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'CHARACTER_GUIDE.md'), 'utf8');
const rows = (field) => GUIDE.split('\n').filter((l) => l.startsWith(`| \`${field}\` |`));

test('optional reference fields are not marked required', () => {
  for (const f of ['startForm', 'use', 'slots']) {
    assert.ok(rows(f).length, `${f} row exists`);
    for (const r of rows(f)) assert.doesNotMatch(r, /\*\*required\*\*/, r);
  }
  assert.match(rows('startForm')[0], /'base'/);
});

test('truly mandatory fields stay marked required', () => {
  for (const f of ['id', 'name', 'duration']) assert.match(rows(f)[0], /\*\*required\*\* \(E0\d\d\)/, f);
});

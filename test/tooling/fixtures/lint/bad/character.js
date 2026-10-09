// Lint fixture: every §5.4 rule broken at least once (never loaded by the server).
import { defineCharacter } from '../../../../../shared/char/api.js';
import * as kit from '../../../../../shared/art/kit.js';
import { CATEGORIES } from '../../../../../shared/balance/rules.js';
import fs from 'node:fs';
import art from './art.js';
import { helper } from './util.js';

let counter = 0;
var loose = 1;
const CACHE = {};
console.log('hi');
CATEGORIES.smash.maxHit = 999;
const seed = Math.random();
const when = Date.now();
const mk = () => ({ a: Math.random() });
const M = mk();
const proto = {}.constructor('return 1');

function rollDice() { return Math.random(); }
function spin() { for (;;) { counter++; } }
function makeCanvas() { return document.createElement('canvas'); }
function later() { setTimeout(() => {}, 1); eval('1'); return import('./util.js'); }
kit.PALETTE = {};

export default defineCharacter({
  id: 'bad', name: 'Bad',
  behavior: {
    tick(view, api) { if (rollDice() > 0.5) api.heal(1); CACHE.last = view.frame; helper(); },
    onHit(view) { const t = performance.now(); document.title = String(t); },
  },
  moves: { jab: { duration: 10, update(v, api) { while (true) { api.heal(1); } } } },
  ai: { hint: (view) => (Date.now() % 2 ? null : null) },
  slots: { jab: 'jab', side: (view) => (globalThis.x ? 'jab' : 'jab') },
  art,
});

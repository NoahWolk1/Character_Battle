// CHECKMATE — a living chess king and his army (spec §10.3 #9). Archetype stress test
// for: three `walker` minions (maxAlive 3) steered with api.command(), queen promotion
// through vars (pawns that land 3 hits earn it), and the entity threat budget.
import { defineCharacter } from '../../../shared/char/api.js';
import art from './art.js';

const PROMOTE_AT = 3;

export default defineCharacter({
  id: 'checkmate',
  name: 'Checkmate',
  author: 'archetype suite',
  description: 'The white king, done hiding behind his army. Fields up to three marching pawns, orders them to advance or hold the line, and promotes a veteran pawn to a flying queen.',
  archetype: 'summoner',

  body: {
    collider: { w: 56, h: 100 },
    hurtboxes: {
      default: [
        { shape: 'rect', x: 0, y: -12, w: 56, h: 24 },
        { shape: 'capsule', x1: 0, y1: -30, x2: 0, y2: -70, r: 20 },
        { shape: 'circle', x: 0, y: -84, r: 15 },
      ],
      crouch: [{ shape: 'rect', x: 0, y: -32, w: 60, h: 64 }],
    },
  },
  stats: { weight: 104, runSpeed: 5.8, airSpeed: 4.2, jumpHeight: 14, doubleJumpHeight: 13, airJumps: 1, gravity: 0.7, fallSpeed: 11.5 },

  vars: { promo: 0 },
  sync: ['promo'],

  hitboxes: {
    scepter: { damage: 7, angle: 40, knockback: 20, growth: 66, effect: 'slash' },
  },

  entities: {
    pawn: {
      kind: 'minion', shape: { shape: 'rect', x: 0, y: -21, w: 26, h: 42 }, life: 900, hp: 6, maxAlive: 3,
      motion: { type: 'walker', speed: 1.6, gravity: 0.6 }, collide: 'walk', platforms: true,
      hitboxes: [{ shape: 'rect', x: 14, y: -22, w: 18, h: 32, damage: 3, angle: 50, knockback: 10, growth: 20, rehit: 40, effect: 'slash' }],
      onDeath: [{ emit: 'pawnTaken' }],
    },
    queen: {
      kind: 'minion', shape: { shape: 'rect', x: 0, y: -28, w: 30, h: 56 }, life: 600, hp: 10, maxAlive: 1,
      motion: { type: 'homing', speed: 3.6, turn: 0.07, wobble: 0.1 }, collide: 'pass',
      hitboxes: [{ shape: 'circle', x: 0, y: -28, r: 26, damage: 5, angle: 55, knockback: 14, growth: 34, rehit: 30, effect: 'slash' }],
      onSpawn: [{ emit: 'crowned' }],
    },
    rook: {
      kind: 'trap', shape: { shape: 'rect', x: 0, y: -26, w: 34, h: 52 }, life: 360, maxAlive: 1,
      motion: { type: 'stationary', snapToGround: true },
      hitboxes: [{ shape: 'rect', x: 0, y: -26, w: 40, h: 56, damage: 6, angle: 60, knockback: 22, growth: 30, rehit: 60 }],
    },
  },

  moves: {
    jab: { name: 'Scepter Tap', duration: 18, anim: 'tap',
      hitboxes: [{ start: 4, end: 6, x: 44, y: -58, r: 16, damage: 3, angle: 60, knockback: 10, growth: 20 }] },
    side: { name: 'Royal Decree', duration: 28, anim: 'decree',
      hitboxes: [{ start: 8, end: 11, shape: 'capsule', x1: 30, y1: -56, x2: 96, y2: -56, r: 14, use: 'scepter' }] },
    up: { name: 'Crown Spike', duration: 28, anim: 'spike',
      hitboxes: [{ start: 7, end: 11, x: 0, y: -116, r: 22, damage: 8, angle: 90, knockback: 22, growth: 74 }] },
    down: { name: 'Base Sweep', duration: 26, anim: 'sweep',
      hitboxes: [{ start: 7, end: 10, shape: 'rect', x: 34, y: -8, w: 70, h: 16, damage: 6, angle: 75, knockback: 22, growth: 44 }] },
    sideSmash: { name: 'Checkmate!', duration: 48, anim: 'mate',
      hitboxes: [{ start: 16, end: 19, x: 90, y: -56, r: 28, damage: 16, angle: 38, knockback: 24, growth: 78, effect: 'slash' }] },
    upSmash: { name: 'Coronation', duration: 46, anim: 'coronation',
      hitboxes: [{ start: 13, end: 18, shape: 'capsule', x1: 0, y1: -100, x2: 0, y2: -150, r: 28, damage: 15, angle: 90, knockback: 28, growth: 86 }] },
    downSmash: { name: 'Board Wipe', duration: 44, anim: 'wipe',
      hitboxes: [{ start: 13, end: 16, shape: 'capsule', x1: -84, y1: -14, x2: 84, y2: -14, r: 20, damage: 13, angle: 30, knockback: 28, growth: 84 }] },
    nair: { name: 'Spin the Board', duration: 30, landingLag: 9, anim: 'spinboard',
      hitboxes: [{ start: 6, end: 16, x: 0, y: -50, r: 38, damage: 7, angle: 50, knockback: 20, growth: 58 }] },
    fair: { name: 'Scepter Arc', duration: 30, landingLag: 10, anim: 'arc',
      hitboxes: [{ start: 9, end: 12, x: 60, y: -60, r: 24, use: 'scepter' }] },
    bair: { name: 'Royal Rebuff', duration: 28, landingLag: 10, anim: 'rebuff',
      hitboxes: [{ start: 7, end: 10, x: -52, y: -52, r: 24, damage: 11, angle: 145, knockback: 26, growth: 84 }] },
    uair: { name: 'Cross Point', duration: 28, landingLag: 9, anim: 'cross',
      hitboxes: [{ start: 6, end: 11, x: 0, y: -118, r: 22, damage: 8, angle: 88, knockback: 22, growth: 76 }] },
    dair: { name: 'Heavy Base', duration: 36, landingLag: 16, anim: 'base',
      hitboxes: [{ start: 10, end: 14, shape: 'rect', x: 0, y: 2, w: 60, h: 20, damage: 11, angle: 280, knockback: 14, growth: 60 }] },

    deploy: { name: 'Pawn Storm', category: 'special', duration: 36, anim: 'deploy',
      timeline: [{ at: 12, spawn: 'pawn', x: 46, y: -10 }, { at: 12, emit: 'deploy' }] },
    // Promotion (vars.promo == 3, else Pawn Storm): the oldest pawn becomes a queen
    // (the hp-entity cap makes room).
    neutralSpecial: { name: 'Promotion', duration: 44, anim: 'promote', requires: { var: { promo: PROMOTE_AT } }, else: 'deploy',
      update(view, api) {
        if (view.me.move.frame !== 14) return;
        const pawns = view.entities('pawn');
        if (pawns.length) {
          const p = pawns[0];
          api.despawn(p.id);
          api.spawn('queen', { worldX: p.x, worldY: p.y });
        } else api.spawn('queen', { x: 40, y: -20 });
        api.vars.set('promo', 0);
      } },
    // Advance!: every piece targets the nearest enemy (walkers chase its x, the queen homes).
    sideSpecial: { name: 'Advance!', duration: 30, anim: 'order', oncePerAirtime: true,
      timeline: [{ at: 8, emit: 'advance' }],
      update(view, api) {
        if (view.me.move.frame !== 8) return;
        const t = view.nearestEnemy();
        if (!t) return;
        for (const e of view.entities()) api.command(e.id, { target: t.id });
      } },
    // Hold the line: pawns walk back to the king.
    downSpecial: { name: 'Hold the Line', duration: 30, anim: 'order', requires: { grounded: true }, else: 'rookDrop',
      timeline: [{ at: 8, emit: 'hold' }],
      update(view, api) {
        if (view.me.move.frame !== 8) return;
        for (const e of view.entities('pawn')) api.command(e.id, { moveTo: { x: view.me.x + 40 * view.me.facing, y: view.me.y } });
      } },
    rookDrop: { name: 'Rook Drop', category: 'special', duration: 40, anim: 'rook',
      timeline: [{ at: 14, spawn: 'rook', x: 0, y: 0 }] },
    upSpecial: { name: 'Castling', duration: 44, anim: 'castle', helpless: true,
      timeline: [{ at: 8, teleport: { dx: 50, dy: -150 } }, { at: 8, emit: 'castle' }],
      velocity: [{ start: 9, end: 16, vy: -6 }],
      hitboxes: [{ start: 9, end: 14, x: 0, y: -60, r: 34, damage: 6, angle: 80, knockback: 22, growth: 44 }] },
    taunt: { name: 'Check.', category: 'taunt', duration: 60, anim: 'check', timeline: [{ at: 10, emit: 'check' }] },
  },

  slots: {
    // Same routing as requires/else above, as a SlotFn (exercises slot functions; see the run.js report).
    neutralSpecial: (view) => (view.vars.promo >= PROMOTE_AT ? 'neutralSpecial' : 'deploy'),
  },

  behavior: {
    // Veteran pawns: hits landed by pawns count toward a promotion.
    onHit(view, api, ev) { if (ev.entity === 'pawn') api.vars.set('promo', Math.min(PROMOTE_AT, view.vars.promo + 1)); },
    onKO(view, api) { api.vars.set('promo', 0); },
  },

  ai: { preferredRange: 160, zoning: true, recovery: ['upSpecial'], prefer: ['neutralSpecial', 'sideSpecial'] },
  art,
});

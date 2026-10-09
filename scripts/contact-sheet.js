#!/usr/bin/env node
// Contact sheet export (spec §6.6): a PNG grid of idle, run, jump, fall, hurt, shield,
// every move at its active midpoint, every form, the entities and the portrait.
//
//   node scripts/contact-sheet.js <id> [<id>...]     → .cache/contact-sheets/<id>.png
//   node scripts/contact-sheet.js --src /dev/fixtures/nimbus/
//   options: --url http://localhost:3000 (use a running dev server) --timeout <ms> --chrome <path>
//
// Drives headless Chrome against /lab.html?still=1&sheet=1,
// which builds the sheet and POSTs it to the dev-only /dev/contact-sheet/:id.
// Open the PNG afterwards (Claude: Read the file) to critique the art.
import { fileURLToPath } from 'node:url';
import { main } from './art-check.js';

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2), { label: 'contact-sheet', defaults: { sheet: true, checks: false } })
    .then((code) => process.exit(code), (e) => { console.error(e.message || e); process.exit(1); });
}

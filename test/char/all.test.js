// Runs every test/char suite: node test/char/all.test.js
await import('./suggest.test.js');
await import('./ir.test.js');
await import('./normalize-errors.test.js');
await import('./normalize-v1.test.js');
await import('./examples.test.js');
if (process.exitCode) console.error('✘ test/char: failures above');

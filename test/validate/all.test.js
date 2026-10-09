// Runs every test/validate suite: node test/validate/all.test.js
await import('./v1-parity.test.js');
await import('./v2.test.js');
if (process.exitCode) console.error('✘ test/validate: failures above');

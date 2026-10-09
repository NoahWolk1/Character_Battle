// Cheater #21b (not loaded by the server): reaches the realm's globals through the
// Function constructor (no `Function` identifier, no `globalThis`, no `import()`).
import { defineCharacter } from '../../../../shared/char/api.js';

const ctor = (o) => o.constructor.constructor;

export default defineCharacter({
  id: 'escapee', name: 'Escapee',
  behavior: {
    tick(view, api) {
      const make = ctor(view);
      const realm = make('return this')();
      if (realm && realm.process) api.emit('escaped', { env: Object.keys(realm.process.env).length });
      make('return import("node:fs")')().then((fs) => { if (fs && fs.readFileSync) realm.__fsReached = true; }, () => {});
    },
  },
});

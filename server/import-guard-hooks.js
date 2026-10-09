// ESM loader hooks (module.register) for realms that import character code: a module
// inside <charDir>/<folder>/ may import only its own folder and the repo's shared/, and
// must itself be an ES module. Blocks node: builtins, node_modules, data: URLs and
// CommonJS (require) even if lint misses a file. Registered by server/characters.js.
let charDir = '';
let sharedDir = '';

export function initialize(data) {
  charDir = data.charDir;
  sharedDir = data.sharedDir;
}

const bare = (url) => (url || '').split(/[?#]/)[0];

/** file URL prefix of the character folder that owns `url`, or null. */
function folderOf(url) {
  if (!url.startsWith(charDir)) return null;
  const i = url.indexOf('/', charDir.length);
  return i < 0 ? null : url.slice(0, i + 1);
}

export async function resolve(specifier, context, next) {
  const res = await next(specifier, context);
  const from = folderOf(bare(context.parentURL));
  if (from) {
    const url = bare(res.url);
    if (!url.startsWith(from) && !url.startsWith(sharedDir)) {
      throw new Error(`E020 character import blocked: '${specifier}' (from ${bare(context.parentURL).slice(charDir.length)}) — characters may import only their own folder and shared/.`);
    }
  }
  return res;
}

export async function load(url, context, next) {
  const res = await next(url, context);
  if (folderOf(bare(url)) && res.format !== 'module') {
    throw new Error(`E020 character file ${bare(url).slice(charDir.length)} is not an ES module (${res.format}) — use .js/.mjs with import/export.`);
  }
  return res;
}

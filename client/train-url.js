// Training deep link: /?train=<id>[&cpu=dummy|easy|normal|hard][&vs=<id>]
// Returns the two LocalMatch players, or null when `train` isn't a known character.
// Default opponent: a standing Dummy mirror (art/hitbox checks); &cpu=hard for play-testing.
export const TRAIN_LEVELS = ['dummy', 'easy', 'normal', 'hard'];

/** @param {string|URLSearchParams} search  @param {(id: string) => boolean} has */
export function trainingPlayers(search, has) {
  const q = typeof search === 'string' ? new URLSearchParams(search) : search;
  const train = q.get('train');
  if (!train || !has(train)) return null;
  const cpu = TRAIN_LEVELS.includes(q.get('cpu')) ? q.get('cpu') : 'dummy';
  const vs = q.get('vs') && has(q.get('vs')) ? q.get('vs') : train;
  const name = cpu === 'dummy' ? 'Dummy' : `CPU ${cpu[0].toUpperCase()}${cpu.slice(1)}`;
  return [{ id: 'p0', name: 'You', charId: train, source: 'any' }, { id: 'p1', name, charId: vs, cpu }];
}

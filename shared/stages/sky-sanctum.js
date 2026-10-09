// Stage geometry (gameplay only). The visuals live in client/render/stages/.
// y grows DOWNWARD. The main stage top surface is y = 0.
export default {
  id: 'sky-sanctum',
  name: 'Sky Sanctum',
  // Solid main stage: you can't pass through it from any side.
  ground: { x1: -540, x2: 540, y: 0, bottom: 150 },
  // Soft platforms: you can jump up through them and drop down with ↓.
  platforms: [
    { x1: -400, x2: -170, y: -175 },
    { x1: 170, x2: 400, y: -175 },
    { x1: -125, x2: 125, y: -335 },
  ],
  blast: { left: -1060, right: 1060, top: -940, bottom: 640 },
  spawns: [
    { x: -330, y: 0, facing: 1 },
    { x: 330, y: 0, facing: -1 },
    { x: -110, y: 0, facing: 1 },
    { x: 110, y: 0, facing: -1 },
  ],
  respawnY: -470,
  camera: { left: -980, right: 980, top: -860, bottom: 460, minWidth: 900, maxWidth: 2000 },
};

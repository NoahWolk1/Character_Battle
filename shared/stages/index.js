// Stage registry (gameplay geometry only; visuals live in client/render/stages/).
// Add a stage: create shared/stages/<id>.js, import it here and list it in STAGES.
import skySanctum from './sky-sanctum.js';

const STAGES = [skySanctum];

/** id → stage geometry (frozen map, insertion order = select order). */
export const stages = Object.freeze(Object.fromEntries(STAGES.map((s) => [s.id, s])));
export const STAGE_IDS = Object.freeze(STAGES.map((s) => s.id));
export const DEFAULT_STAGE_ID = 'sky-sanctum';

/** Stage geometry by id; unknown ids fall back to the default stage. */
export function getStage(id) {
  return Object.prototype.hasOwnProperty.call(stages, id) ? stages[id] : stages[DEFAULT_STAGE_ID];
}

export default stages;

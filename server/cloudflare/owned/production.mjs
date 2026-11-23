import { createComputeClass, createComputeRouter } from './compute-adapter.mjs';
import { createFenceGate } from './fence-gate.mjs';

export function createProductionCompute(DurableObjectBase, coreAuthority, options) {
  return {
    HarbourCompute: createComputeClass(DurableObjectBase, createFenceGate(coreAuthority, options)),
    worker: createComputeRouter(),
  };
}

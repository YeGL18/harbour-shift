import { DurableObject } from 'cloudflare:workers';
import coreAuthority from './build/core.mjs';
import { createProductionCompute } from './production.mjs';

const production = createProductionCompute(DurableObject, coreAuthority);
export const HarbourCompute = production.HarbourCompute;
export default production.worker;

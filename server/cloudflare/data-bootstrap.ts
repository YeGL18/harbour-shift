import { ROAD_GRAPH } from '../../src/map/roadGraph';
import { getVehicleGraph } from '../../src/game/access';
let initialized = false;

/** Worker-only: retain both legal profiles and release redundant base indexes. */
export function prepareServerData(): boolean {
  if (initialized) return false;
  const taxi = getVehicleGraph('kam-fung'), privateCar = getVehicleGraph('private');
  if (taxi === ROAD_GRAPH || privateCar === ROAD_GRAPH) throw new Error('Server graph compaction requires distinct legal profiles');
  ROAD_GRAPH.nodes = {}; ROAD_GRAPH.edges = {}; ROAD_GRAPH.outgoing = {};
  initialized = true;
  return true;
}

import { ROAD_GRAPH } from '../map/roadGraph';
import { getVehicleAccessGraph } from '../data/vehicleAccess';
import type { RoadGraph, VehicleId } from './types';

/** Use one cached legal road graph for movement, dispatch, routing and map branches. */
export function getVehicleGraph(vehicleId: VehicleId, graph: RoadGraph = ROAD_GRAPH): RoadGraph {
  return getVehicleAccessGraph(graph, vehicleId);
}

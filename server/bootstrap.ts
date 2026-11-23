import rawRoads from '../assets/map/roads.json';
import rawPlaces from '../assets/places/catalog.json';
import { ROAD_GRAPH } from '../src/map/roadGraph';
import { createInitialState, getVehicleGraph } from '../src/game';

let prepared=false;
/** Server-only: retain full legal geometry while releasing duplicate ingest arrays. */
export function prepareServerEngine():void {
  if(prepared)return;
  const taxi=getVehicleGraph('kam-fung');const privateCar=getVehicleGraph('private');
  // Warm each immutable legal catalog and routing metric while original source
  // dictionaries still exist. All server operations use the legal graph cache.
  createInitialState({vehicleId:'kam-fung',seed:20261118});
  createInitialState({vehicleId:'private',seed:20261118});
  rawRoads.roads.length=0;rawPlaces.rows.length=0;
  if(taxi!==ROAD_GRAPH&&privateCar!==ROAD_GRAPH){ROAD_GRAPH.nodes={};ROAD_GRAPH.edges={};ROAD_GRAPH.outgoing={};}
  prepared=true;
}

import {ROAD_GRAPH} from '../../src/map/roadGraph';
import {getVehicleAccessGraph} from '../../src/data/vehicleAccess';
/** Build-time only. Never imported by the Worker or the native application. */
export function legalGraphExclusions(){
  const nodes=Object.keys(ROAD_GRAPH.nodes),edges=Object.keys(ROAD_GRAPH.edges);
  const profile=(id:'kam-fung'|'private')=>{const allowed=getVehicleAccessGraph(ROAD_GRAPH,id);return{nodes:nodes.filter(id=>!allowed.nodes[id]),edges:edges.filter(id=>!allowed.edges[id]),firstNode:Object.keys(allowed.outgoing)[0],nodeCount:Object.keys(allowed.nodes).length,edgeCount:Object.keys(allowed.edges).length};};
  return{taxi:profile('kam-fung'),private:profile('private'),baseNodes:nodes.length,baseEdges:edges.length};
}

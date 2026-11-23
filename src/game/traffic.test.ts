/// <reference types="node" />
import assert from 'node:assert/strict';
import test from 'node:test';
import {getNearbyNpcTraffic,getTrafficConditions,type TrafficWorld} from './traffic';
import {flatDistanceM} from './spatial';
import type {RoadGraph} from './types';
import {getWorldEventSchedule} from '../../shared/worldEvents';

function grid():RoadGraph {
 const graph:RoadGraph={nodes:{},edges:{},outgoing:{}};
 for(let x=0;x<11;x++)for(let y=0;y<11;y++){const id=`${x}:${y}`;graph.nodes[id]={id,lat:22.298+y*.0018,lon:114.158+x*.00194};}
 for(let x=0;x<11;x++)for(let y=0;y<11;y++)for(const[dx,dy]of[[1,0],[-1,0],[0,1],[0,-1]]){
  const from=`${x}:${y}`,to=`${x+dx}:${y+dy}`;if(!graph.nodes[to])continue;const id=`${from}->${to}`;
  graph.edges[id]={id,from,to,lengthM:200,speedKph:30,name:'測試道',safeStop:true};(graph.outgoing[from]??=[]).push(id);
 }
 return graph;
}
const world:TrafficWorld={seed:20261120,startTimeMinutes:300,clockMinutes:210};
const center={lat:22.307,lon:114.1677};

test('congestion is shared by seed/time/region, smoothly varies and never changes the world clock',()=>{
 const initial={...world};const peak=getTrafficConditions(world,center),night=getTrafficConditions({...world,clockMinutes:0},center),rural=getTrafficConditions(world,{lat:22.42,lon:114.32});
 assert.deepEqual(getTrafficConditions({...world},center),peak);
 assert.ok(peak.speedFactor<night.speedFactor);assert.ok(peak.density>rural.density);assert.ok(peak.speedFactor>=.46);
 assert.equal(night.speedFactor,1);assert.deepEqual(world,initial);
 const later=getTrafficConditions({...world,clockMinutes:world.clockMinutes+.01},center);
 assert.ok(Math.abs(later.speedFactor-peak.speedFactor)<.005);
});

test('an active event increases real simulated congestion only near its location and within its lifetime',()=>{
 const off={...world,clockMinutes:0};const event={id:'e',title:'活動',titleEn:'Event',pickupPlaceId:'p',center,radiusM:900,startsAt:1,endsAt:10,demandBoost:2};
 const normal=getTrafficConditions({...off,clockMinutes:5},center);
 assert.ok(getTrafficConditions({...off,clockMinutes:5,worldEvent:event},center).speedFactor<normal.speedFactor);
 assert.deepEqual(getTrafficConditions({...off,worldEvent:event},center),getTrafficConditions(off,center));
 assert.deepEqual(getTrafficConditions({...off,clockMinutes:10,worldEvent:event},center),getTrafficConditions({...off,clockMinutes:10},center));
});

test('NPCs remain bounded, on legal connected roads, move continuously and are not serialized state',()=>{
 const graph=grid(),before=JSON.stringify(graph),input=JSON.stringify(world);
 const first=getNearbyNpcTraffic(world,center,graph,{radiusM:1500,limit:999});
 assert.ok(first.length>2);assert.ok(first.length<=18);
 const second=getNearbyNpcTraffic({...world,clockMinutes:world.clockMinutes+.02},center,graph,{radiusM:1500});
 let moved=0;
 for(const car of first){
  const edge=graph.edges[car.edgeId];assert.ok(edge);assert.ok(car.distanceOnEdgeM>=0&&car.distanceOnEdgeM<=edge.lengthM);assert.ok(Number.isFinite(car.position.heading));
  const a=graph.nodes[edge.from],b=graph.nodes[edge.to];
  assert.ok(car.position.lat>=Math.min(a.lat,b.lat)-1e-8&&car.position.lat<=Math.max(a.lat,b.lat)+1e-8);
  assert.ok(car.position.lon>=Math.min(a.lon,b.lon)-1e-8&&car.position.lon<=Math.max(a.lon,b.lon)+1e-8);
  const next=second.find(n=>n.id===car.id);if(!next)continue;
  const distance=flatDistanceM(car.position,next.position);assert.ok(distance<15,`No teleport for ${car.id}: ${distance}m`);if(distance>.1)moved++;
  if(next.edgeId!==car.edgeId)assert.equal(graph.edges[car.edgeId].to,graph.edges[next.edgeId].from);
 }
 assert.ok(moved>0);assert.equal(JSON.stringify(graph),before);assert.equal(JSON.stringify(world),input);
 assert.deepEqual(getNearbyNpcTraffic(world,center,graph,{radiusM:1500}),first);
});

test('nearby observers see identical positions for shared NPC identities and no dependency on query order',()=>{
 const graph=grid(),other={lat:center.lat+.0002,lon:center.lon+.0002};
 const a=getNearbyNpcTraffic(world,center,graph,{radiusM:1500}),b=getNearbyNpcTraffic(world,other,graph,{radiusM:1500});
 const common=a.filter(car=>b.some(other=>other.id===car.id));assert.ok(common.length>0);
 for(const car of common)assert.deepEqual(car,b.find(other=>other.id===car.id));
 assert.deepEqual(getNearbyNpcTraffic(world,center,graph,{radiusM:1500}),a);
 assert.deepEqual(getNearbyNpcTraffic(world,center,graph,{limit:0}),[]);
});

test('NPC history remains continuous across a scheduled event ending, even after a cold query',()=>{
 const shift={seed:20261120,startTimeMinutes:1020,shiftDurationMinutes:1440 as const};
 const event=getWorldEventSchedule(shift.seed,shift.shiftDurationMinutes,shift.startTimeMinutes)[0]!;
 const graph=grid();for(const node of Object.values(graph.nodes)){node.lat+=event.center.lat-center.lat;node.lon+=event.center.lon-center.lon;}
 const before={...shift,clockMinutes:event.endsAt-.01,worldEvent:event};
 const after={...shift,clockMinutes:event.endsAt+.01};
 const initial=getNearbyNpcTraffic(before,event.center,graph,{radiusM:1500});
 const final=getNearbyNpcTraffic(after,event.center,graph,{radiusM:1500});
 const common=initial.filter(car=>final.some(next=>next.id===car.id));assert.ok(common.length>0);
 for(const car of common)assert.ok(flatDistanceM(car.position,final.find(next=>next.id===car.id)!.position)<15);
 assert.deepEqual(getNearbyNpcTraffic(after,event.center,structuredClone(graph),{radiusM:1500}),final,'A late observer reconstructs the same event history');
});

/// <reference types="node" />
import assert from 'node:assert/strict';
import test from 'node:test';
import {advanceGame,createInitialState,getRouteEventOptions,getVehiclePosition,resolveRouteEvent} from './engine';
import {roadHazardOnEdge,routeEventSpeedFactor} from './roadHazards';
import type {GameState,Landmark,RoadGraph,RouteEvent} from './types';

const graph:RoadGraph={nodes:{a:{id:'a',lat:22.38,lon:114.28},b:{id:'b',lat:22.381,lon:114.28},c:{id:'c',lat:22.382,lon:114.28},d:{id:'d',lat:22.381,lon:114.282}},edges:{},outgoing:{}};
for(const[from,to,length]of[['a','b',110],['b','c',110],['b','d',210],['d','c',235]]as const)for(const[a,b]of[[from,to],[to,from]]){const id=`${a}-${b}`;graph.edges[id]={id,from:a,to:b,lengthM:length,speedKph:24,roadClass:'local',name:'鄉郊測試路',safeStop:true};(graph.outgoing[a]??=[]).push(id);}
const rural:Landmark={...graph.nodes.b,id:'rural',nodeId:'b',name:'鄉郊地點',kind:'residential',district:'西貢區',waitingProfile:'saikung'};
const places:Landmark[]=[{...graph.nodes.a,id:'harbour-city',nodeId:'a',name:'起點',district:'西貢區',kind:'residential',waitingProfile:'saikung'},rural,{...graph.nodes.c,id:'megabox',nodeId:'c',name:'終點',district:'西貢區',kind:'residential',waitingProfile:'saikung'}];
function generated(kind:'cattle'|'dog'|'pedestrian',lingering=kind!=='pedestrian'):RouteEvent{
 const place=kind==='pedestrian'?{...rural,kind:'business'as const,waitingProfile:'ordinary'as const}:rural;
 for(let seed=1;seed<40000;seed++){const event=roadHazardOnEdge({seed,startTimeMinutes:450,clockMinutes:20},graph.edges['b-c'],graph,place);if(event?.kind===kind&&(event.blockingUntil!==undefined)===lingering)return event;}
 throw new Error('Deterministic rare fixture not found');
}
function fresh(event?:RouteEvent):GameState{
 const state=createInitialState({seed:17,graph,landmarks:places,dispatchManaged:true,startTimeMinutes:450,handoverPlace:null});
 return {...state,currentOffer:null,acceptingOrders:false,nextDemandMinute:10000,nextEventMinute:10000,clockMinutes:event?(event.blockingStartsAt??event.startedAt)+.1:0,routeEvent:event??null,cruiseTarget:places[2],movement:{...state.movement,nextEdgeIds:['b-c']}};
}

test('rare rural hazards share road/time identity, expire, and ordinary Tseung Kwan O is not rural',()=>{
 for(const kind of['cattle','dog']as const){const event=generated(kind),seed=Number(event.id.split('-')[1]),world={seed,startTimeMinutes:450,clockMinutes:20};
  assert.deepEqual(roadHazardOnEdge(world,graph.edges['b-c'],graph,rural),event);
  assert.equal(roadHazardOnEdge({...world,clockMinutes:event.expiresAt},graph.edges['b-c'],graph,rural),null);
  assert.equal(roadHazardOnEdge(world,graph.edges['b-c'],graph,{...rural,waitingProfile:'ordinary'}),null);
  assert.equal(roadHazardOnEdge(world,{...graph.edges['b-c'],roadClass:'tunnel'},graph,rural),null);
  assert.ok(event.blockingUntil!-event.blockingStartsAt!>=1);assert.ok(event.blockingUntil!-event.blockingStartsAt!<=9);
 }
 let found=0;for(let seed=1;seed<=5000;seed++)if(roadHazardOnEdge({seed,startTimeMinutes:450,clockMinutes:20},graph.edges['b-c'],graph,rural))found++;
 assert.ok(found<30,'Rare preventative event, not a new obstacle on every tick');
});

test('automatic animal stop advances time without movement or energy cost, then safely resumes after clearance',()=>{
 const event=generated('cattle'),initial=fresh(event);initial.movement={...initial.movement,edgeId:'b-c',distanceOnEdgeM:0,nextEdgeIds:[]};
 const before=getVehiclePosition(initial,graph),wait=advanceGame(initial,1,graph);
 assert.deepEqual(getVehiclePosition(wait,graph),before);assert.equal(wait.totalDistanceM,0);assert.equal(wait.operatingCost,0);assert.equal(wait.clockMinutes,initial.clockMinutes+1);
 assert.equal(initial.movement.distanceOnEdgeM,0);
 const resumed=advanceGame(wait,event.expiresAt-wait.clockMinutes+.5,graph);
 assert.ok(resumed.totalDistanceM>0);assert.ok(Number.isFinite(resumed.operatingCost));assert.equal(resumed.routeEvent,null);
});

test('safe stay choice cannot bypass a road block; legal reroute starts from actual upcoming junction without teleporting',()=>{
 const event=generated('dog'),state=fresh(event),before=getVehiclePosition(state,graph);
 assert.equal(getRouteEventOptions(state,graph).reroute,true);
 const alternative=resolveRouteEvent(state,'reroute',graph);
 assert.deepEqual(getVehiclePosition(alternative,graph),before);assert.equal(alternative.cruiseTarget?.nodeId,'c');assert.ok(!alternative.movement.nextEdgeIds.includes('b-c'));
 let node=graph.edges[state.movement.edgeId].to;for(const id of alternative.movement.nextEdgeIds){assert.equal(graph.edges[id].from,node);node=graph.edges[id].to;}assert.equal(node,'c');
 const stay=resolveRouteEvent(state,'stay',graph);assert.equal(stay.routeEvent?.resolved,true);assert.equal(routeEventSpeedFactor(stay.routeEvent,'b-c',state.clockMinutes),0);
});

test('commercial pedestrian precautions slow automatically, and original temporary roadworks remain',()=>{
 const event=generated('pedestrian');assert.equal(event.blockingUntil,undefined);assert.ok(routeEventSpeedFactor(event,'b-c',event.startedAt+.1)<.3);
 const initial=fresh();initial.nextEventMinute=0;initial.eventIndex=1;
 const withWorks=advanceGame(initial,.01,graph);assert.equal(withWorks.routeEvent?.kind,'roadworks');assert.equal(withWorks.routeEvent?.title,'前方臨時工程');assert.equal(routeEventSpeedFactor(withWorks.routeEvent,'b-c',withWorks.clockMinutes),.5);
});

test('regional congestion slows actual driving while retaining the shared clock and distance-based fuel ledger',()=>{
 const base=fresh();base.startTimeMinutes=300;base.clockMinutes=0;base.routeEvent=null;
 // Same legal graph shifted into central Kowloon to compare an early road to rush-hour conditions.
 const city:RoadGraph={...graph,nodes:Object.fromEntries(Object.entries(graph.nodes).map(([id,p])=>[id,{...p,lat:p.lat-.08,lon:p.lon-.12}]))};
 const early=advanceGame(base,.2,city),peak=advanceGame({...base,startTimeMinutes:510},.2,city);
 assert.equal(early.clockMinutes,.2);assert.equal(peak.clockMinutes,.2);assert.ok(peak.totalDistanceM<early.totalDistanceM);
 assert.ok(peak.operatingCost<early.operatingCost);assert.equal(early.grossIncome,0);assert.equal(peak.grossIncome,0);
});


test('animals sometimes cross briefly without a block or detour, while lingering outcomes remain seeded',()=>{
 for(const kind of ['cattle','dog'] as const){
  const brief=generated(kind,false),persistent=generated(kind,true);
  assert.equal(brief.blockingStartsAt,undefined);assert.equal(brief.blockingUntil,undefined);
  assert.ok(routeEventSpeedFactor(brief,'b-c',brief.startedAt+.1)>0);
  assert.ok(routeEventSpeedFactor(brief,'b-c',brief.startedAt+.1)<1);
  assert.equal(getRouteEventOptions(fresh(brief),graph).reroute,false);
  assert.equal(getRouteEventOptions(fresh(persistent),graph).reroute,true);
  const seed=Number(brief.id.split('-')[1]);
  assert.deepEqual(roadHazardOnEdge({seed,startTimeMinutes:450,clockMinutes:20},graph.edges['b-c'],graph,rural),brief);
 }
});

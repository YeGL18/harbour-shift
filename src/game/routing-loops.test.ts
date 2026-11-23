/// <reference types="node" />
import assert from 'node:assert/strict';
import test from 'node:test';
import { acceptOffer,advanceGame,chooseBranch,createInitialState,formatClock,getUpcomingBranches,getVehicleGraph,normalizeGameState } from './engine';
import { defaultNextEdge,extendItinerary,recordDrivenEdge,routeLength,RECENT_EDGE_LIMIT } from './routing';
import type { Landmark,Movement,RoadGraph } from './types';

function circleGraph(){
  const graph:RoadGraph={nodes:{},edges:{},outgoing:{}};
  const point=(angle:number,radius=20)=>({lat:22.3+Math.sin(angle)*radius/111195,lon:114.16+Math.cos(angle)*radius/102980});
  for(let index=0;index<3;index++)graph.nodes[`r${index}`]={id:`r${index}`,...point(index*Math.PI*2/3)};
  graph.nodes.x={id:'x',...point(0,100)};graph.nodes.y={id:'y',...point(0,2100)};
  const add=(id:string,from:string,to:string,lengthM:number,shape?:Array<{lat:number;lon:number}>)=>{graph.edges[id]={id,from,to,lengthM,shape,speedKph:24,name:'測試迴旋處',roadClass:'local'};(graph.outgoing[from]||=[]).push(id);};
  for(let index=0;index<3;index++){const shape=Array.from({length:13},(_,step)=>point((index+step/12)*Math.PI*2/3));add(`ring${index}`,`r${index}`,`r${(index+1)%3}`,42,shape);}
  add('exit','r0','x',80);add('main','x','y',2000);add('return','y','x',2000);add('entry','x','r0',80);
  return graph;
}
function assertConnected(movement:Movement,graph:RoadGraph){let previous=graph.edges[movement.edgeId].to;for(const id of movement.nextEdgeIds){assert.equal(graph.edges[id].from,previous);previous=graph.edges[id].to;}}
test('a genuine curved roundabout chooses its exit rather than endlessly preferring the shallow turn',()=>{
  const graph=circleGraph();assert.equal(defaultNextEdge('ring2',graph),'ring0','the old heading-only preference closes the circle');
  const movement:Movement={edgeId:'ring0',distanceOnEdgeM:0,nextEdgeIds:[]};extendItinerary(movement,graph);
  assert.ok(movement.nextEdgeIds.slice(0,4).includes('exit'));assertConnected(movement,graph);
});
test('legacy saves with 1.4km of already queued loops are repaired without requiring a new shift',()=>{
  const graph=circleGraph();const movement:Movement={edgeId:'ring0',distanceOnEdgeM:0,nextEdgeIds:Array.from({length:150},(_,index)=>`ring${(index+1)%3}`)};
  assert.ok(routeLength(movement.nextEdgeIds,graph)>1400);extendItinerary(movement,graph);
  assert.ok(movement.nextEdgeIds.slice(0,4).includes('exit'));assert.ok(movement.nextEdgeIds.length<20);assertConnected(movement,graph);
});
test('a side-road returning to a previous junction takes the available onward exit',()=>{
  const graph=circleGraph();const movement:Movement={edgeId:'entry',distanceOnEdgeM:80,nextEdgeIds:[],recentEdgeIds:['ring0','ring1','ring2','exit','entry']};extendItinerary(movement,graph);
  assertConnected(movement,graph);assert.ok(movement.nextEdgeIds.includes('main'));
});
test('a real dead end still permits the necessary reverse edge and bounded history never grows forever',()=>{
  const graph:RoadGraph={nodes:{a:{id:'a',lat:22.3,lon:114.16},b:{id:'b',lat:22.301,lon:114.16}},edges:{ab:{id:'ab',from:'a',to:'b',lengthM:100},ba:{id:'ba',from:'b',to:'a',lengthM:100}},outgoing:{a:['ab'],b:['ba']}};
  assert.equal(defaultNextEdge('ab',graph,['ab','ba','ab']),'ba');const movement:Movement={edgeId:'ab',distanceOnEdgeM:0,nextEdgeIds:[]};extendItinerary(movement,graph);assert.equal(movement.nextEdgeIds[0],'ba');assertConnected(movement,graph);
  for(let index=0;index<300;index++)recordDrivenEdge(movement,index%2?'ab':'ba');assert.equal(movement.recentEdgeIds!.length,RECENT_EDGE_LIMIT);
});
test('a player-selected loop branch remains committed despite an automatic preference for the exit',()=>{
  const graph=circleGraph();const places:Landmark[]=[{...graph.nodes.r0,id:'harbour-city',nodeId:'r0',name:'起點',district:'測試',kind:'transport'},{...graph.nodes.x,id:'megabox',nodeId:'x',name:'終點',district:'測試',kind:'transport'}];
  let state=createInitialState({graph,landmarks:places,startNodeId:'r0',seed:42});state.movement={edgeId:'ring2',distanceOnEdgeM:20,nextEdgeIds:['exit','main'],recentEdgeIds:['ring0','ring1','ring2']};
  assert.ok(getUpcomingBranches(state,graph)[0].options.some(option=>option.edgeId==='ring0'));
  state=chooseBranch(state,'r0','ring0',graph);assert.equal(state.movement.nextEdgeIds[0],'ring0');assert.equal(state.movement.committedEdgeCount,1);
  extendItinerary(state.movement,graph);assert.equal(state.movement.nextEdgeIds[0],'ring0');
  const moved=advanceGame(state,.1,graph);assert.equal(moved.movement.edgeId,'ring0');assert.equal(state.movement.recentEdgeIds!.length,3,'clones must not share mutable history');
});
test('actual passenger legs contribute history but explicit trip and service routes are not rewritten',()=>{
  const graph=circleGraph();const places:Landmark[]=[{...graph.nodes.r0,id:'harbour-city',nodeId:'r0',name:'起點',district:'測試',kind:'transport'},{...graph.nodes.x,id:'megabox',nodeId:'x',name:'終點',district:'測試',kind:'transport'}];
  const fresh=createInitialState({graph,landmarks:places,startNodeId:'r0',seed:42});let passenger=acceptOffer(fresh,graph);
  passenger.phase='dropoff';passenger.activeTrip!.phaseEndsAt=undefined;passenger.movement={edgeId:'ring2',distanceOnEdgeM:41,nextEdgeIds:['ring0','ring1','ring2','exit']};
  const moved=advanceGame(passenger,.02,graph);assert.equal(moved.movement.edgeId,'ring0');assert.deepEqual(moved.movement.nextEdgeIds,['ring1','ring2','exit']);assert.ok(moved.movement.recentEdgeIds?.includes('ring2'));
  const service={...fresh,phase:'service-route' as const,currentOffer:null,navigation:{kind:'handover' as const,target:places[1],stage:'routing' as const},movement:{edgeId:'ring2',distanceOnEdgeM:41,nextEdgeIds:['ring0','ring1','ring2','exit']}};
  const serviceMoved=advanceGame(service,.02,graph);assert.deepEqual(serviceMoved.movement.nextEdgeIds,['ring1','ring2','exit']);
});
test('real Nam Wan Road 27m triangle exits and the saved Sorrento/Jordan loop is not replayed',()=>{
  const graph=getVehicleGraph('kam-fung');const triangle=['td-1726-f','td-7-f','td-3400-f'];for(const id of triangle)assert.ok(graph.edges[id]);
  const movement:Movement={edgeId:triangle[0],distanceOnEdgeM:0,nextEdgeIds:Array.from({length:150},(_,index)=>triangle[(index+1)%3])};extendItinerary(movement,graph);
  assert.ok(movement.nextEdgeIds.slice(0,4).some(id=>!triangle.includes(id)));assertConnected(movement,graph);
  const jordan=['td-106931-f','td-105597-f','td-106930-f','td-105602-f','td-106929-f'];const initial=createInitialState({seed:20261118,startPlaceId:'sorrento'});
  const restored=normalizeGameState({...initial,movement:{edgeId:jordan[0],distanceOnEdgeM:graph.edges[jordan[0]].lengthM-.01,nextEdgeIds:Array.from({length:150},(_,index)=>jordan[(index+1)%5])}})!;
  const moved=advanceGame(restored,.1);assert.ok([moved.movement.edgeId,...moved.movement.nextEdgeIds.slice(0,6)].some(id=>!jordan.includes(id)));
});
test('new shifts default to 05:00 and 17:00 while custom and saved start times remain unchanged',()=>{
  assert.equal(createInitialState().startTimeMinutes,300);assert.equal(createInitialState({shift:'night'}).startTimeMinutes,1020);
  const custom=createInitialState({startTimeMinutes:425});assert.equal(formatClock(custom),'07:05');assert.equal(normalizeGameState(custom)!.startTimeMinutes,425);
});
test('normalization repairs only automatic loops and preserves an explicit mainline cruise target',()=>{
  const graph=circleGraph();const places:Landmark[]=[{...graph.nodes.r0,id:'harbour-city',nodeId:'r0',name:'起點',district:'測試',kind:'transport'},{...graph.nodes.x,id:'megabox',nodeId:'x',name:'終點',district:'測試',kind:'transport'}];
  const initial=createInitialState({graph,landmarks:places,startNodeId:'r0',seed:42});
  const loop=Array.from({length:150},(_,index)=>`ring${(index+1)%3}`);
  const automatic=normalizeGameState({...initial,movement:{edgeId:'ring0',distanceOnEdgeM:0,nextEdgeIds:loop}},graph)!;
  assert.ok(automatic.movement.nextEdgeIds.slice(0,4).includes('exit'));
  const explicit=normalizeGameState({...initial,cruiseTarget:places[1],movement:{edgeId:'ring0',distanceOnEdgeM:0,nextEdgeIds:[...loop,'exit']}},graph)!;
  assert.deepEqual(explicit.movement.nextEdgeIds,[...loop,'exit']);assert.equal(explicit.cruiseTarget?.nodeId,'x');
  const selected=normalizeGameState({...initial,movement:{edgeId:'ring2',distanceOnEdgeM:20,nextEdgeIds:['ring0','ring1','ring2','exit'],committedEdgeCount:1,recentEdgeIds:['ring0','ring1','ring2']}},graph)!;
  assert.equal(selected.movement.nextEdgeIds[0],'ring0');
});
test('an empty lookahead selects the same history-aware escape direction shown by automatic planning',()=>{
  const graph=circleGraph();const places:Landmark[]=[{...graph.nodes.r0,id:'harbour-city',nodeId:'r0',name:'起點',district:'測試',kind:'transport'},{...graph.nodes.x,id:'megabox',nodeId:'x',name:'終點',district:'測試',kind:'transport'}];
  const state=createInitialState({graph,landmarks:places,startNodeId:'r0',seed:42});state.movement={edgeId:'ring2',distanceOnEdgeM:20,nextEdgeIds:[],recentEdgeIds:['ring0','ring1','ring2']};
  assert.equal(getUpcomingBranches(state,graph)[0].selectedEdgeId,'exit');
});

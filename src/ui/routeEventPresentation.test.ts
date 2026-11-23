import test from 'node:test';
import assert from 'node:assert/strict';
import type {GameState,RouteEvent} from '../game/types';
import {showsDrivingTraffic,showsRouteEvent} from './routeEventPresentation';
const event:RouteEvent={id:'warning',kind:'traffic',title:'',description:'',roadName:'',affectedEdgeId:'ahead',startedAt:0,expiresAt:20,resolved:false};
const driving={phase:'cruising',parking:null,energyRecovery:null,navigation:null,movement:{edgeId:'current',distanceOnEdgeM:10,nextEdgeIds:['ahead','after']},clockMinutes:5}as Pick<GameState,'phase'|'parking'|'energyRecovery'|'navigation'|'movement'|'clockMinutes'>;
test('road warnings remain available on genuine driving routes but not while waiting, queuing or servicing',()=>{
  assert.equal(showsRouteEvent(driving,event),true);
  for(const phase of['fuel-queue','airport-queue','servicing','waiting','boarding','alighting','ended']as const)assert.equal(showsRouteEvent({...driving,phase}as typeof driving,event),false);
  assert.equal(showsRouteEvent({...driving,phase:'service-route',navigation:{stage:'servicing'}as GameState['navigation']},event),false);
  assert.equal(showsDrivingTraffic({...driving,parking:{kind:'rest'}as GameState['parking']}),false);
  assert.equal(showsDrivingTraffic({...driving,energyRecovery:{}as GameState['energyRecovery']}),false);
});
test('leaving a station does not resurrect a passed or bypassed event; an actual remaining hazard is visible',()=>{
  const serviced={...driving,phase:'servicing' as const};assert.equal(showsRouteEvent(serviced,event),false);
  const departed={...driving,movement:{...driving.movement,edgeId:'after',nextEdgeIds:['new-road']}};
  assert.equal(showsRouteEvent(departed,event),false);
  assert.equal(showsRouteEvent({...departed,movement:{...departed.movement,nextEdgeIds:['ahead']}},event),true);
  assert.equal(showsRouteEvent(driving,{...event,resolved:true,choice:'reroute'}),false);
});
test('a resolved animal wait disappears once the actual blocking window ends and expired events stay hidden',()=>{
  const blocked={...event,kind:'cattle' as const,resolved:true,choice:'stay' as const,blockingStartsAt:3,blockingUntil:7};
  assert.equal(showsRouteEvent(driving,blocked),true);
  assert.equal(showsRouteEvent({...driving,clockMinutes:7},blocked),false);
  assert.equal(showsRouteEvent({...driving,clockMinutes:20},event),false);
});

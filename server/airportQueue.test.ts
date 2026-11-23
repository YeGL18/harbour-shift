import assert from 'node:assert/strict';
import test from 'node:test';
import {HKG_AIRPORT} from '../shared/airport';
import {LANDMARK_BY_ID} from '../src/data/landmarks';
import {applyAirportAction,configureSharedFuelQueues,createInitialState,getVehiclePosition,setAcceptingOrders,requestEnergyRecovery,advanceGame} from '../src/game';
import {airportWorldOffers} from '../src/game/airport';
import {coordinateAirportQueues} from './airportQueue';
import {coordinateDispatch,type DispatchDriver} from './dispatch';
const waiting=LANDMARK_BY_ID.get(HKG_AIRPORT.waitingPlaceId)!;
function driver(id:string,joinedAt=0,diamond=false,vehicleId:'private'|'kam-fung'='private'):DispatchDriver{
 let game=configureSharedFuelQueues(createInitialState({advancedRulesVersion:1,proTier:diamond?'diamond':'blue',seed:1,vehicleId,startPlace:waiting,handoverPlace:null,dispatchManaged:true}),id);
 game=applyAirportAction({...game,clockMinutes:joinedAt},'join');return{id,nickname:id,connected:true,left:false,forfeited:false,game};
}
test('server owns monotone arrivals, Diamond tier priority and FIFO within each pool and tier',()=>{
 const drivers=[driver('ordinary-later',2),driver('diamond-later',3,true),driver('ordinary-first',0),driver('diamond-first',1,true),driver('taxi',0,false,'kam-fung')];
 const positions=drivers.map(d=>getVehiclePosition(d.game)),first=coordinateAirportQueues(drivers,[],0,4);
 assert.deepEqual(first.tickets.filter(t=>t.pool==='standard').map(t=>t.playerId),['diamond-first','diamond-later','ordinary-first','ordinary-later']);
 assert.equal(first.games.get('taxi')!.airportQueue!.position,1);
 for(let i=0;i<drivers.length;i++){const q=first.games.get(drivers[i].id)!.airportQueue!;assert.equal(q.assignmentPending,false);assert.deepEqual(getVehiclePosition(first.games.get(drivers[i].id)!),positions[i]);}
 const restored=coordinateAirportQueues(drivers.map(d=>({...d,game:first.games.get(d.id)!})),JSON.parse(JSON.stringify(first.tickets)),first.nextSequence,5);
 assert.deepEqual(restored.tickets,first.tickets);assert.equal(restored.nextSequence,first.nextSequence);
});
test('disconnect grace retains position, leave and manual stop remove it without teleporting',()=>{
 const first=coordinateAirportQueues([driver('early'),driver('later',1)],[],0,1);
 const offline=driver('early');offline.connected=false;offline.game=first.games.get('early')!;
 const later=driver('later');later.game=first.games.get('later')!;
 const retained=coordinateAirportQueues([offline,later],first.tickets,first.nextSequence,2);assert.equal(retained.games.get('early')!.airportQueue!.position,1);
 const leaving={...offline,left:true};later.game=setAcceptingOrders(later.game,false);const removed=coordinateAirportQueues([leaving,later],retained.tickets,retained.nextSequence,3);assert.equal(removed.tickets.length,0);assert.equal(removed.games.get('later')!.acceptingOrders,false);
});
test('a real airport request goes only to the connected first eligible tier ticket and cannot be claimed twice',()=>{
 const first=coordinateAirportQueues([driver('ordinary',0),driver('diamond',1,true)],[],0,2);let clock=2;
 let drivers=['ordinary','diamond'].map(id=>({...driver(id),game:first.games.get(id)!}));
 while(clock<30&&!airportWorldOffers({...drivers[0].game,clockMinutes:clock}).length)clock+=2;
 drivers=drivers.map(d=>({...d,game:{...d.game,clockMinutes:clock}}));const assigned=coordinateDispatch(drivers,1,clock,new Map());
 const winner=assigned.games.get('diamond')!;assert.ok(winner.currentOffer?.id.startsWith('airport-'));assert.ok(winner.currentOffer!.estimatedFare>0);assert.equal(assigned.games.get('ordinary')!.currentOffer,null);assert.equal(winner.airportQueue,null);
 const after=coordinateAirportQueues(drivers.map(d=>({...d,game:assigned.games.get(d.id)!})),first.tickets,first.nextSequence,clock);assert.equal(after.tickets.length,1);assert.equal(after.games.get('ordinary')!.airportQueue!.position,1);
 const claimed=coordinateDispatch(drivers,1,clock,new Map([[winner.currentOffer!.id,'diamond']]));assert.ok([...claimed.games.values()].every(g=>g.currentOffer?.id!==winner.currentOffer!.id));
});
test('queue cancellation for energy recovery never cancels the actual recovery service',()=>{
 const queued=driver('low').game,low={...queued,energy:{...queued.energy,remaining:0}};const recovery=requestEnergyRecovery(low);assert.equal(recovery.airportQueue,null);assert.equal(recovery.phase,'servicing');assert.ok(recovery.energyRecovery);const next=advanceGame(recovery,1);assert.equal(next.phase,'servicing');assert.ok(next.energyRecovery);
});
test('a disconnected Diamond cannot block a connected ordinary driver, and automatic acceptance makes one canonical claim',()=>{
 const first=coordinateAirportQueues([driver('ordinary',0),driver('diamond',0,true)],[],0,2);let clock=2;
 while(clock<30&&!airportWorldOffers({...first.games.get('ordinary')!,clockMinutes:clock}).length)clock+=2;
 const ds=['ordinary','diamond'].map(id=>({...driver(id),connected:id==='ordinary',game:{...first.games.get(id)!,clockMinutes:clock,autoAcceptOrders:true}}));
 const result=coordinateDispatch(ds,1,clock,new Map());assert.equal(result.acceptedClaims.length,1);assert.equal(result.acceptedClaims[0].playerId,'ordinary');assert.equal(result.games.get('ordinary')!.acceptedOffers,1);assert.ok(result.games.get('ordinary')!.activeTrip);assert.equal(result.games.get('diamond')!.activeTrip,null);
 const second=coordinateDispatch(ds.map(d=>({...d,game:result.games.get(d.id)!})),1,clock,new Map(result.acceptedClaims.map(c=>[c.offerId,c.playerId])),result.state);assert.equal(second.acceptedClaims.length,0);assert.equal(second.games.get('ordinary')!.acceptedOffers,1);
});
test('persisted duplicates cannot duplicate a position and restored priority derives from the frozen server game tier',()=>{
 const ds=[driver('blue'),driver('diamond',1,true)],first=coordinateAirportQueues(ds,[],0,2),bad=first.tickets.map(t=>({...t,priority:!t.priority}));
 const restored=coordinateAirportQueues(ds.map(d=>({...d,game:first.games.get(d.id)!})),[...bad,...bad],first.nextSequence,3);assert.equal(restored.tickets.length,2);assert.equal(restored.tickets[0].playerId,'diamond');assert.equal(restored.games.get('blue')!.airportQueue!.total,2);
});
test('an airport passenger reaches the fourth FIFO driver when earlier drivers cannot afford the legal trip energy',()=>{
 const ds=Array.from({length:4},(_,i)=>driver(`rank-${i}`,0));ds.slice(0,3).forEach(d=>{d.game={...d.game,energy:{...d.game.energy,remaining:.001}};});
 const first=coordinateAirportQueues(ds,[],0,2);let clock=2;while(clock<30&&!airportWorldOffers({...first.games.get('rank-3')!,clockMinutes:clock}).length)clock+=2;
 const result=coordinateDispatch(ds.map(d=>({...d,game:{...first.games.get(d.id)!,clockMinutes:clock}})),1,clock,new Map());
 assert.ok(result.games.get('rank-3')!.currentOffer?.id.startsWith('airport-'));assert.ok(ds.slice(0,3).every(d=>!result.games.get(d.id)!.currentOffer));
});

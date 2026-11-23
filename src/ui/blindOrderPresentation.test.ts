import test from 'node:test';
import assert from 'node:assert/strict';
import {acceptOffer,advanceGame,createInitialState} from '../game';
import type {ActiveTrip,Offer} from '../game';
import {completedFareReveals,isBlindBoarded,operatorBlindOrders,projectBlindGameState,projectBlindSnapshot} from '../../shared/blindOrders';
import {selectFareReveal} from './fareReveal';
import type {RoomSnapshot} from '../../shared/protocol';

const base=createInitialState({seed:20261118});
const pickup={id:'known-pickup',name:'Known pickup',kind:'transport' as const,district:'Known',lat:22.3,lon:114.17,nodeId:'known-node'};
const destination={id:'SECRET_DESTINATION_ID',name:'SECRET_DESTINATION_LABEL',nameEn:'SECRET_DESTINATION_EN',kind:'business' as const,district:'SECRET_DISTRICT',lat:22.399001,lon:114.299002,nodeId:'SECRET_DESTINATION_NODE'};
const offer:Offer={id:'offer-test',createdAt:0,expiresAt:5,pickup,destination,pickupDistanceM:100,pickupMinutes:1,tripDistanceM:89317,tripMinutes:243,estimatedFare:947.13,estimatedNet:912.37,surge:1.6,pickupRoute:['known-pickup-edge'],tripRoute:['SECRET_DESTINATION_EDGE'],pricingType:'taxi-upfront',pricingLabel:'Taxi',feedKind:'live'};
const trip:ActiveTrip={offer,acceptedAt:0,actualDistanceM:0,routePolicy:'fastest',waitMinutes:1,boardingMinutes:1,fareOnCompletion:725.44,canonicalDistanceM:89317,canonicalMinutes:243,paidDistanceM:0};
const state={...base,currentOffer:offer,activeTrip:trip,queuedTrip:{...trip,offer:{...offer,id:'next',reservation:'next-trip' as const}},observedOffers:[offer],ghostOffers:[offer],ghostOffer:offer,logs:[{id:'leak-log',minute:0,kind:'accept' as const,text:'SECRET_DESTINATION_LABEL · 947.13'}]};
const containsSecret=(value:unknown)=>/SECRET_DESTINATION|SECRET_DISTRICT|22\.399001|114\.299002|947\.13|912\.37|725\.44|89317/.test(JSON.stringify(value));

test('operator mode defaults off and the normal view remains byte-for-byte unchanged',()=>{
  for(const value of [undefined,false,'0','false','true','yes',1])assert.equal(operatorBlindOrders(value),false);
  assert.equal(operatorBlindOrders('1'),true);assert.equal(projectBlindGameState(state,false),state);
});
test('preboarding projection removes destination identifiers geometry fare and hidden logs from every offer lane',()=>{
  const before=JSON.stringify(state),view=projectBlindGameState(state,true);
  assert.equal(containsSecret(view),false);assert.equal(JSON.stringify(state),before,'projection must not mutate canonical physics or economics');
  assert.equal(view.currentOffer!.pickup,pickup);assert.deepEqual(view.currentOffer!.pickupRoute,offer.pickupRoute);
  assert.deepEqual(view.currentOffer!.tripRoute,[]);assert.equal(view.currentOffer!.destination.name,'上車後顯示目的地');
  assert.equal(view.activeTrip!.fareOnCompletion,0);assert.equal(view.grossIncome,state.grossIncome);assert.equal(view.netIncome,state.netIncome);
});
test('destination is revealed only after actual pickedUpAt, next-trip and fare stay hidden',()=>{
  assert.equal(isBlindBoarded(state),false);
  const boarding=projectBlindGameState({...state,phase:'boarding' as const},true);assert.notEqual(boarding.activeTrip!.offer.destination.id,destination.id);
  const view=projectBlindGameState({...state,phase:'dropoff' as const,activeTrip:{...trip,pickedUpAt:0}},true);
  assert.equal(view.activeTrip!.offer.destination,destination);assert.deepEqual(view.activeTrip!.offer.tripRoute,offer.tripRoute);
  assert.equal(view.activeTrip!.offer.estimatedFare,0);assert.equal(view.activeTrip!.fareOnCompletion,0);
  assert.notEqual(view.queuedTrip!.offer.destination.id,destination.id);assert.deepEqual(view.queuedTrip!.offer.tripRoute,[]);
});
test('cached full-state responses, peer activity and finished decisions cannot bypass the blind policy',()=>{
  const snapshot={room:{orderVisibility:{blindOrders:true},players:[{id:'peer',route:[{lat:22.399001,lon:114.299002}],order:{pickupName:'Known pickup',destinationName:destination.name,destinationNameEn:destination.nameEn,phase:'pickup'}}],competition:{availableDrivers:1,assignments:[{offerId:'test',destinationName:destination.name,destinationNameEn:destination.nameEn,destinationLocality:'SECRET_DISTRICT',estimatedFare:947.13}]}},ownState:state,review:{players:[{timeline:[{type:'accept',label:destination.name,amount:947.13}]}]}} as unknown as RoomSnapshot;
  assert.equal(containsSecret(projectBlindSnapshot(snapshot)),false);
  assert.equal(projectBlindSnapshot({...snapshot,room:{...snapshot.room,orderVisibility:undefined}}).ownState,state);
});
test('only actual completion logs reveal fare; reconnect snapshots do not restart the six-real-second notice',()=>{
  assert.deepEqual(completedFareReveals(state),[]);
  const complete={...state,logs:[{id:'completed-id',kind:'dropoff' as const,minute:12,text:'Known destination · 完成行程',amount:65.71},...state.logs]};
  const reveals=completedFareReveals(complete),seen=new Set<string>();assert.deepEqual(reveals,[{id:'completed-id',minute:12,amount:65.71,destinationName:'Known destination'}]);
  const notice=selectFareReveal(reveals,seen,1000);assert.equal(notice!.expiresAt,7000);assert.equal(selectFareReveal(reveals,seen,2000),null);
  assert.equal(selectFareReveal([{...reveals[0],id:'cancelled',amount:NaN}],seen,3000),null);
});
test('real engine pickup boarding completion retains the fare and only reveals at the correct lifecycle boundaries',()=>{
  let actual=createInitialState({seed:20261118});assert.ok(actual.currentOffer);
  const expectedDestination=actual.currentOffer.destination.id;
  actual=acceptOffer(actual);assert.ok(actual.activeTrip);
  const contractedFare=actual.activeTrip.fareOnCompletion;let sawBoarded=false;
  for(let tick=0;tick<4000&&actual.completedTrips===0;tick++){
    const view=projectBlindGameState(actual,true);
    assert.equal(view.activeTrip?.fareOnCompletion,0);
    assert.equal(view.activeTrip?.offer.estimatedFare,0);
    if(isBlindBoarded(actual)){sawBoarded=true;assert.equal(view.activeTrip!.offer.destination.id,expectedDestination);}
    else assert.notEqual(view.activeTrip!.offer.destination.id,expectedDestination);
    assert.deepEqual(completedFareReveals(view),[]);
    actual=advanceGame(actual,.05);
  }
  assert.equal(sawBoarded,true);assert.equal(actual.completedTrips,1);
  const complete=projectBlindGameState(actual,true),reveal=completedFareReveals(complete)[0];
  assert.ok(reveal);assert.equal(reveal.amount,actual.grossIncome);assert.ok(reveal.amount>=0);
  assert.equal(actual.activeTrip,null);assert.ok(contractedFare>0);
  assert.equal(complete.netIncome,actual.netIncome);
});

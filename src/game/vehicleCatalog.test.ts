/// <reference types="node" />
import assert from 'node:assert/strict';
import test from 'node:test';
import {VEHICLES,VEHICLE_BY_ID,getRentalCost} from '../data/vehicles';
import {ALL_VEHICLE_IDS,EXTENDED_VEHICLE_IDS,LEGACY_VEHICLE_IDS,passengerCapacity,vehicleAccessProfile,vehicleSupportsXL} from './vehicleCapabilities';
import {estimateDriverPayout,isOfferEligibleForVehicle,pricingTypesForVehicle,XL_GAME_RULES} from '../data/fares';
import {getVehicleGraph} from './access';
import {isPlaceAllowed} from '../data/vehicleAccess';
import {acceptOffer,advanceGame,createInitialState,getVehiclePosition,getWorldDemandCandidates,normalizeGameState,quoteWorldOffer,setDispatchOffer} from './engine';
import type {GameState,Landmark,Offer,RoadGraph} from './types';

const graph:RoadGraph={nodes:{a:{id:'a',lat:22.305,lon:114.166},b:{id:'b',lat:22.308,lon:114.166},c:{id:'c',lat:22.307,lon:114.170}},edges:{},outgoing:{}};
for(const [a,b] of [['a','b'],['b','a'],['b','c'],['c','b'],['c','a'],['a','c']]){const id=`${a}-${b}`;graph.edges[id]={id,from:a,to:b,lengthM:500,speedKph:30,safeStop:true,name:'遊戲測試路'};(graph.outgoing[a]??=[]).push(id);}
const landmarks:Landmark[]=Object.values(graph.nodes).map((node,index)=>({...node,nodeId:node.id,id:index===0?'harbour-city':index===1?'megabox':'p3',name:`測試地點${index}`,district:'油尖旺區',kind:index===0?'residential':'business'}));
const fresh=(vehicleId:GameState['vehicleId']='alphard-hybrid',seed=1,xlOrdersEnabled=true)=>createInitialState({seed,vehicleId,graph,landmarks,handoverPlace:null,dispatchManaged:true,xlOrdersEnabled,startTimeMinutes:510});
function xlFixture():{state:GameState;offer:Offer}{
 for(let seed=1;seed<=60;seed++){const state=fresh('alphard-hybrid',seed);for(let start=0;start<20;start+=5){const offer=getWorldDemandCandidates(state,getVehiclePosition(state,graph),start,start+5,graph).find(offer=>offer.serviceType==='xl');if(offer)return{state,offer};}}
 throw new Error('No seeded XL demand fixture');
}

test('catalog keeps legacy IDs and defines each named variant, passenger capacity and honest game assumptions',()=>{
 assert.equal(new Set(VEHICLES.map(vehicle=>vehicle.id)).size,12);assert.deepEqual(VEHICLES.map(vehicle=>vehicle.id),ALL_VEHICLE_IDS);
 for(const id of LEGACY_VEHICLE_IDS)assert.equal(VEHICLE_BY_ID[id].id,id);
 for(const id of EXTENDED_VEHICLE_IDS){const vehicle=VEHICLE_BY_ID[id];assert.equal(vehicle.type,'private');assert.equal(vehicleAccessProfile(id),'private');assert.equal(vehicle.totalSeats,passengerCapacity(id)+1);assert.ok(vehicle.specificationSource?.startsWith('https://'));assert.ok(vehicle.gameAssumptions);assert.equal(vehicle.rentalSource,'game-config');assert.equal(getRentalCost(id,'day',123,360),123);assert.ok(vehicle.energyProfile&&vehicle.energyProfile.capacity>0);assert.equal(vehicle.fuelCostPerKm,vehicle.energyProfile!.consumptionPerKm*vehicle.energyProfile!.unitPrice);}
 assert.equal(VEHICLE_BY_ID['aion-y-plus-standard'].modelVariant,'香港Standard・5座');assert.equal(VEHICLE_BY_ID['aion-y-plus-premium'].passengerCapacity,4);
 assert.equal(VEHICLE_BY_ID['mg4-trophy'].energyProfile?.capacity,64);assert.equal(VEHICLE_BY_ID['alphard-hybrid'].energyProfile?.kind,'petrol');
 for(const id of ALL_VEHICLE_IDS)assert.equal(vehicleSupportsXL(id),id==='alphard-hybrid'||id==='vellfire-hybrid');
});

test('all new private models share private legal roads and never inherit red-taxi Discovery Bay access',()=>{
 const taxi=getVehicleGraph('kam-fung'),privateGraph=getVehicleGraph('private');
 const taxiOnly=Object.values(taxi.nodes).find(node=>!privateGraph.nodes[node.id]&&node.lon>114&&node.lon<114.033)!;assert.ok(taxiOnly);
 const place:Landmark={...taxiOnly,nodeId:taxiOnly.id,id:'taxi-only-north-db',name:'的士可達點',district:'離島區',kind:'transport'};
 for(const id of EXTENDED_VEHICLE_IDS){assert.equal(getVehicleGraph(id),privateGraph);assert.equal(isPlaceAllowed(place,id),false);}
});

test('XL is a distinct 5–6 passenger pool with exactly one explicitly game-based payout premium',()=>{
 const xl={pricingType:'private-xl' as const,serviceType:'xl' as const,passengerCount:6};
 for(const vehicle of VEHICLES){assert.equal(isOfferEligibleForVehicle(vehicle,xl),vehicleSupportsXL(vehicle));assert.equal(pricingTypesForVehicle(vehicle).includes('private-xl'),vehicleSupportsXL(vehicle));}
 const vehicle=VEHICLE_BY_ID['alphard-hybrid'];for(const count of [0,4,7,6.5])assert.equal(isOfferEligibleForVehicle(vehicle,{...xl,passengerCount:count}),false);
 assert.equal(isOfferEligibleForVehicle(vehicle,xl,false),false);assert.equal(isOfferEligibleForVehicle(vehicle,{...xl,pricingType:'private-upfront'}),false);
 assert.equal(isOfferEligibleForVehicle(vehicle,{pricingType:'private-upfront',passengerCount:5}),false);
 const standard=estimateDriverPayout(vehicle,8321,24.8,1.35,'private-upfront');const payout=estimateDriverPayout(vehicle,8321,24.8,1.35,'private-xl');assert.equal(payout,Math.round(standard*XL_GAME_RULES.netPayoutMultiplier*100)/100);
});

test('seeded real demand publishes XL passenger counts and solo acceptance preserves its locked completion price',()=>{
 const {state,offer}=xlFixture();assert.ok([5,6].includes(offer.passengerCount!));assert.equal(offer.pricingType,'private-xl');
 const quoted=quoteWorldOffer(state,offer,{},graph)!;assert.ok(quoted);const shown=setDispatchOffer(state,quoted,graph);assert.equal(shown.currentOffer?.serviceType,'xl');
 const accepted=acceptOffer(shown,graph);assert.equal(accepted.acceptedOffers,1);assert.equal(accepted.activeTrip?.offer.passengerCount,offer.passengerCount);const expected=accepted.activeTrip!.fareOnCompletion;
 let finished=accepted;for(let tick=0;tick<120&&finished.completedTrips===0;tick++)finished=advanceGame(finished,.25,graph);
 assert.equal(finished.completedTrips,1);assert.equal(finished.grossIncome,expected);assert.ok(expected>0);
 const tesla=fresh('tesla-model-y',state.seed);assert.equal(quoteWorldOffer(tesla,offer,{},graph),null);assert.equal(setDispatchOffer(tesla,offer,graph),tesla);assert.equal(acceptOffer({...tesla,currentOffer:offer},graph).acceptedOffers,0);
});

test('old saves and explicitly legacy rooms never acquire XL, while a new capable save restores its exact contract',()=>{
 const state=fresh('alphard-hybrid',22);const old={...state,vehicleId:'private' as const};delete old.xlOrdersEnabled;
 assert.equal(normalizeGameState(old,graph)?.xlOrdersEnabled,false);
 const legacy=fresh('alphard-hybrid',22,false);for(let start=0;start<30;start+=5)assert.ok(getWorldDemandCandidates(legacy,getVehiclePosition(legacy,graph),start,start+5,graph).every(offer=>offer.pricingType!=='private-xl'));
 const {state:source,offer}=xlFixture(),shown=setDispatchOffer(source,quoteWorldOffer(source,offer,{},graph)!,graph);const restored=normalizeGameState(shown,graph)!;assert.equal(restored.xlOrdersEnabled,true);assert.equal(restored.currentOffer?.id,offer.id);assert.equal(restored.currentOffer?.passengerCount,offer.passengerCount);
});

test('an XL next-trip reservation retains capacity and price without replacing the passenger already aboard',()=>{
 const {state,offer}=xlFixture();
 const first=quoteWorldOffer(state,{...offer,id:'first-standard',pricingType:'private-upfront',serviceType:'standard',passengerCount:3},{},graph)!;
 let carrying=acceptOffer(setDispatchOffer(state,first,graph),graph);
 for(let tick=0;tick<80&&carrying.phase!=='dropoff';tick++)carrying=advanceGame(carrying,.05,graph);
 assert.equal(carrying.phase,'dropoff');const originalId=carrying.activeTrip!.offer.id;
 const next=quoteWorldOffer(carrying,{...offer,id:'next-xl'}, {reservation:'next-trip'},graph)!;assert.ok(next);
 const booked=acceptOffer(setDispatchOffer(carrying,next,graph),graph);
 assert.equal(booked.activeTrip!.offer.id,originalId);assert.equal(booked.queuedTrip!.offer.id,'next-xl');assert.equal(booked.queuedTrip!.offer.passengerCount,offer.passengerCount);assert.equal(booked.acceptedOffers,2);
 let activated=booked;for(let tick=0;tick<100&&activated.completedTrips===0;tick++)activated=advanceGame(activated,.05,graph);
 assert.equal(activated.completedTrips,1);assert.equal(activated.activeTrip?.offer.id,'next-xl');assert.equal(activated.queuedTrip,null);assert.equal(activated.acceptedOffers,2);
});

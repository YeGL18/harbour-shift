import test from 'node:test';import assert from 'node:assert/strict';
import {createInitialState,normalizeGameState,advanceGame,setDispatchOffer,acceptOffer,quoteWorldOffer,canReceiveOffer} from './engine';
import {readOrderPreferences} from '../../shared/orderPolicy';import {allowedOrderPricingTypes,defaultOrderPreferences,isPreferredOffer,normalizeOrderPreferences,toggleOrderType} from './orderPreferences';
import {airportPoolForVehicle,hasAirportOrderType} from './airport';import {eliteEnabled} from './elite';
import type {GameState,Landmark,Offer,PricingType,RoadGraph} from './types';
const graph:RoadGraph={nodes:{a:{id:'a',lat:22.3,lon:114.16},b:{id:'b',lat:22.301,lon:114.16}},edges:{ab:{id:'ab',from:'a',to:'b',name:'測試街',lengthM:100,speedKph:20,safeStop:true},ba:{id:'ba',from:'b',to:'a',name:'測試街',lengthM:100,speedKph:20,safeStop:true}},outgoing:{a:['ab'],b:['ba']}};
const places:Landmark[]=['harbour-city','megabox'].map((id,i)=>({...graph.nodes[i?'b':'a'],id,nodeId:i?'b':'a',name:id,kind:'shopping',district:'油尖旺區'}));
const prefs=(...enabledPricingTypes:PricingType[])=>({enabledPricingTypes});
const fresh=(types?:PricingType[],vehicleId:GameState['vehicleId']='alphard-hybrid')=>createInitialState({graph,landmarks:places,seed:0,vehicleId,advancedRulesVersion:1,eliteCertified:true,xlOrdersEnabled:true,handoverPlace:null,dispatchManaged:true,...(types?{orderPreferences:prefs(...types)}:{})});
const source:Offer={id:'test-order',createdAt:0,requestedAt:0,expiresAt:4,pickup:places[0],destination:places[1],pickupDistanceM:0,pickupMinutes:0,pickupRoute:[],tripRoute:['ab'],tripDistanceM:100,tripMinutes:.3,estimatedFare:40,estimatedNet:39,surge:1,pricingType:'private-upfront',pricingLabel:'UberX',serviceType:'standard',passengerCount:4,feedKind:'live'};
test('the preflight schema rejects unknown/duplicate prices and mixed Elite while ordinary switches can combine',()=>{
 for(const value of[{},prefs('private-upfront','private-upfront'),{enabledPricingTypes:['fake']},prefs('private-elite','private-upfront'),{...prefs('private-upfront'),certified:true}])assert.equal(readOrderPreferences(value),undefined);
 assert.deepEqual(readOrderPreferences(prefs('private-xl','private-upfront')),prefs('private-upfront','private-xl'));assert.deepEqual(toggleOrderType(prefs('private-upfront','private-xl'),'private-elite',true),prefs('private-elite'));assert.deepEqual(toggleOrderType(prefs('private-elite'),'private-upfront',true),prefs('private-upfront'));assert.deepEqual(toggleOrderType(prefs('private-upfront'),'private-xl',true),prefs('private-upfront','private-xl'));
});
test('vehicle/capacity and certificate checks remain mandatory even when a type is selected',()=>{
 assert.ok(!allowedOrderPricingTypes('tesla-model-3',true).includes('private-xl'));assert.ok(!allowedOrderPricingTypes('alphard-hybrid',false).includes('private-elite'));assert.deepEqual(normalizeOrderPreferences(prefs('private-xl','taxi-metered'),'tesla-model-3',false),prefs());
 assert.equal(isPreferredOffer(fresh(['private-upfront']),source),true);assert.equal(isPreferredOffer(fresh(['private-upfront']),{...source,passengerCount:5}),false);assert.equal(isPreferredOffer(fresh(['private-xl']),{...source,pricingType:'private-xl',serviceType:'xl',passengerCount:6}),true);assert.equal(isPreferredOffer(fresh(['private-xl']),{...source,pricingType:'private-xl',serviceType:'xl',passengerCount:7}),false);
 assert.equal(eliteEnabled(fresh(['private-elite'])),true);assert.equal(eliteEnabled({...fresh(['private-elite']),eliteCertified:false}),false);assert.equal(eliteEnabled(fresh(['private-upfront'])),false);
});
test('solo, next/live dispatch entry points and direct acceptance all enforce the same frozen selection',()=>{
 const state=fresh(['private-xl']);assert.equal(quoteWorldOffer(state,source,{},graph),null);assert.equal(setDispatchOffer(state,source,graph),state);assert.equal(acceptOffer({...state,currentOffer:source},graph).acceptedOffers,0);
 const xl={...source,id:'xl',pricingType:'private-xl' as const,serviceType:'xl' as const,passengerCount:6};const assigned=setDispatchOffer(state,xl,graph);assert.equal(assigned.currentOffer!.id,'xl');assert.equal(acceptOffer(assigned,graph).acceptedOffers,1);
 const onlyElite=fresh(['private-elite']);assert.equal(canReceiveOffer(onlyElite),false);assert.equal(advanceGame(onlyElite,1,graph).currentOffer,null);assert.equal(canReceiveOffer(fresh([])),false);
});
test('taxi meter,85percent and upfront toggles are independent and cannot grant private cars taxi eligibility',()=>{
 const state=fresh(['taxi-metered','taxi-discount85'],'kam-fung');for(const type of['taxi-metered','taxi-discount85']as const)assert.equal(isPreferredOffer(state,{...source,pricingType:type}),true);assert.equal(isPreferredOffer(state,{...source,pricingType:'taxi-upfront'}),false);assert.equal(isPreferredOffer(state,source),false);assert.equal(isPreferredOffer(fresh(['taxi-metered'],'private'),{...source,pricingType:'taxi-metered'}),false);
});
test('old saves retain their legacy eligibility, while explicit blind/price choices survive restart without aliasing inputs',()=>{
 const input=prefs('private-upfront'),state=createInitialState({graph,landmarks:places,vehicleId:'alphard-hybrid',handoverPlace:null,dispatchManaged:true,orderPreferences:input,blindOrders:false});input.enabledPricingTypes.push('private-xl');assert.deepEqual(state.orderPreferences,prefs('private-upfront'));
 const restored=normalizeGameState(JSON.parse(JSON.stringify(state)),graph)!;assert.equal(restored.blindOrders,false);assert.deepEqual(restored.orderPreferences,prefs('private-upfront'));assert.notEqual(restored.orderPreferences,state.orderPreferences);
 const legacy=normalizeGameState({...state,orderPreferences:undefined,blindOrders:undefined},graph)!;assert.equal(legacy.orderPreferences,undefined);assert.equal(legacy.blindOrders,undefined);assert.equal(isPreferredOffer(legacy,{...source,pricingType:'private-xl',serviceType:'xl',passengerCount:6}),true);
});
test('airport private/XL pool follows the actual selected type, and Elite-only or closed taxi pricing cannot enter an incompatible queue',()=>{
 assert.equal(airportPoolForVehicle(fresh(['private-upfront'])),'standard');assert.equal(airportPoolForVehicle(fresh(['private-xl'])),'xl');assert.equal(hasAirportOrderType(fresh(['private-elite'])),false);assert.equal(hasAirportOrderType(fresh(['taxi-metered'],'kam-fung')),false);assert.equal(hasAirportOrderType(fresh(['taxi-upfront'],'kam-fung')),true);assert.equal(airportPoolForVehicle(fresh(['private-upfront'],'kam-fung')),'standard');assert.equal(hasAirportOrderType(fresh(['private-upfront'],'kam-fung')),true);assert.equal(airportPoolForVehicle(fresh(['private-upfront','private-xl'])),'xl');assert.equal(hasAirportOrderType(fresh([])),false);
});

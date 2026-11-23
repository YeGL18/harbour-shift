/// <reference types="node" />
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPlayerSetup, parseRoomCost, playerSetupMatches } from './setup';
import { LANDMARK_BY_ID } from '../data/landmarks';
import type { RoomPlayer } from '../../shared/protocol';
import { setup as validateWireSetup } from '../../server/validation';

test('named player setup sends canonical places and explicit costs while omitting the individual clock',()=>{
  const startPlace=LANDMARK_BY_ID.get('harbour-city')!,handoverPlace=LANDMARK_BY_ID.get('megabox')!;
  const preferences={vehicleId:'kam-fung' as const,startPlace,handoverPlace,rentalOverride:0,energyUnitPriceOverride:0,seed:123,startHour:'07',startMinute:'35',startTimeMinutes:455};
  const result=buildPlayerSetup(preferences);
  assert.deepEqual(result,{vehicleId:'kam-fung',startPlaceId:'harbour-city',handoverPlaceId:'megabox',rentalOverride:0,energyUnitPriceOverride:0});
  assert.deepEqual(validateWireSetup(result),result);
});

test('custom start/handover sends legal road-node references instead of invented passenger place IDs',()=>{
  const place={...LANDMARK_BY_ID.get('harbour-city')!,id:'custom-map-start',name:'自選開工點'};
  const result=buildPlayerSetup({vehicleId:'private',startPlace:place,handoverPlace:null});
  assert.deepEqual(result,{vehicleId:'private',startNodeId:place.nodeId,handoverNodeId:place.nodeId});
  assert.deepEqual(validateWireSetup(result),result);
});

test('changed car or collection point is not treated as the already-ready server setup',()=>{
  const base={vehicleId:'kam-fung' as const,startPlaceId:'harbour-city',handoverPlaceId:'megabox'};
  const player:RoomPlayer={...base,id:'server-issued-player',nickname:'測試車長',connected:true,ready:true,status:'lobby',joinedAt:0};
  assert.ok(playerSetupMatches(player,base));
  assert.ok(!playerSetupMatches(player,{...base,vehicleId:'private'}));
  assert.ok(!playerSetupMatches(player,{...base,startPlaceId:'central'}));
  assert.ok(!playerSetupMatches(player,{...base,handoverPlaceId:'central'}));
  assert.ok(!playerSetupMatches(player,{...base,rentalOverride:0}));
});

test('room cost blank restores defaults; zero and decimal values remain intentional',()=>{
  assert.equal(parseRoomCost('  ',1000),undefined);
  assert.equal(parseRoomCost('0',1000),0);
  assert.equal(parseRoomCost(' 4.57 ',1000),4.57);
  assert.equal(parseRoomCost('100000',100000),100000);
  for(const value of ['-1','Infinity','NaN','1e3','1,000','4.5.7','1000.1'])assert.throws(()=>parseRoomCost(value,1000));
});

test('new room uses the saved auto-accept preference instead of another saved shift state',()=>{
  const startPlace=LANDMARK_BY_ID.get('harbour-city')!;
  const setup=buildPlayerSetup({vehicleId:'kam-fung',startPlace,handoverPlace:null,autoAcceptEnabled:false,autoAcceptPreference:true});
  assert.equal(setup.autoAcceptOrders,true);assert.deepEqual(validateWireSetup(setup),setup);
});

import test from'node:test';import assert from'node:assert/strict';import{RoomAuthority}from'./authority';
const rejected=(error:any)=>error.code==='room_version'&&error.status===409;
test('advanced rules latch only for explicitly compatible new rooms, while old rooms never upgrade from joining client advertisements',async()=>{
 const authority=new RoomAuthority();
 for(const input of[{advancedRulesVersion:2},{advancedRulesVersion:1},{advancedRulesVersion:1,featureVersion:'0.5',vehicleCatalogVersion:1}])await assert.rejects(()=>authority.createRoom({nickname:'Unsupported',...input}as any),rejected);
 const old=await authority.createRoom({nickname:'Old',featureVersion:'0.6',vehicleCatalogVersion:1});const joined=await authority.joinRoom(old.roomCode,{nickname:'Modern reader',featureVersion:'0.6',vehicleCatalogVersion:1,advancedRulesVersion:1});assert.equal(joined.snapshot.room.advancedRulesVersion,undefined);
 const modern=await authority.createRoom({nickname:'Modern',featureVersion:'0.6',vehicleCatalogVersion:1,advancedRulesVersion:1});assert.equal(modern.snapshot.room.advancedRulesVersion,1);
 await assert.rejects(()=>authority.joinRoom(modern.roomCode,{nickname:'Catalog only',featureVersion:'0.6',vehicleCatalogVersion:1}),rejected);
 await assert.rejects(()=>authority.joinRoom(modern.roomCode,{nickname:'Unknown',featureVersion:'0.6',vehicleCatalogVersion:1,advancedRulesVersion:2 as any}),rejected);
 assert.equal((await authority.joinRoom(modern.roomCode,{nickname:'Advanced',featureVersion:'0.6',vehicleCatalogVersion:1,advancedRulesVersion:1})).snapshot.room.advancedRulesVersion,1);
 assert.throws(()=>authority.requireAdvancedRules(modern.roomCode,undefined),rejected);assert.throws(()=>authority.requireAdvancedRules(modern.roomCode,'1'),rejected);assert.doesNotThrow(()=>authority.requireAdvancedRules(modern.roomCode,1));assert.doesNotThrow(()=>authority.requireAdvancedRules(old.roomCode,undefined));
});
test('forward-safe feature rollback closes new advanced rooms while preserving authenticated reads of previously issued rooms',async()=>{
 const authority=new RoomAuthority(),room=await authority.createRoom({nickname:'Existing',featureVersion:'0.6',vehicleCatalogVersion:1,advancedRulesVersion:1});const cold=new RoomAuthority({allowAdvancedRooms:false});cold.deserializeRoom(authority.serializeRoom(room.roomCode)!);
 assert.equal((await cold.readSnapshot(room.roomCode,room.resumeToken)).room.advancedRulesVersion,1);assert.doesNotThrow(()=>cold.requireAdvancedRules(room.roomCode,1));
 await assert.rejects(()=>cold.createRoom({nickname:'Closed advanced',featureVersion:'0.6',vehicleCatalogVersion:1,advancedRulesVersion:1}),rejected);
 assert.equal((await cold.createRoom({nickname:'Catalog remains',featureVersion:'0.6',vehicleCatalogVersion:1})).snapshot.room.vehicleCatalogVersion,1);
});
test('legacy rooms reject all new explicit game action families without mutating their sequence or enabling features',async()=>{
 const authority=new RoomAuthority(),room=await authority.createRoom({nickname:'Legacy',featureVersion:'0.6',vehicleCatalogVersion:1});
 for(const action of[{type:'airport',choice:'go'},{type:'elite-booking',bookingId:'elite-1-0',choice:'accept'}])await assert.rejects(()=>authority.handleCommand(room.roomCode,room.resumeToken,{seq:1,action}as any),rejected);
 const snapshot=await authority.readSnapshot(room.roomCode,room.resumeToken);assert.equal(snapshot.you.lastInputSeq,0);assert.equal(snapshot.room.advancedRulesVersion,undefined);
});

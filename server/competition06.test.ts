import assert from 'node:assert/strict';
import test from 'node:test';
import {gzipSync} from 'node:zlib';
import {RoomAuthority} from './authority';
import {defaultSimulation,type GameSimulation} from './simulation';
import type {RoomAction,RoomFeatureVersion,RoomSession} from '../shared/protocol';
import {getWorldEventSchedule,getWorldEventViews} from '../shared/worldEvents';
import {LANDMARK_BY_ID} from '../src/data/landmarks';
import {createReviewRecorder,recordReviewAction,sampleReviewRoute,REVIEW_MAX_EVENTS,REVIEW_MAX_ROUTE_POINTS} from './review';

async function fixture(options:{version?:RoomFeatureVersion;count?:number;mode?:'team-net'|'highest-net';duration?:360|720|1440;simulation?:GameSimulation}={}){
  let now=1_800_000_000_000;const authority=new RoomAuthority({now:()=>now,simulation:options.simulation});
  const version=options.version||'0.6';const host=await authority.createRoom({nickname:'Driver 1',featureVersion:version,rules:{mode:options.mode||'highest-net',speed:60,...(options.duration?{shiftDurationMinutes:options.duration}:{})}});
  const sessions=[host];for(let i=1;i<(options.count||2);i++)sessions.push(await authority.joinRoom(host.roomCode,{nickname:`Driver ${i+1}`,featureVersion:version}));
  const sequences=new Map<string,number>();
  const send=async(player:RoomSession,action:RoomAction)=>{const seq=(sequences.get(player.playerId)||0)+1;const snapshot=await authority.handleCommand(host.roomCode,player.resumeToken,{seq,action});sequences.set(player.playerId,seq);player.snapshot=snapshot;return snapshot;};
  const add=(ms:number)=>{now+=ms;authority.applyPresence(host.roomCode,sessions.map(player=>({playerId:player.playerId,lastSeen:now,forfeitedAt:null})),now);};
  const start=async()=>{for(const player of sessions)await send(player,{type:'ready',ready:true});const countdown=await send(host,{type:'start'});if(countdown.room.loading)for(const player of sessions)await send(player,{type:'map-ready',epoch:countdown.room.loading.epoch,ready:true});add(3000);return authority.readSnapshot(host.roomCode,host.resumeToken);};
  return{authority,sessions,host,send,start,add,now:()=>now,sequences};
}

function clockSimulation(endAt?:number,calls?:Array<{from:number;to:number;event?:string}>):GameSimulation {
  return{...defaultSimulation,
    create(setup,rules,seed){return{...defaultSimulation.create(setup,rules,seed),acceptingOrders:false,parking:{kind:'rest',startedAt:0}};},
    advance(state,minutes){const limit=endAt??state.shiftDurationMinutes??720;const target=Math.min(limit,state.clockMinutes+minutes);calls?.push({from:state.clockMinutes,to:target,event:state.worldEvent?.id});return{...state,clockMinutes:target,idleMinutes:(state.idleMinutes||0)+Math.max(0,target-state.clockMinutes),phase:target>=limit?'ended':state.phase,handoverStatus:target>=limit?'on-time':state.handoverStatus};},
    apply(state,action){return{...state,logs:[{id:`${state.clockMinutes}-${action.type}`,kind:'parking' as const,minute:state.clockMinutes,text:action.type},...state.logs].slice(0,100)};},
  };
}

test('0.6 schedules use real named HK anchors, deterministic seed, and half/full bounded windows',()=>{
  for(const duration of [360,720,1440]as const){
    const schedule=getWorldEventSchedule(20261120,duration);assert.ok(schedule.length>0&&schedule.length<=duration/180);assert.deepEqual(schedule,getWorldEventSchedule(20261120,duration));
    for(const event of schedule){const place=LANDMARK_BY_ID.get(event.pickupPlaceId);assert.ok(place,event.pickupPlaceId);assert.ok(Math.abs(place.lat-event.center.lat)<.001);assert.ok(event.startsAt>=0&&event.endsAt<=duration&&event.endsAt>event.startsAt);assert.ok(event.demandBoost>=1&&event.demandBoost<=3);assert.deepEqual(getWorldEventViews(20261120,event.startsAt,duration).find(view=>view.status==='active')?.id,event.id);assert.equal(getWorldEventViews(20261120,event.endsAt,duration).some(view=>view.id===event.id),false);}
    assert.notDeepEqual(schedule,getWorldEventSchedule(20261121,duration));assert.ok(getWorldEventViews(20261120,0,duration).length<=2);
  }
});

test('evening crowds never run in the morning and closed hours can stay quiet',()=>{
  for(const start of [0,180,300,540,900,1020,1260] as const){
    const events=getWorldEventSchedule(491,1440,start);
    for(const event of events.filter(event=>event.title.endsWith('散場人潮'))){
      const minute=(start+event.startsAt)%1440;
      assert.ok(minute>=19*60+30&&minute<23*60+45);
    }
  }
  const morning=getWorldEventSchedule(789,360,300);
  assert.ok(morning.some(event=>event.title.endsWith('通勤人潮')));
  assert.ok(!morning.some(event=>event.title.endsWith('散場人潮')));
});

test('explicit 0.6 gates new rules while new clients can resume full twelve-hour 0.5 rooms',async()=>{
  const modern=await fixture();assert.equal(modern.host.snapshot.room.shiftDurationMinutes,360);
  await assert.rejects(()=>modern.authority.joinRoom(modern.host.roomCode,{nickname:'Old',featureVersion:'0.5'}),(error:any)=>error.code==='room_version');
  const old=await fixture({version:'0.5'});const joining=await old.authority.joinRoom(old.host.roomCode,{nickname:'New client',featureVersion:'0.6'});old.sessions.push(joining);assert.equal(joining.snapshot.room.featureVersion,'0.5');assert.equal(joining.snapshot.room.shiftDurationMinutes,720);
  await assert.rejects(()=>old.authority.createRoom({nickname:'Unsupported',featureVersion:'0.5',rules:{shiftDurationMinutes:360}}),(error:any)=>error.code==='room_version');
  await assert.rejects(()=>old.send(old.host,{type:'rules',rules:{mode:'team-net'}}),(error:any)=>error.code==='room_version');
  await old.start();const saved=JSON.parse(old.authority.serializeRoom(old.host.roomCode)!);delete saved.metadata.room.shiftDurationMinutes;
  const restore=new RoomAuthority({now:old.now});restore.deserializeRoom(JSON.stringify(saved));const snapshot=await restore.readSnapshot(old.host.roomCode,old.host.resumeToken);assert.equal(snapshot.ownState!.shiftDurationMinutes,720);assert.equal(snapshot.room.worldEvents,undefined);assert.equal(snapshot.review,undefined);
});

test('team lobby balances new joins, permits self swaps, resets only own readiness, and requires exact 2v2',async()=>{
  const match=await fixture({mode:'team-net',count:4,simulation:clockSimulation()});const [host,b,c,d]=match.sessions;
  let snapshot=await match.authority.readSnapshot(host.roomCode,host.resumeToken);assert.deepEqual(snapshot.room.players.map(player=>player.teamId),['A','B','A','B']);
  await assert.rejects(()=>match.authority.joinRoom(host.roomCode,{nickname:'Fifth',featureVersion:'0.6'}),(error:any)=>error.code==='room_full');
  for(const player of match.sessions)await match.send(player,{type:'ready',ready:true});
  snapshot=await match.send(b,{type:'team',teamId:'A'});assert.equal(snapshot.room.players.find(player=>player.id===b.playerId)!.ready,false);assert.ok(snapshot.room.players.filter(player=>player.id!==b.playerId).every(player=>player.ready));
  await match.send(b,{type:'ready',ready:true});await assert.rejects(()=>match.send(host,{type:'start'}),(error:any)=>error.code==='teams_unbalanced');
  await match.send(c,{type:'team',teamId:'B'});await match.send(c,{type:'ready',ready:true});snapshot=await match.send(host,{type:'start'});assert.equal(snapshot.room.status,'countdown');
  await assert.rejects(()=>match.send(d,{type:'team',teamId:'A'}),(error:any)=>error.code==='rules_locked');
});

test('team result sums actual net and forfeits the whole team without changing partner money or career',async()=>{
  const match=await fixture({mode:'team-net',count:4,simulation:clockSimulation()});await match.start();
  const values=[120,25,-10,40];for(const [index,player]of match.sessions.entries()){const raw=JSON.parse(match.authority.serializePlayerState(player.roomCode,player.playerId)!);match.authority.deserializePlayerState(player.roomCode,player.playerId,JSON.stringify({...raw,netIncome:values[index],grossIncome:values[index]+1000,operatingCost:500,completedTrips:index+1}));}
  let snapshot=await match.authority.readSnapshot(match.host.roomCode,match.host.resumeToken);assert.equal(snapshot.room.teamLeaderboard!.find(team=>team.teamId==='A')!.netIncome,110);assert.equal(snapshot.room.teamLeaderboard!.find(team=>team.teamId==='B')!.netIncome,65);
  snapshot=await match.send(match.sessions[2],{type:'leave'});const a=snapshot.room.teamLeaderboard!.find(team=>team.teamId==='A')!;assert.equal(a.forfeited,true);assert.equal(a.rank,null);assert.equal(a.netIncome,110);assert.equal(snapshot.room.players.find(player=>player.id===match.host.playerId)!.netIncome,120);assert.equal(snapshot.room.players.find(player=>player.id===match.host.playerId)!.forfeited,false);
  const saved=match.authority.serializeRoom(match.host.roomCode)!;const restore=new RoomAuthority({now:match.now,simulation:clockSimulation()});restore.deserializeRoom(saved);assert.deepEqual((await restore.readSnapshot(match.host.roomCode,match.host.resumeToken)).room.teamLeaderboard,snapshot.room.teamLeaderboard);
});

test('a completed teammate may leave the result screen without retroactively forfeiting a finished 0.6 team',async()=>{
  const match=await fixture({mode:'team-net',count:4,simulation:clockSimulation()});await match.start();match.add(360000);const finished=await match.authority.readSnapshot(match.host.roomCode,match.host.resumeToken);assert.equal(finished.room.status,'finished');const result=await match.send(match.host,{type:'leave'});assert.deepEqual(result.room.teamLeaderboard,finished.room.teamLeaderboard);assert.equal(result.room.players.find(player=>player.id===match.host.playerId)!.status,'finished');assert.equal(result.room.players.find(player=>player.id===match.host.playerId)!.forfeited,false);assert.deepEqual(result.review,finished.review);
});

test('common event windows survive restore and a bulk tick splits at every true start/end',async()=>{
  const calls:Array<{from:number;to:number;event?:string}>=[];const sim=clockSimulation(undefined,calls);const match=await fixture({simulation:sim});await match.start();const schedule=getWorldEventSchedule(match.host.snapshot.room.seed,360),first=schedule[0];
  match.add((first.endsAt+1)*1000);let snapshot=await match.authority.readSnapshot(match.host.roomCode,match.host.resumeToken);
  const activeCalls=calls.filter(call=>call.event===first.id);assert.ok(activeCalls.length>=2);assert.ok(activeCalls.every(call=>call.from>=first.startsAt&&call.to<=first.endsAt));assert.ok(Math.abs(activeCalls.reduce((sum,call)=>sum+call.to-call.from,0)-2*(first.endsAt-first.startsAt))<1e-7);
  const saved=match.authority.serializeRoom(match.host.roomCode)!;const restore=new RoomAuthority({now:match.now,simulation:sim});restore.deserializeRoom(saved);snapshot=await restore.readSnapshot(match.host.roomCode,match.host.resumeToken);const guest=await restore.readSnapshot(match.host.roomCode,match.sessions[1].resumeToken);assert.deepEqual(snapshot.room.worldEvents,guest.room.worldEvents);assert.deepEqual(snapshot.room.worldEvents,getWorldEventViews(snapshot.room.seed,snapshot.room.clockMinutes,360));
});

test('half shifts finish at six hours, while the authority overtime ceiling is two hours',async()=>{
  const match=await fixture({simulation:clockSimulation()});await match.start();match.add(360000);let snapshot=await match.authority.readSnapshot(match.host.roomCode,match.host.resumeToken);assert.equal(snapshot.room.status,'finished');assert.equal(snapshot.room.clockMinutes,360);assert.equal(snapshot.review!.shiftDurationMinutes,360);assert.equal(snapshot.ownState!.clockMinutes,360);
  const pending=await fixture({simulation:clockSimulation(9999)});await pending.start();pending.add(360000);snapshot=await pending.authority.readSnapshot(pending.host.roomCode,pending.host.resumeToken);assert.equal(snapshot.room.status,'running');pending.add(120001);snapshot=await pending.authority.readSnapshot(pending.host.roomCode,pending.host.resumeToken);assert.equal(snapshot.room.clockMinutes,480);assert.equal(snapshot.room.status,'finished');assert.ok(snapshot.room.players.every(player=>player.forfeited));
});

test('real engine server games retain selected duration and finish at their actual half/full/special deadline',async()=>{
  for(const selected of [360,720,1440]as const){
    const match=await fixture({duration:selected});await match.start();const saved=JSON.parse(match.authority.serializeRoom(match.host.roomCode)!);
    saved.metadata.room.clockMinutes=selected-.1;saved.metadata.lastTickAt=match.now();
    for(const entry of saved.states){const state=JSON.parse(entry.state);assert.equal(state.shiftDurationMinutes,selected);entry.state=JSON.stringify({...state,clockMinutes:selected-.1,phase:'cruising',currentOffer:null,activeTrip:null,queuedTrip:null,navigation:null,acceptingOrders:false,parking:{kind:'rest',startedAt:selected-1},energy:{...state.energy,remaining:state.energy.capacity}});}
    const restored=new RoomAuthority({now:match.now});restored.deserializeRoom(JSON.stringify(saved));match.add(200);const snapshot=await restored.readSnapshot(match.host.roomCode,match.host.resumeToken);
    assert.equal(snapshot.room.status,'finished');assert.equal(snapshot.room.clockMinutes,selected);assert.equal(snapshot.ownState!.clockMinutes,selected);assert.equal(snapshot.review!.shiftDurationMinutes,selected);assert.equal(snapshot.review!.players[0].netIncome,snapshot.ownState!.netIncome);
  }
});

test('special twenty-four-hour room caps overtime at four hours and keeps all route samples under 65',async()=>{
  const match=await fixture({duration:1440,simulation:clockSimulation(9999)});await match.start();match.add(1440000);let snapshot=await match.authority.readSnapshot(match.host.roomCode,match.host.resumeToken);assert.equal(snapshot.room.status,'running');match.add(240001);snapshot=await match.authority.readSnapshot(match.host.roomCode,match.host.resumeToken);
  assert.equal(snapshot.room.status,'finished');assert.equal(snapshot.room.clockMinutes,1680);assert.equal(snapshot.review!.shiftDurationMinutes,1440);const points=snapshot.review!.players[0].route;assert.equal(points.length,57);assert.equal(points[0].minute,0);assert.equal(points.at(-1)!.minute,1680);assert.ok(points.every((point,index)=>index===0||point.minute-points[index-1].minute===30));
});

test('finished review is bounded, private until finished, idempotent and durable across per-player restores',async()=>{
  const sim=clockSimulation(960);const match=await fixture({duration:720,simulation:sim});await match.start();let snapshot=await match.authority.readSnapshot(match.host.roomCode,match.host.resumeToken);assert.equal(snapshot.review,undefined);
  for(let i=0;i<110;i++){match.add(300);snapshot=await match.send(match.host,{type:i%2?'drive':'park'});}
  const seq=match.sequences.get(match.host.playerId)!;const before=JSON.parse(match.authority.serializeRoomMetadata(match.host.roomCode)!).players[0].review;
  await match.authority.handleCommand(match.host.roomCode,match.host.resumeToken,{seq,action:{type:'drive'}});assert.deepEqual(JSON.parse(match.authority.serializeRoomMetadata(match.host.roomCode)!).players[0].review,before);
  const restored=new RoomAuthority({now:match.now,simulation:sim});restored.deserializeRoom(match.authority.serializeRoom(match.host.roomCode)!);
  match.add(960000);restored.applyPresence(match.host.roomCode,match.sessions.map(player=>({playerId:player.playerId,lastSeen:match.now(),forfeitedAt:null})),match.now());snapshot=await restored.readSnapshot(match.host.roomCode,match.host.resumeToken);
  assert.equal(snapshot.room.status,'finished');const review=snapshot.review!;assert.equal(review.players[0].timeline.length,REVIEW_MAX_EVENTS);assert.equal(review.players[0].timelineTruncated,true);assert.equal(review.players[0].route.length,REVIEW_MAX_ROUTE_POINTS);assert.equal(review.players[0].route[0].minute,0);assert.equal(review.players[0].route.at(-1)!.minute,960);assert.equal(review.players[0].idleMinutes,960);assert.equal(review.players[0].netIncome,snapshot.ownState!.netIncome);assert.equal(review.players[0].rentalCost,snapshot.ownState!.rentalCostApplied);
  const text=JSON.stringify(review);assert.ok(Buffer.byteLength(text)<100_000);assert.ok(gzipSync(text).byteLength<20_000);assert.ok(!text.includes(match.host.resumeToken));assert.ok(!text.includes('landmarks'));assert.ok(!text.includes('observedOffers'));
  const again=new RoomAuthority({now:match.now,simulation:sim});again.deserializeRoom(restored.serializeRoom(match.host.roomCode)!);assert.deepEqual((await again.readSnapshot(match.host.roomCode,match.host.resumeToken)).review,review);
});

test('eight saturated reviews fit the existing D1 metadata row without full snapshots or a schema change',async(t)=>{
  const sim=clockSimulation(960),match=await fixture({count:8,duration:720,simulation:sim});await match.start();const saved=JSON.parse(match.authority.serializeRoom(match.host.roomCode)!);saved.metadata.room.status='finished';saved.metadata.room.clockMinutes=960;
  for(const [index,entry]of saved.states.entries()){
    const state=sim.restore(JSON.parse(entry.state));state.clockMinutes=960;state.phase='ended';const recorder=createReviewRecorder();
    for(let point=0;point<65;point++)sampleReviewRoute(recorder,{...state,clockMinutes:point*15},{lat:22.3+point*.0001,lon:114.1+index*.0001});
    for(let event=0;event<110;event++){const before={...state,logs:[],clockMinutes:event},after={...before,logs:[{id:`decision-${event}`,minute:event,kind:'route' as const,text:'真'.repeat(160)}]};recordReviewAction(recorder,before,after,{type:'route',policy:'fastest'});}
    saved.metadata.players[index].review=recorder;entry.state=JSON.stringify(state);
  }
  const restore=new RoomAuthority({now:match.now,simulation:sim});restore.deserializeRoom(JSON.stringify(saved));const published=restore.publishedSnapshot(match.host.roomCode);assert.equal(published.review!.players.length,8);assert.ok(published.review!.players.every(player=>player.route.length===65&&player.timeline.length===96));
  const row=JSON.stringify({schema:2,authority:restore.serializeRoomMetadata(match.host.roomCode),gamePlayerIds:restore.getPlayerIds(match.host.roomCode),publishedAt:match.now(),publicSnapshot:published});const publicBytes=Buffer.byteLength(JSON.stringify(published.review)),rowBytes=Buffer.byteLength(row);
  assert.ok(rowBytes<1_000_000,`${rowBytes} bytes must leave headroom below the existing 1.8MB guard`);assert.ok(!row.includes(match.host.resumeToken));t.diagnostic(`8-player saturated review: ${publicBytes} public bytes; ${rowBytes} complete D1 metadata bytes (limit 1,800,000).`);
});

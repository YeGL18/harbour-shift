// Unit test of the actual provider hook with mocked native/storage/HTTP I/O.
// This does not connect to a real backend or verify a native app.
// Run from the project: node --import tsx scripts/test-multiplayer-provider.cjs
const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),path=require('path');
const project=path.resolve(__dirname,'..');
const ts=require('typescript');
const protocol=require(path.join(project,'shared/protocol.ts'));
const {MultiplayerError,isAuthorityResponseError,isTerminalMultiplayerError}=require(path.join(project,'src/multiplayer/transport.ts'));
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject};}
const snapshot=(code='AAAAAA',id='a',seq=0)=>({protocolVersion:protocol.PROTOCOL_VERSION,revision:seq+1,serverTime:1000,room:{code,status:'lobby',players:[]},you:{playerId:id,lastInputSeq:seq},ownState:null,leaderboard:[]});
async function harness(initialHandler,initialPro){
  let cells=[],cursor=0,effects=[],scheduled=false,current;const timers=[],requests=[],writes=[];
  let writeGate=null,requestHandler=initialHandler??(async(_base,url)=>url.includes('/actions')?snapshot():snapshot());
  const driver={driverId:'driver-test',driverToken:'a'.repeat(64),stats:{offered:3,accepted:2,cancelled:0,completedTrips:2,acceptanceRate:2/3,cancellationRate:0,updatedAt:1}};
  const credential={roomCode:'AAAAAA',playerId:'a',resumeToken:'test-token-a',lastAllocatedSeq:0};
  const storage={multiGet:async()=>[['nickname','Driver'],['session',JSON.stringify(credential)],['driver',JSON.stringify(driver)],['solo',null],['pro',initialPro?JSON.stringify(initialPro):null]],setItem:async(key,value)=>{writes.push({key,value});if(writeGate)await writeGate.promise;},removeItem:async key=>writes.push({key,removed:true})};
  const depsSame=(a,b)=>!!a&&!!b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
  const schedule=()=>{if(!scheduled){scheduled=true;queueMicrotask(()=>{scheduled=false;render();});}};
  const react={createContext:()=>({}),useContext:()=>{},useRef(value){const i=cursor++;return cells[i]??(cells[i]={current:value});},useState(initial){const i=cursor++;if(!(i in cells))cells[i]=typeof initial==='function'?initial():initial;return[cells[i],value=>{cells[i]=typeof value==='function'?value(cells[i]):value;schedule();}];},useCallback(fn,deps){const i=cursor++;if(!cells[i]||!depsSame(cells[i].deps,deps))cells[i]={value:fn,deps};return cells[i].value;},useEffect(fn,deps){const i=cursor++;if(!cells[i]||!depsSame(cells[i].deps,deps)){const previous=cells[i];cells[i]={deps,cleanup:previous?.cleanup};effects.push(()=>{previous?.cleanup?.();cells[i].cleanup=fn();});}}};
  const request=async(...args)=>{requests.push(args);return requestHandler(...args);};
  const mockRequire=name=>name==='react'?react:name==='react/jsx-runtime'?{jsx:()=>null}:name==='react-native'?{AppState:{currentState:'active',addEventListener:()=>({remove(){}})}}:name==='@react-native-async-storage/async-storage'?storage:name==='../shared/protocol'?protocol:name==='./profile/proLedger'?require(path.join(project,'src/profile/proLedger.ts')):name==='./profile/ledger'?require(path.join(project,'src/profile/ledger.ts')):name==='./game/vehicleCapabilities'?require(path.join(project,'src/game/vehicleCapabilities.ts')):name==='./multiplayer/config'?{MULTIPLAYER_BASE_URL:'https://unit.test'}:name==='./multiplayer/transport'?{MultiplayerError,isAuthorityResponseError,isTerminalMultiplayerError,request}:require(name);
  const input=fs.readFileSync(path.join(project,'src/MultiplayerProvider.tsx'),'utf8');
  const code=ts.transpileModule(input+'\nexport const __controller=useMultiplayerController;',{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText;
  const module={exports:{}};vm.runInNewContext(code,{module,exports:module.exports,require:mockRequire,queueMicrotask,setTimeout,clearTimeout,setInterval:fn=>{timers.push(fn);return timers.length-1;},clearInterval:id=>{timers[id]=null;},console},{filename:'MultiplayerProvider.actual-hook.cjs'});
  function render(){cursor=0;current=module.exports.__controller();const pending=effects;effects=[];for(const effect of pending)effect();}
  const flush=async()=>{for(let i=0;i<35;i++)await Promise.resolve();};render();await flush();
  return{get value(){return current;},requests,writes,flush,setHandler:fn=>requestHandler=fn,setWriteGate:value=>writeGate=value,poll:async()=>{for(const fn of [...timers])if(fn)fn();await flush();}};
}
let passed=0;
const pass=label=>{passed++;console.log(label);};
const watchdog=setTimeout(()=>{console.error('FAIL provider harness timed out');process.exit(1);},10000);
(async()=>{
  {
    const h=await harness();
    assert.equal(h.value.driverStats.offered,3);
    h.value.recordSolo('fixture',{offered:4,accepted:3,cancelled:1,completedTrips:2});await h.flush();
    h.value.recordSolo('fixture',{offered:4,accepted:3,cancelled:1,completedTrips:2});await h.flush();
    assert.equal(h.value.driverStats.offered,7);assert.equal(h.value.driverStats.accepted,5);
    assert.equal(h.writes.filter(x=>x.key==='harbour-shift.solo-history.v1').length,1);
    assert.equal(h.requests.some(x=>x[1].startsWith('/v1/drivers')),false);
    pass('PASS solo history persists once and is never sent as multiplayer reputation');
  }
  {
    const h=await harness(),{RESET_COURSE_VERSION,RESET_QUESTIONS}=require(path.join(project,'shared/trainingCourse.ts'));
    const submission={assessmentId:'solo:unit-reset',courseVersion:RESET_COURSE_VERSION,answers:RESET_QUESTIONS.map(question=>question.correct)};
    await assert.rejects(h.value.resetSoloReview(submission));
    await h.value.leaveRoom();await h.flush();
    h.value.recordSolo('training-fixture',{offered:20,accepted:8,cancelled:2,completedTrips:6});
    const period=await h.value.resetSoloReview(submission);await h.flush();
    assert.equal(period.activePeriod.counts.offered,0);assert.equal(period.activePeriod.acceptanceRate,null);
    assert.equal(h.value.soloStats.offered,20);assert.equal(h.value.driverAccount.stats.offered,3);
    h.value.recordSolo('next-shift',{offered:2,accepted:1,cancelled:0,completedTrips:1});await h.flush();
    const retry=await h.value.resetSoloReview(submission);assert.equal(retry.activePeriod.counts.offered,2);
    assert.equal(h.requests.some(args=>args[1].includes('/training')),false);
    pass('PASS offline learning queues behind pending solo receipts, preserves verified history and retries one baseline exactly once');
  }
  {
    const h=await harness(),{RESET_COURSE_VERSION,RESET_QUESTIONS}=require(path.join(project,'shared/trainingCourse.ts'));
    await h.value.leaveRoom();await h.flush();
    const gate=deferred();h.setWriteGate(gate);
    const operation=h.value.resetSoloReview({assessmentId:'solo:failed-write',courseVersion:RESET_COURSE_VERSION,answers:RESET_QUESTIONS.map(question=>question.correct)});await h.flush();
    assert.equal(h.value.soloReview.activePeriod.periodId,'lifetime');
    gate.reject(new Error('disk write failed'));await assert.rejects(operation);assert.equal(h.value.soloReview.activePeriod.periodId,'lifetime');
    h.setWriteGate(null);await h.value.resetSoloReview({assessmentId:'solo:failed-write',courseVersion:RESET_COURSE_VERSION,answers:RESET_QUESTIONS.map(question=>question.correct)});await h.flush();
    assert.equal(h.value.soloReview.activePeriod.periodId,'solo:failed-write');
    pass('PASS a failed durable training write never reports reset success and the same assessment can safely retry');
  }
  {
    const h=await harness(),gate=deferred();h.setWriteGate(gate);h.setHandler(async()=>snapshot('AAAAAA','a',1));
    const promise=h.value.dispatch({type:'drive'});await h.flush();assert.equal(h.requests.filter(x=>x[2]).length,0);assert.equal(JSON.parse(h.writes.at(-1).value).lastAllocatedSeq,1);
    gate.resolve();await promise;assert.equal(h.requests.filter(x=>x[2]).length,1);pass('PASS persist sequence before first transmission');
  }
  {
    const h=await harness(),gate=deferred();h.setWriteGate(gate);const promise=h.value.dispatch({type:'drive'});await h.flush();gate.reject(new Error('disk write failed'));await assert.rejects(promise);assert.equal(h.requests.filter(x=>x[2]).length,0);pass('PASS a rejected durable write prevents every HTTP action send');
  }
  {
    const h=await harness();let count=0;h.setHandler(async(_base,url,body)=>{if(!body)return snapshot();count++;if(count===1)throw new MultiplayerError('unavailable',503);return snapshot('AAAAAA','a',body.seq);});
    await assert.rejects(h.value.dispatch({type:'drive'}));await h.value.dispatch({type:'park'});const sent=h.requests.filter(x=>x[2]).map(x=>x[2]);assert.deepEqual(sent.map(x=>x.seq),[1,1,2]);assert.deepEqual(sent[0],sent[1]);pass('PASS 503 retains and retries the identical unresolved envelope');
  }
  {
    const h=await harness();let count=0;h.setHandler(async(_base,url,body)=>{if(!body)return snapshot();count++;if(count===1)throw new MultiplayerError('unavailable',503);if(count===2)throw new MultiplayerError('expired',409);return snapshot('AAAAAA','a',body.seq);});
    await assert.rejects(h.value.dispatch({type:'drive'}));await h.value.dispatch({type:'park'});assert.deepEqual(h.requests.filter(x=>x[2]).map(x=>x[2].seq),[1,1,2]);pass('PASS terminal previous 409 does not permanently block a fresh action');
  }
  for(const lateKind of ['success','4xx']){
    const h=await harness(),old=deferred(),fresh=deferred();let freshCount=0;
    h.setHandler(async(_base,url,body,token)=>{if(url==='/v1/rooms')return{roomCode:'BBBBBB',playerId:'b',resumeToken:'test-token-b',snapshot:snapshot('BBBBBB','b',0)};if(!body){if(token==='test-token-a')throw new MultiplayerError('offline');return snapshot('BBBBBB','b',0);}if(token==='test-token-a')return old.promise;freshCount++;if(freshCount===1)return fresh.promise;return snapshot('BBBBBB','b',body.seq);});
    const first=h.value.dispatch({type:'drive'});const queued=h.value.dispatch({type:'park'}).catch(e=>e);await h.flush();await h.poll();assert.equal(h.value.connection,'reconnecting');await h.value.leaveRoom();await h.flush();assert.equal(h.value.snapshot,null);
    await h.value.createRoom({mode:'highest-net',shift:'day',speed:30,density:'normal'},undefined);await h.flush();const newAction=h.value.dispatch({type:'drive'});await h.flush();if(lateKind==='success')old.resolve(snapshot('AAAAAA','a',1));else old.reject(new MultiplayerError('expired',409));await first.catch(error=>error);await queued;await h.flush();fresh.reject(new MultiplayerError('unavailable',503));await assert.rejects(newAction);await h.value.dispatch({type:'rest'});
    const b=h.requests.filter(x=>x[3]==='test-token-b'&&x[2]).map(x=>x[2]);assert.deepEqual(b.map(x=>x.seq),[1,1,2]);assert.equal(b.some(x=>x.action.type==='park'),false);pass('PASS offline leave/new room fences old queued input and late A '+lateKind+'; B retry is preserved');
  }
  {
    const h=await harness(),setupResponse=deferred();
    h.setHandler(async(_base,url,body,token)=>{if(url==='/v1/rooms')return{roomCode:'BBBBBB',playerId:'b',resumeToken:'test-token-b',snapshot:snapshot('BBBBBB','b',0)};if(!body){if(token==='test-token-a')throw new MultiplayerError('offline');return snapshot('BBBBBB','b',0);}if(token==='test-token-a')return setupResponse.promise;return snapshot('BBBBBB','b',body.seq);});
    const ready=h.value.setReady(true,{vehicleId:'private',startPlaceId:'harbour-city'}).catch(error=>error);await h.flush();await h.poll();await h.value.leaveRoom();await h.flush();await h.value.createRoom({mode:'highest-net',shift:'day',speed:30,density:'normal'});await h.flush();
    setupResponse.resolve(snapshot('AAAAAA','a',1));const result=await ready;await h.flush();assert.equal(result.code,'ROOM_CHANGED');assert.equal(h.requests.some(x=>x[3]==='test-token-b'&&x[2]?.action.type==='ready'),false);assert.equal(h.value.snapshot.room.code,'BBBBBB');pass('PASS setup→ready cannot cross an offline leave and new room join');
  }
  {
    const h=await harness(),oldLeaveResponse=deferred();
    h.setHandler(async(_base,url,body,token)=>{if(url==='/v1/rooms')return{roomCode:'BBBBBB',playerId:'b',resumeToken:'test-token-b',snapshot:snapshot('BBBBBB','b',0)};if(!body){if(token==='test-token-a')throw new MultiplayerError('offline');return snapshot('BBBBBB','b',0);}if(token==='test-token-a')return oldLeaveResponse.promise;return snapshot('BBBBBB','b',body.seq);});
    const oldLeave=h.value.leaveRoom();await h.flush();await h.poll();assert.equal(h.value.connection,'reconnecting');await h.value.leaveRoom();await h.flush();await h.value.createRoom({mode:'highest-net',shift:'day',speed:30,density:'normal'});await h.flush();
    oldLeaveResponse.resolve(snapshot('AAAAAA','a',1));await oldLeave;await h.flush();assert.equal(h.value.snapshot.room.code,'BBBBBB');await h.value.dispatch({type:'drive'});assert.equal(h.value.snapshot.room.code,'BBBBBB');pass('PASS a late old leave completion cannot clear the new room');
  }
  {
    const read=deferred(),h=await harness(()=>read.promise);assert.equal(h.value.hasSession,true);assert.equal(h.value.snapshot,null);assert.equal(h.value.connection,'connecting');
    await h.value.leaveRoom();await h.flush();assert.equal(h.value.hasSession,false);assert.equal(h.value.connection,'offline');read.resolve(snapshot());await h.flush();assert.equal(h.value.snapshot,null);assert.equal(h.requests.some(x=>x[2]),false);pass('PASS cold restore can leave locally before any snapshot; late read does not resurrect the room');
  }
  {
    const edge=new MultiplayerError('edge denied',401,'EDGE_BLOCKED',{kind:'edge-blocked',origin:'https://unit.test'});
    const h=await harness(async()=>{throw edge;});
    assert.equal(h.value.hasSession,true);assert.equal(h.value.connection,'reconnecting');
    await assert.rejects(h.value.dispatch({type:'drive'}));
    h.setHandler(async(_base,_url,body)=>snapshot('AAAAAA','a',body?.seq??0));
    await h.value.dispatch({type:'park'});
    assert.deepEqual(h.requests.filter(x=>x[2]).map(x=>x[2].seq),[1,1,2]);
    assert.equal(h.value.hasSession,true);pass('PASS edge HTML 401 preserves the room credential and unresolved exact sequence');
  }
  {
    const h=await harness();h.setHandler(async(_base,_url,body)=>snapshot('AAAAAA','a',body.seq));
    await h.value.updateSetup({vehicleId:'private',rentalOverride:0,energyUnitPriceOverride:4.57,autoAcceptOrders:true});
    const sent=h.requests.filter(x=>x[2]);assert.equal(sent.length,1);assert.deepEqual(JSON.parse(JSON.stringify(sent[0][2].action)),{type:'setup',setup:{vehicleId:'private',rentalOverride:0,energyUnitPriceOverride:4.57,autoAcceptOrders:true}});
    pass('PASS room setup saves zero costs and auto preference through one ordered authoritative action');
  }
  {
    const h=await harness();let attempts=0;h.setHandler(async(_base,_url,body)=>{if(!body)return snapshot();if(++attempts===1)throw new MultiplayerError('unavailable',503);return snapshot('AAAAAA','a',body.seq);});
    await assert.rejects(h.value.setTeam('B'));await h.value.setReady(true);
    const sent=h.requests.filter(x=>x[2]).map(x=>x[2]);assert.deepEqual(sent.map(x=>x.seq),[1,1,2]);assert.deepEqual(JSON.parse(JSON.stringify(sent[1].action)),{type:'team',teamId:'B'});
    assert.equal(h.value.hasSession,true);pass('PASS uncertain team change replays the same durable sequence before ready');
  }
  {
    const h=await harness();let attempts=0;h.setHandler(async(_base,_url,body)=>{if(!body)return snapshot();if(++attempts===1)throw new MultiplayerError('unavailable',503);return snapshot('AAAAAA','a',body.seq);});
    await assert.rejects(h.value.setMapReady('round-map-epoch',true));await h.value.setMapReady('round-map-epoch',false);
    const sent=h.requests.filter(x=>x[2]).map(x=>x[2]);assert.deepEqual(sent.map(x=>x.seq),[1,1,2]);
    assert.deepEqual(JSON.parse(JSON.stringify(sent[0].action)),{type:'map-ready',epoch:'round-map-epoch',ready:true});
    assert.deepEqual(JSON.parse(JSON.stringify(sent[2].action)),{type:'map-ready',epoch:'round-map-epoch',ready:false});
    pass('PASS map readiness retries the exact epoch and sequence before an ordered foreground revocation');
  }
  {
    const running=(seq=0)=>({...snapshot('AAAAAA','a',seq),room:{...snapshot().room,status:'running'},ownState:{currentOffer:seq?null:{id:'offer-1'}}}),horn=deferred();
    const h=await harness(async(_base,url,body)=>url.endsWith('/horn')?horn.promise:running(body?.seq??0));
    h.value.sendHorn({pressId:'qa-horn',pressed:true});await h.flush();
    assert.equal(h.requests.filter(x=>x[1].endsWith('/horn')).length,1);assert.equal(h.writes.length,0);
    await h.value.dispatch({type:'accept',offerId:'offer-1'});assert.equal(h.value.snapshot.you.lastInputSeq,1);
    const input=h.requests.find(x=>x[1].endsWith('/actions'))[2];assert.equal(input.seq,1);assert.equal(input.action.type,'accept');
    horn.resolve(running(0));await h.flush();assert.equal(h.value.snapshot.you.lastInputSeq,1);
    assert.equal(h.requests.find(x=>x[1].endsWith('/horn'))[2].seq,undefined);
    pass('PASS horn HTTP is independent of durable accept sequences and a late horn snapshot cannot roll back acceptance');
  }
  {
    const running=(seq=0)=>({...snapshot('AAAAAA','a',seq),room:{...snapshot().room,status:'running'},ownState:{currentOffer:null}});
    const h=await harness(async(_base,url,body)=>{if(url.endsWith('/horn'))throw new MultiplayerError('busy',503);return running(body?.seq??0);});
    h.value.sendHorn({pressId:'qa-drop',pressed:true});await h.flush();assert.equal(h.value.connection,'connected');assert.equal(h.value.error,null);
    await h.value.dispatch({type:'drive'});assert.deepEqual(h.requests.filter(x=>x[1].endsWith('/actions')).map(x=>x[2].seq),[1]);
    pass('PASS failed ephemeral horn does not poison reconnect state or reserve/retry a game sequence');
  }
  {
    const h=await harness(async()=>{throw new MultiplayerError('offline');});await h.value.leaveRoom();await h.flush();let creates=0;
    h.setHandler(async(_base,url,body)=>{if(url==='/v1/rooms'){creates++;if(creates<5)throw new MultiplayerError('unknown capability',400,'unexpected_field');return{roomCode:'BBBBBB',playerId:'b',resumeToken:'test-token-b',snapshot:snapshot('BBBBBB','b')};}return snapshot('BBBBBB','b');});
    await h.value.createRoom({mode:'highest-net',shift:'day',speed:60,density:'normal'});const sent=h.requests.filter(x=>x[1]==='/v1/rooms');assert.equal(sent.length,5);assert.equal(sent[0][2].orderPolicyVersion,1);assert.equal(sent[0][2].advancedRulesVersion,1);assert.equal(sent[0][2].vehicleCatalogVersion,1);assert.equal(sent[0][2].blindOrdersVersion,1);assert.equal(sent[1][2].orderPolicyVersion,undefined);assert.equal(sent[1][2].advancedRulesVersion,1);assert.equal('advancedRulesVersion'in sent[2][2],false);assert.equal(sent[2][2].vehicleCatalogVersion,1);assert.equal('vehicleCatalogVersion'in sent[3][2],false);assert.equal(sent[3][2].blindOrdersVersion,1);assert.equal('blindOrdersVersion'in sent[4][2],false);assert.deepEqual(sent[0][2].driverCredential,sent[4][2].driverCredential);assert.equal(h.value.snapshot.room.code,'BBBBBB');
    pass('PASS exact validation rejections negotiate advanced, vehicle, blind and legacy schemas without mutating credentials');
  }
  {
    for(const error of [new MultiplayerError('timeout',0,'TIMEOUT'),new MultiplayerError('uncertain',503),new MultiplayerError('other validation',400,'invalid_setup'),new MultiplayerError('untrusted response',400,'unexpected_field',{kind:'invalid-response'})]){
      const h=await harness(async()=>{throw new MultiplayerError('offline');});await h.value.leaveRoom();await h.flush();h.setHandler(async()=>{throw error;});
      await assert.rejects(h.value.createRoom({mode:'highest-net',shift:'day',speed:60,density:'normal'}));assert.equal(h.requests.filter(x=>x[1]==='/v1/rooms').length,1);
    }
    pass('PASS create capability fallback never retries timeouts,5xx or unrelated400 failures');
  }
  {
    const h=await harness(async()=>{throw new MultiplayerError('offline');});await h.value.leaveRoom();await h.flush();
    h.setHandler(async()=>{throw new MultiplayerError('unknown capability',400,'unexpected_field');});
    await assert.rejects(h.value.createRoom({mode:'highest-net',shift:'day',speed:60,density:'normal'},{vehicleId:'tesla-model-3'}), {code:'room_version'});
    assert.equal(h.requests.filter(x=>x[1]==='/v1/rooms').length,3);
    pass('PASS an older authority never silently substitutes a selected new vehicle');
  }
  {
    const h=await harness(async()=>{throw new MultiplayerError('offline');});await h.value.leaveRoom();await h.flush();let attempts=0;
    h.setHandler(async(_base,url,body)=>{if(url==='/v1/rooms/BBBBBB/join'){attempts++;if(attempts<=3)throw new MultiplayerError('unknown vehicle capability',400,'unexpected_field');return{roomCode:'BBBBBB',playerId:'b',resumeToken:'test-token-b',snapshot:snapshot('BBBBBB','b')};}return snapshot('BBBBBB','b');});
    await h.value.joinRoom('bbbbbb',{vehicleId:'private'});const joins=h.requests.filter(x=>x[1]==='/v1/rooms/BBBBBB/join');assert.equal(joins.length,4);assert.equal(joins[0][2].orderPolicyVersion,1);assert.equal(joins[1][2].orderPolicyVersion,undefined);assert.equal(joins[1][2].advancedRulesVersion,1);assert.equal(joins[2][2].advancedRulesVersion,undefined);assert.equal(joins[2][2].vehicleCatalogVersion,1);assert.equal('vehicleCatalogVersion'in joins[3][2],false);assert.equal(joins[3][2].blindOrdersVersion,1);assert.equal(joins[3][2].setup.vehicleId,'private');assert.deepEqual(joins[0][2].driverCredential,joins[3][2].driverCredential);assert.equal(h.value.snapshot.room.code,'BBBBBB');
    pass('PASS joining a blind-capable older authority drops only the unsupported vehicle declaration and preserves the selected legacy car');
  }
  {
    const h=await harness(async()=>{throw new MultiplayerError('offline');});await h.value.leaveRoom();await h.flush();
    h.setHandler(async()=>{throw new MultiplayerError('unknown capability',400,'unexpected_field');});
    await assert.rejects(h.value.joinRoom('BBBBBB',{vehicleId:'alphard-hybrid'}),{code:'room_version'});const joins=h.requests.filter(x=>x[1]==='/v1/rooms/BBBBBB/join');assert.equal(joins.length,3);assert.ok(joins.every(entry=>entry[2].setup.vehicleId==='alphard-hybrid'));assert.equal(h.value.hasSession,false);
    pass('PASS joining an older authority never replays or silently downgrades an extended selected vehicle');
  }
  {
    const h=await harness(async()=>{throw new MultiplayerError('offline');});await h.value.leaveRoom();await h.flush();let calls=0;
    h.setHandler(async(_base,url,body)=>{if(url==='/v1/rooms'){calls++;if(calls<=2)throw new MultiplayerError('advanced not supported',400,'unexpected_field');assert.equal(body.vehicleCatalogVersion,1);assert.equal(body.advancedRulesVersion,undefined);return{roomCode:'BBBBBB',playerId:'b',resumeToken:'test-token-b',snapshot:snapshot('BBBBBB','b')};}return snapshot('BBBBBB','b');});
    await h.value.createRoom({mode:'highest-net',shift:'day',speed:60,density:'busy'},{vehicleId:'alphard-hybrid'});assert.equal(calls,3);assert.ok(h.requests.filter(x=>x[1]==='/v1/rooms').every(x=>x[2].setup.vehicleId==='alphard-hybrid'));
    pass('PASS catalog-capable authorities retain selected new vehicles after an advanced-only rejection');
  }
  {
    const h=await harness(async()=>{throw new MultiplayerError('offline');});await h.value.leaveRoom();await h.flush();h.setHandler(async()=>{throw new MultiplayerError('advanced unsupported',400,'unexpected_field');});
    await assert.rejects(h.value.createRoom({mode:'highest-net',shift:'day',speed:60,density:'normal'},{vehicleId:'kam-fung',proPass:{packId:'owned-pack',tier:'gold'}}),{code:'room_version'});assert.equal(h.requests.filter(x=>x[1]==='/v1/rooms').length,2);
    pass('PASS an explicit Pro pass cannot silently downgrade to ordinary room rules');
  }
  {
    const h=await harness(async()=>{throw new MultiplayerError('offline');});await h.value.leaveRoom();await h.flush();let calls=0;h.setHandler(async()=>{calls++;throw calls===1?new MultiplayerError('advanced unsupported',400,'unexpected_field'):new MultiplayerError('uncertain mutation',503,'server_error');});
    await assert.rejects(h.value.joinRoom('BBBBBB',{vehicleId:'private'}),{status:503});assert.equal(calls,2);assert.equal(h.value.hasSession,false);
    pass('PASS a later fallback stage never retries an ambiguous server error');
  }
  {
    const h=await harness();await h.value.activateSoloPro('diamond');await h.flush();assert.equal(h.value.soloPro.packs.length,1);assert.equal(h.value.soloPro.packs[0].remaining,7);
    const passValue={packId:h.value.soloPro.packs[0].id,tier:'diamond'};await assert.rejects(h.value.activateSoloPro('diamond'),/不能疊加/);assert.equal(h.value.soloPro.packs.length,1);
    await h.value.completeSoloPro('solo:forfeit',passValue,'forfeit');assert.equal(h.value.soloPro.packs[0].remaining,7);
    for(let index=0;index<7;index++){assert.equal(h.value.soloPro.packs[0].remaining,7-index);await h.value.completeSoloPro('solo:finished-'+index,passValue,'handover');await h.flush();await h.value.completeSoloPro('solo:finished-'+index,passValue,'handover');}
    assert.equal(h.value.soloPro.packs[0].remaining,0);assert.equal(h.value.soloProPending,false);assert.equal(h.requests.some(args=>args[1].includes('/pro')),false);
    pass('PASS local practice packs preserve all seven completed shifts and duplicate summaries never consume twice or reach the online ledger');
  }
  {
    const h=await harness(),gate=deferred();h.setWriteGate(gate);const activating=h.value.activateSoloPro('gold');await h.flush();assert.equal(h.value.soloProPending,true);assert.equal(h.value.soloPro.packs.length,0);
    gate.reject(new Error('disk write failed'));await assert.rejects(activating);await h.flush();assert.equal(h.value.soloPro.packs.length,0);assert.equal(h.value.soloProPending,false);h.setWriteGate(null);await h.value.activateSoloPro('gold');await h.flush();assert.equal(h.value.soloPro.packs[0].remaining,7);
    pass('PASS a rejected durable Pro write cannot grant a phantom local pass and a safe retry can recover');
  }
  {
    const h=await harness();await h.value.activateSoloPro('gold');const frozen={packId:h.value.soloPro.packs[0].id,tier:'gold'};
    await h.value.activateSoloPro('diamond');assert.equal(h.value.soloPro.packs.length,1);assert.equal(h.value.soloPro.packs[0].tier,'diamond');
    await h.value.completeSoloPro('solo:pre-upgrade',frozen,'handover');await h.flush();assert.equal(h.value.soloPro.packs[0].remaining,7);assert.equal(h.value.soloPro.completedShifts['solo:pre-upgrade'],true);
    await assert.rejects(h.value.activateSoloPro('gold'),/不能降級/);assert.equal(h.value.soloPro.packs[0].remaining,7);
    pass('PASS upgraded local packs replace old credits while a frozen old shift settles without debiting its replacement');
  }
  {
    const h=await harness(undefined,{version:1,packs:[{id:'gold',tier:'gold',remaining:7,createdAt:50,source:'practice'},{id:'diamond',tier:'diamond',remaining:2,createdAt:100,source:'practice'}],completedShifts:{'solo:historic':true}});await h.flush();
    assert.equal(h.value.soloPro.packs.length,1);assert.equal(h.value.soloPro.packs[0].id,'diamond');assert.equal(h.value.soloPro.completedShifts['solo:historic'],true);
    const saved=h.writes.find(row=>row.key==='harbour-shift.solo-pro.v1');assert.ok(saved);assert.equal(JSON.parse(saved.value).packs.length,1);
    pass('PASS legacy multiple local packs are normalized and persisted without erasing completed shift receipts');
  }
  {
    const h=await harness(),{ELITE_COURSE_VERSION,ELITE_QUESTIONS}=require(path.join(project,'shared/eliteCourse.ts'));
    await h.value.certifySoloElite({assessmentId:'solo:elite-unit',courseVersion:ELITE_COURSE_VERSION,answers:ELITE_QUESTIONS.map(item=>item.correct)});await h.flush();
    assert.equal(h.value.soloEliteCertification.assessmentId,'solo:elite-unit');assert.equal(h.value.driverAccount.stats.offered,3);assert.equal(h.requests.some(args=>args[1].includes('/elite')),false);
    pass('PASS original local Elite qualification persists independently and never forges a verified online certificate');
  }
  {
    const h=await harness(async()=>{throw new MultiplayerError('offline');});await h.value.leaveRoom();await h.flush();h.setHandler(async()=>{throw new MultiplayerError('unsupported policy',400,'unexpected_field');});
    await assert.rejects(h.value.createRoom({mode:'highest-net',shift:'day',speed:60,density:'busy',blindOrders:false},{vehicleId:'private'}),{code:'room_version'});assert.equal(h.requests.filter(x=>x[1]==='/v1/rooms').length,1);assert.equal(h.value.hasSession,false);
    pass('PASS an explicit blind choice never silently falls back to an older operator policy');
  }
  {
    const h=await harness(async()=>{throw new MultiplayerError('offline');});await h.value.leaveRoom();await h.flush();h.setHandler(async()=>{throw new MultiplayerError('unsupported policy',400,'unexpected_field');});
    await assert.rejects(h.value.joinRoom('BBBBBB',{vehicleId:'alphard-hybrid',orderPreferences:{enabledPricingTypes:['private-xl']}}),{code:'room_version'});const joins=h.requests.filter(x=>x[1].endsWith('/join'));assert.equal(joins.length,1);assert.deepEqual(joins[0][2].setup.orderPreferences.enabledPricingTypes,['private-xl']);
    pass('PASS explicit order preferences cannot downgrade into unrestricted old dispatch');
  }
  {
    const h=await harness(async()=>{throw new MultiplayerError('offline');});await h.value.leaveRoom();await h.flush();h.setHandler(async(_base,url,body)=>{if(url==='/v1/rooms'){assert.equal(body.orderPolicyVersion,1);assert.equal(body.rules.blindOrders,true);assert.deepEqual(body.setup.orderPreferences.enabledPricingTypes,['private-upfront']);return{roomCode:'BBBBBB',playerId:'b',resumeToken:'test-token-b',snapshot:snapshot('BBBBBB','b')};}return snapshot('BBBBBB','b');});
    await h.value.createRoom({mode:'highest-net',shift:'day',speed:60,density:'busy',blindOrders:true},{vehicleId:'alphard-hybrid',orderPreferences:{enabledPricingTypes:['private-upfront']}});assert.equal(h.value.hasSession,true);
    pass('PASS supported policy creation preserves the exact chosen blind mode and eligible price set');
  }
  assert.equal(passed,34);console.log('Provider unit harness: 34/34 passed (mock I/O, not native).');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>clearTimeout(watchdog));

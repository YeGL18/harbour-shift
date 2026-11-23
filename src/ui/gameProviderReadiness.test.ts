import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import ts from 'typescript';

const require=createRequire(import.meta.url),project=path.resolve(import.meta.dirname,'../..');
/** Execute the real hook; native I/O and the engine are controlled boundaries. */
async function harness(saved?:object,benefits?:{packs?:any[];certificate?:any;failProCompletion?:boolean}){
  let now=1000,cursor=0,cells:any[]=[],effects:Array<()=>void>=[],scheduled=false,current:any;
  const timers=new Map<number,()=>void>(),listeners:Array<(state:string)=>void>=[],writes:string[]=[],writeKeys:string[]=[],audio:string[]=[],advances:number[]=[];
  let timerId=0;
  const place={id:'harbour-city',name:'海港城',lat:22.3,lon:114.1,nodeId:'a'};
  const initial=()=>({version:3,seed:2,driverSessionId:'solo:fixture',landmarks:[place],vehicleId:'kam-fung',phase:'cruising',clockMinutes:0,shiftDurationMinutes:360,startTimeMinutes:300,acceptedOffers:0,declinedOffers:0,cancelledTrips:0,completedTrips:0,presentedOffers:0,platform:{offered:0},logs:[],ghostOffers:[],observedOffers:[],movement:{edgeId:'edge',distanceOnEdgeM:0,nextEdgeIds:[]},currentOffer:null,dispatchManaged:true});
  const engine={setAutoAcceptOrders:(state:any,value:boolean)=>({...state,autoAcceptOrders:value,...(value&&state.currentOffer?{currentOffer:null,acceptedOffers:state.acceptedOffers+1}:{})}),createInitialState:(options:object)=>({...initial(),...options}),normalizeGameState:(value:object)=>value,advanceGameWithWorldEvents:(state:any,delta:number)=>{advances.push(delta);return{...state,clockMinutes:state.clockMinutes+delta,...(!state.currentOffer&&!state.declinedOffers?{currentOffer:{id:'offer-1',createdAt:state.clockMinutes,expiresAt:state.clockMinutes+4},presentedOffers:1,platform:{offered:1}}:{})};},declineOffer:(state:any)=>({...state,currentOffer:null,declinedOffers:state.declinedOffers+1}),acceptOffer:(state:any)=>({...state,currentOffer:null,acceptedOffers:state.acceptedOffers+1})};
  const storage={multiGet:async()=>[['v2',saved?JSON.stringify(saved):null],['v1',null]],setItem:async(key:string,value:string)=>{writeKeys.push(key);writes.push(value);}};
  const proUses:string[]=[],proLedger=require('../profile/proLedger.ts');
  const mp:any={hydrated:true,snapshot:null,driverStats:{},recordSolo:()=>{},soloPro:{version:1,packs:benefits?.packs||[],completedShifts:{}},soloProPending:false,soloEliteCertification:benefits?.certificate,
    completeSoloPro:async(id:string,pass:any,reason:string)=>{proUses.push(id);if(benefits?.failProCompletion)throw new Error('disk write failed');mp.soloPro=proLedger.completeSoloProShift(mp.soloPro,id,pass,reason);schedule();},
    certifySoloElite:async(submission:any)=>{mp.soloEliteCertification=require('../../shared/eliteCourse.ts').certifySoloElite(submission);schedule();return mp.soloEliteCertification;}};
  const same=(a:any[],b:any[])=>!!a&&!!b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
  const schedule=()=>{if(!scheduled){scheduled=true;queueMicrotask(()=>{scheduled=false;render();});}};
  const react={createContext:()=>({}),useContext:()=>{},useRef(value:any){const i=cursor++;return cells[i]??(cells[i]={current:value});},useState(value:any){const i=cursor++;if(!(i in cells))cells[i]=typeof value==='function'?value():value;return[cells[i],(next:any)=>{const result=typeof next==='function'?next(cells[i]):next;if(!Object.is(result,cells[i])){cells[i]=result;schedule();}}];},useMemo(fn:()=>any,deps:any[]){const i=cursor++;if(!cells[i]||!same(cells[i].deps,deps))cells[i]={value:fn(),deps};return cells[i].value;},useCallback(fn:any,deps:any[]){const i=cursor++;if(!cells[i]||!same(cells[i].deps,deps))cells[i]={value:fn,deps};return cells[i].value;},useEffect(fn:()=>any,deps:any[]){const i=cursor++;if(!cells[i]||!same(cells[i].deps,deps)){const previous=cells[i];cells[i]={deps,cleanup:previous?.cleanup};effects.push(()=>{previous?.cleanup?.();cells[i].cleanup=fn();});}}};
  const native={AppState:{currentState:'active',addEventListener:(_event:string,fn:(state:string)=>void)=>{listeners.push(fn);return{remove(){}};}}};
  const dependencies:Record<string,unknown>={'../shared/protocol':require('../../shared/protocol.ts'),'./game/orderPreferences':require('../game/orderPreferences.ts'),'../shared/orderPolicy':require('../../shared/orderPolicy.ts'),react,'react/jsx-runtime':{jsx:()=>null},'react-native':native,'@react-native-async-storage/async-storage':storage,'./game':engine,'./data/landmarks':{LANDMARKS:[place]},'./ui/theme':{usePalette:()=>({colors:{},isDark:false})},'./map/roadGraph':{ROAD_GRAPH:{edges:{edge:{}},nodes:{a:place}}},'./audio/sounds':{sounds:{setEnabled(){},playOffer:()=>audio.push('offer'),stopOffer(){},playAccepted:()=>audio.push('accepted')}},'./MultiplayerProvider':{useMultiplayer:()=>mp},'./multiplayer/offerClock':{offerDeadlineFromSnapshot:()=>null},'./ui/shiftPresentation':require('./shiftPresentation.ts'),'./game/shiftDuration':require('../game/shiftDuration.ts'),'../shared/pro':require('../../shared/pro.ts'),'../shared/eliteCourse':require('../../shared/eliteCourse.ts'),'../shared/worldEvents':{getWorldEventAt:()=>undefined,getWorldEventSchedule:()=>[]},'../shared/blindOrders':require('../../shared/blindOrders.ts'),'./game/vehicleCapabilities':require('../game/vehicleCapabilities.ts'),'./config/blindOrders':{SOLO_BLIND_ORDERS:false},'./ui/mapReadiness':require('./mapReadiness.ts'),'./ui/soloOfferWindow':require('./soloOfferWindow.ts')};
  const source=fs.readFileSync(path.join(project,'src/GameProvider.tsx'),'utf8');
  const code=ts.transpileModule(source+'\nexport const __controller=useGameController;',{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText;
  const module={exports:{} as any};
  vm.runInNewContext(code,{module,exports:module.exports,require:(name:string)=>{if(name in dependencies)return dependencies[name];throw new Error('Unmocked import '+name);},Date:{now:()=>now},Math,queueMicrotask,setInterval:(fn:()=>void)=>{timers.set(++timerId,fn);return timerId;},clearInterval:(id:number)=>timers.delete(id),console});
  function render(){cursor=0;current=module.exports.__controller();const pending=effects;effects=[];for(const effect of pending)effect();}
  const flush=async()=>{for(let i=0;i<40;i++)await Promise.resolve();};
  render();await flush();
  return{get value(){return current;},initial,advances,audio,writes,writeKeys,flush,mp,proUses,at:()=>now,async tick(ms:number){now+=ms;for(const fn of [...timers.values()])fn();await flush();},async foreground(value:boolean){native.AppState.currentState=value?'active':'background';for(const fn of listeners)fn(native.AppState.currentState);await flush();}};
}

test('actual solo hook starts without a card or clock and only its current rendered map releases dispatch',async()=>{
  const h=await harness();h.value.start();h.value.setShiftVisible(true);await h.flush();
  assert.equal(h.value.game.dispatchManaged,true);assert.equal(h.value.game.currentOffer,null);
  await h.tick(8000);assert.equal(h.value.game.clockMinutes,0);assert.equal(h.advances.length,0);assert.deepEqual(h.audio,[]);
  const session=h.value.mapSessionKey;h.value.beginMapLoad(session,'map-a');h.value.reportMapLoad(session,'old-map','ready');await h.flush();await h.tick(1000);assert.equal(h.value.mapReady,false);
  h.value.reportMapLoad(session,'map-a','error');await h.flush();h.value.reportMapLoad(session,'map-a','ready');await h.flush();assert.equal(h.value.mapReady,false);
  h.value.beginMapLoad(session,'map-b');await h.flush();h.value.reportMapLoad(session,'map-b','ready');await h.flush();
  assert.equal(h.value.game.dispatchManaged,false);assert.equal(h.value.game.clockMinutes,0);
  await h.tick(150);assert.ok(h.value.game.clockMinutes>0);assert.equal(h.value.game.presentedOffers,1);assert.equal(h.value.game.currentOffer.id,'offer-1');assert.deepEqual(h.audio,['offer']);
});

test('actual hook resumes a saved pre-map shift without remaining permanently dispatch-managed',async()=>{
  const first=await harness();const saved={game:first.initial(),startupPending:true,speed:30};
  const h=await harness(saved);h.value.resume();h.value.setShiftVisible(true);await h.flush();
  await h.tick(8000);assert.equal(h.value.game.clockMinutes,0);
  const session=h.value.mapSessionKey;h.value.beginMapLoad(session,'restored-map');await h.flush();h.value.reportMapLoad(session,'restored-map','ready');await h.flush();
  assert.equal(h.value.game.dispatchManaged,false);await h.tick(3000);
  const persisted=JSON.parse(h.writes.at(-1)!);assert.equal(persisted.startupPending,false);assert.equal(persisted.game.landmarks,undefined);assert.equal(h.value.speed,30);
});

test('actual hook preserves a saved offer remainder through native retry and background without a fresh five seconds',async()=>{
  const first=await harness();const game={...first.initial(),dispatchManaged:false,clockMinutes:12,currentOffer:{id:'saved-offer',expiresAt:16},presentedOffers:1};
  const h=await harness({game,soloOfferWindow:{id:'saved-offer',remainingMs:1800}});
  h.value.resume();h.value.setShiftVisible(true);await h.flush();const session=h.value.mapSessionKey;
  h.value.beginMapLoad(session,'map-a');await h.flush();await h.tick(30_000);assert.equal(h.value.game.declinedOffers,0);assert.equal(h.value.game.clockMinutes,12);
  h.value.reportMapLoad(session,'map-a','ready');await h.flush();assert.equal(h.value.offerDeadline-h.at(),1800);
  await h.tick(600);await h.foreground(false);const before=h.value.game.clockMinutes;await h.tick(20_000);assert.equal(h.value.game.clockMinutes,before);assert.equal(h.value.game.declinedOffers,0);
  h.value.beginMapLoad(session,'map-b');await h.flush();await h.foreground(true);await h.tick(9000);assert.equal(h.value.game.declinedOffers,0);
  h.value.reportMapLoad(session,'map-b','ready');await h.flush();assert.equal(h.value.offerDeadline-h.at(),1200);
  await h.tick(1199);assert.equal(h.value.game.declinedOffers,0);await h.tick(1);assert.equal(h.value.game.declinedOffers,1);await h.tick(100);assert.equal(h.value.game.declinedOffers,1);
});


test('the real hook defers an automatic-accept toggle until gameplay is ready, then accepts a valid card once',async()=>{
  const first=await harness();const game={...first.initial(),dispatchManaged:false,currentOffer:{id:'saved-offer',expiresAt:4},presentedOffers:1};
  const h=await harness({game});h.value.setAutoAcceptEnabled(true);h.value.resume();h.value.setShiftVisible(true);await h.flush();
  assert.equal(h.value.game.acceptedOffers,0);assert.equal(h.value.game.currentOffer.id,'saved-offer');
  const session=h.value.mapSessionKey;h.value.beginMapLoad(session,'map');await h.flush();h.value.reportMapLoad(session,'map','ready');await h.flush();
  h.value.setAutoAcceptEnabled(true);await h.flush();assert.equal(h.value.game.acceptedOffers,1);assert.equal(h.value.game.currentOffer,null);
  h.value.setAutoAcceptEnabled(true);await h.flush();assert.equal(h.value.game.acceptedOffers,1);
});

test('the actual controller freezes a local Pro pass at start and a restored seventh completed shift consumes it once without changing that shift',async()=>{
 const pack={id:'practice-pack',tier:'diamond',remaining:1,createdAt:100,source:'practice'};
 const seed=await harness();const ended={...seed.initial(),phase:'ended',advancedRulesVersion:1,proTier:'diamond',proPass:{packId:pack.id,tier:'diamond'},shiftEndReason:'handover'};
 const h=await harness({game:ended},{packs:[pack]});await h.flush();assert.equal(h.mp.soloPro.packs[0].remaining,0);assert.equal(h.proUses.length,1);
 assert.equal(h.value.game.proTier,'diamond');assert.equal(h.value.game.proPass.packId,pack.id);
 await h.tick(3000);assert.equal(h.proUses.length,1);h.value.start();await h.flush();assert.equal(h.value.game.proTier,'blue');assert.equal(h.value.game.proPass,undefined);
});

test('new local benefits and qualification affect the next shift, never an already active game',async()=>{
 const {ELITE_COURSE_VERSION,ELITE_QUESTIONS}=require('../../shared/eliteCourse.ts');
 const h=await harness();h.value.start();await h.flush();assert.equal(h.value.game.proTier,'blue');assert.equal(h.value.game.eliteCertified,false);
 h.mp.soloPro.packs=[{id:'new-pack',tier:'gold',remaining:7,createdAt:100,source:'practice'}];
 await h.value.submitEliteCourse({assessmentId:'solo:qualification',courseVersion:ELITE_COURSE_VERSION,answers:ELITE_QUESTIONS.map((item:any)=>item.correct)});await h.flush();
 assert.equal(h.value.game.eliteCertified,false);assert.equal(h.value.game.proTier,'blue');h.value.start();await h.flush();assert.equal(h.value.game.proTier,'gold');assert.equal(h.value.game.eliteCertified,true);assert.equal(h.value.game.advancedRulesVersion,1);
});

test('restoring an incomplete shift cannot consume a local practice entitlement',async()=>{
 const first=await harness(),pack={id:'not-used',tier:'gold',remaining:7,createdAt:100,source:'practice'};
 const h=await harness({game:{...first.initial(),phase:'ended',advancedRulesVersion:1,proTier:'gold',proPass:{packId:pack.id,tier:'gold'},shiftEndReason:'handover-missed'}},{packs:[pack]});
 assert.equal(h.mp.soloPro.packs[0].remaining,7);assert.equal(h.proUses.length,0);
});

test('a restored completed shift keeps its frozen old tier and cannot debit a replacement pack or block the next shift',async()=>{
 const first=await harness(),replacement={id:'replacement-diamond',tier:'diamond',remaining:7,createdAt:200,source:'practice'};
 const game={...first.initial(),phase:'ended',advancedRulesVersion:1,proTier:'gold',proPass:{packId:'retired-gold',tier:'gold'},shiftEndReason:'handover'};
 const h=await harness({game},{packs:[replacement]});await h.flush();
 assert.equal(h.value.game.proTier,'gold');assert.equal(h.mp.soloPro.packs[0].remaining,7);assert.equal(h.mp.soloPro.completedShifts['solo:fixture'],true);
 assert.equal(h.value.proSettlementRequired,false);await h.tick(3000);assert.equal(h.proUses.length,1);
 h.value.start();await h.flush();assert.equal(h.value.game.proTier,'diamond');assert.equal(h.value.game.proPass.packId,replacement.id);
});

test('an unresolved completed-shift write cannot be bypassed by discarding the summary or starting again',async()=>{
 const first=await harness(),pack={id:'pending-credit',tier:'gold',remaining:1,createdAt:100,source:'practice'},benefits={packs:[pack],failProCompletion:true};
 const h=await harness({game:{...first.initial(),phase:'ended',proTier:'gold',proPass:{packId:pack.id,tier:'gold'},shiftEndReason:'handover'}},benefits);await h.flush();
 assert.equal(h.value.proSettlementRequired,true);h.value.discard();h.value.start();await h.flush();assert.equal(h.value.game.phase,'ended');assert.equal(h.mp.soloPro.packs[0].remaining,1);
 benefits.failProCompletion=false;await h.value.retryProSettlement();await h.flush();assert.equal(h.value.proSettlementRequired,false);assert.equal(h.mp.soloPro.packs[0].remaining,0);h.value.discard();await h.flush();assert.equal(h.value.game,null);
});

test('the actual solo hook freezes order types and blind mode per shift, while new preferences persist separately',async()=>{
 const h=await harness();h.value.setOrderPreferences({enabledPricingTypes:['taxi-metered']});h.value.setBlindOrdersPreference(true);await h.flush();h.value.start();await h.flush();assert.equal(h.value.blindOrders,true);assert.deepEqual(Array.from(h.value.game.orderPreferences.enabledPricingTypes),['taxi-metered']);
 h.value.setOrderPreferences({enabledPricingTypes:['private-upfront']});h.value.setBlindOrdersPreference(false);await h.flush();assert.equal(h.value.blindOrders,true);assert.equal(h.value.game.blindOrders,true);assert.deepEqual(Array.from(h.value.game.orderPreferences.enabledPricingTypes),['taxi-metered']);
 await h.tick(3000);assert.ok(h.writeKeys.every(key=>key==='harbour-shift.session.v3'));const saved=JSON.parse(h.writes.at(-1)!);assert.equal(saved.game.blindOrders,true);assert.equal(saved.blindOrdersPreference,false);assert.deepEqual(saved.orderPreferencesInputs['kam-fung'].enabledPricingTypes,['private-upfront']);
 const restored=await harness(saved);assert.equal(restored.value.blindOrders,true);assert.deepEqual(Array.from(restored.value.game.orderPreferences.enabledPricingTypes),['taxi-metered']);restored.value.start();await restored.flush();assert.equal(restored.value.blindOrders,false);assert.deepEqual(Array.from(restored.value.game.orderPreferences.enabledPricingTypes),['private-upfront']);
});
test('a missing legacy blind flag uses the previous operator default rather than applying an unrelated new-shift preference',async()=>{
 const first=await harness(),h=await harness({game:first.initial(),blindOrdersPreference:true});assert.equal(h.value.game.blindOrders,undefined);assert.equal(h.value.blindOrders,false);h.value.start();await h.flush();assert.equal(h.value.game.blindOrders,true);
});

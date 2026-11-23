import assert from 'node:assert/strict';
import test from 'node:test';
import {activeProPack,currentProPass,proActivationBlock,proTierBilingualName,type ProPack} from '../../shared/pro';
import {addSoloPracticePass,completeSoloProShift,emptySoloProLedger,readSoloProLedger} from './proLedger';

const pack=(id:string,tier:ProPack['tier'],remaining=7,createdAt=100):ProPack=>({id,tier,remaining,createdAt,source:'practice'});

test('a higher solo tier replaces remaining credits; neither same-tier stacking nor downgrade is allowed',()=>{
 let ledger=addSoloPracticePass(emptySoloProLedger(),'gold','gold',100);
 ledger=completeSoloProShift(ledger,'solo:first',{packId:'gold',tier:'gold'},'handover');
 assert.equal(ledger.packs[0].remaining,6);
 assert.throws(()=>addSoloPracticePass(ledger,'gold','another-gold',101),/不能疊加/);
 ledger=addSoloPracticePass(ledger,'platinum','platinum',102);
 assert.deepEqual(ledger.packs,[pack('platinum','platinum',7,102)]);
 assert.equal(proActivationBlock('gold',ledger.packs),'downgrade');
 assert.throws(()=>addSoloPracticePass(ledger,'gold','lower',103),/不能降級/);
 assert.equal(addSoloPracticePass(ledger,'platinum','platinum',102),ledger,'same activation receipt is idempotent');
 assert.equal(ledger.completedShifts['solo:first'],true);
});

test('legacy mixed and duplicate packs normalize deterministically and never surface after exhaustion',()=>{
 const old=[pack('old-gold','gold'),pack('diamond-z','diamond',3,90),pack('diamond-a','diamond',4,90),pack('platinum','platinum')];
 let ledger=readSoloProLedger({version:1,packs:old,completedShifts:{'solo:historic':true}});
 assert.equal(activeProPack(ledger.packs)?.id,'diamond-a');
 assert.deepEqual(readSoloProLedger({version:1,packs:[...old].reverse(),completedShifts:{'solo:historic':true}}),ledger);
 for(let i=0;i<4;i++)ledger=completeSoloProShift(ledger,`solo:finish-${i}`,{packId:'diamond-a',tier:'diamond'},'handover');
 assert.equal(currentProPass(ledger.packs),undefined);
 ledger=readSoloProLedger(JSON.parse(JSON.stringify(ledger)));
 assert.deepEqual(ledger.packs,[]);
 assert.equal(ledger.completedShifts['solo:historic'],true);
});

test('a frozen shift on a replaced pack settles once without consuming its replacement',()=>{
 const old=addSoloPracticePass(emptySoloProLedger(),'gold','frozen-gold',100);
 let upgraded=addSoloPracticePass(old,'diamond','new-diamond',200);
 upgraded=readSoloProLedger(JSON.parse(JSON.stringify(upgraded)));
 const settled=completeSoloProShift(upgraded,'solo:in-progress',{packId:'frozen-gold',tier:'gold'},'handover');
 assert.equal(settled.completedShifts['solo:in-progress'],true);
 assert.deepEqual(settled.packs,upgraded.packs);
 assert.equal(completeSoloProShift(settled,'solo:in-progress',{packId:'frozen-gold',tier:'gold'},'handover'),settled);
 assert.equal(completeSoloProShift(settled,'solo:forfeit',{packId:'new-diamond',tier:'diamond'},'forfeit'),settled);
});

test('tier presentation exposes canonical Chinese and English without changing entitlement IDs',()=>{
 assert.equal(proTierBilingualName('gold'),'金級 · Gold');
 assert.equal(proTierBilingualName('diamond'),'鑽石級 · Diamond');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {syncSoloOfferWindow} from './soloOfferWindow';

const source=fs.readFileSync(new URL('./OfferPlanningResume.tsx',import.meta.url),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText;
const module={exports:{}as any};
vm.runInNewContext(code,{module,exports:module.exports,require:(name:string)=>name==='react/jsx-runtime'?{jsx:(type:any,props:any)=>({type,props})}:name==='./components'?{Button:'native-button'}:{}});
const render=module.exports.OfferPlanningResume;
test('a paused solo offer has an accessible resume button in its own panel while unrelated states do not',()=>{
  const props={online:false,planning:true,hasOffer:true,mapReady:true,onResume(){},colors:{}};
  const button=render(props);assert.equal(button.type,'native-button');assert.equal(button.props.testID,'resume-offer-planning');assert.equal(button.props.title,'繼續行車');assert.ok(button.props.style.minHeight>=44);assert.equal(button.props.cue,false,'actual resume observer owns the single cue');
  for(const patch of [{online:true},{planning:false},{hasOffer:false},{mapReady:false}])assert.equal(render({...props,...patch}),null);
});
test('using that button resumes the same offer remainder rather than giving another five seconds',()=>{
  let planning=true,window=syncSoloOfferWindow(null,'same-offer',0,false);window=syncSoloOfferWindow(window,'same-offer',1700,true);
  const button=render({online:false,planning,hasOffer:true,mapReady:true,onResume(){planning=false;window=syncSoloOfferWindow(window,'same-offer',9000,false);},colors:{}});
  button.props.onPress();assert.equal(planning,false);assert.equal(window!.id,'same-offer');assert.equal(window!.deadline-9000,3300);
});

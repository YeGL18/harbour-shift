import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {VEHICLES,VEHICLE_BY_ID} from '../data/vehicles';
import {groupedVehicles,roomCatalogVehicles,vehicleArtwork,vehiclePickerDetails} from './vehiclePresentation';

function load<T=any>(path:string,mocks:Record<string,unknown>={}):T {
 const filename=fileURLToPath(new URL(path,import.meta.url)),module={exports:{}},require=createRequire(filename);
 const source=ts.transpileModule(readFileSync(filename,'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 const wrapper=runInNewContext(`(function(require,module,exports){${source}\n})`);wrapper((id:string)=>mocks[id]??require(id),module,module.exports);return module.exports as T;
}
function elements(root:any):any[]{if(!root||typeof root!=='object')return[];return[root,...[root.props?.children].flat(Infinity).flatMap(elements)];}
const localized={useLocale:()=> 'en',getLocalizedPlaceName:(vehicle:any)=>vehicle.nameEn||vehicle.name,t:(value:string)=>value==='車租'?'Rental':value==='充電'?'Charging':value==='交流充電'?'AC charging':value.replace(/^最多 (\d+) 客$/,'Up to $1 passengers'),LocalizedText:'text',LocalizedPressable:'pressable'};
const svg={__esModule:true,default:'svg',Path:'path',Rect:'rect',Circle:'circle',Ellipse:'ellipse',Line:'line',Text:'text',Defs:'defs',LinearGradient:'linearGradient',Stop:'stop',G:'g'};

test('picker groups catalogue once into taxis, standard private cars and genuine six-passenger XL vehicles',()=>{
 const groups=groupedVehicles(VEHICLES);assert.equal(groups.map(group=>group.id).join(','),'taxi,private,seven-seat');assert.equal(groups.map(group=>group.vehicles.length).join(','),'3,7,2');assert.equal(new Set(groups.flatMap(group=>group.vehicles.map(vehicle=>vehicle.id))).size,12);
 assert.equal(roomCatalogVehicles(undefined).map(vehicle=>vehicle.id).join(','),'kam-fung,little-treasure,red-flag,private');assert.equal(roomCatalogVehicles(99).length,4);assert.equal(roomCatalogVehicles(1).length,12);
 for(const vehicle of groups[2].vehicles){assert.equal(vehiclePickerDetails(vehicle).capacity,6);assert.equal(vehiclePickerDetails(vehicle).xl,true);}for(const vehicle of groups[1].vehicles)assert.equal(vehiclePickerDetails(vehicle).capacity,4);
 assert.equal(vehiclePickerDetails(VEHICLE_BY_ID['tesla-model-s']).energyLabel,'交流充電');assert.equal(vehiclePickerDetails(VEHICLE_BY_ID['alphard-hybrid']).energyLabel,'汽油混能');
});

test('actual SVG garage and map renderers reserve roof signs for taxi vehicles and use the same body family',()=>{
 const {CarIllustration}=load('./CarIllustration.tsx',{'../i18n':localized,'react-native-svg':svg});
 const {VehicleMarker}=load('../map/VehicleMarker.tsx',{'../i18n':localized,'react-native-svg':svg});
 const marker=VehicleMarker.type;
 for(const vehicle of VEHICLES){
  const profile=vehicleArtwork(vehicle.id);assert.equal(profile.taxi,vehicle.type==='taxi');
  const side=elements(CarIllustration({id:vehicle.id,width:66,dark:false}));const top=elements(marker({vehicleId:vehicle.id,dark:true}));
  assert.equal(side.some(node=>node.type==='text'&&node.props.children==='TAXI'),vehicle.type==='taxi',`${vehicle.id} garage roof`);
  assert.equal(top.some(node=>node.type==='rect'&&node.props.fill==='#F6EBCF'),vehicle.type==='taxi',`${vehicle.id} map roof`);
 }
 assert.equal(vehicleArtwork('alphard-hybrid').style,'mpv');assert.equal(vehicleArtwork('tesla-model-y').style,'crossover');assert.equal(vehicleArtwork('aion-y-plus-standard').style,'crossover');assert.equal(vehicleArtwork('mg4-trophy').style,'hatchback');assert.equal(vehicleArtwork('tesla-model-s').long,true);
});

test('shared picker retains radio IDs/selection, filters old room choices and yields artwork space at large text',()=>{
 const selections:string[]=[],cues:string[]=[];let fontScale=1;
 const {VehiclePicker}=load('./VehiclePicker.tsx',{'../i18n':localized,'react-native':{View:'view',StyleSheet:{create:(styles:any)=>styles,hairlineWidth:1},useWindowDimensions:()=>({fontScale})},'../audio/sounds':{sounds:{playCue:(cue:string)=>cues.push(cue)}},'./components':{Icon:'icon'},'./CarIllustration':{CarIllustration:'art'},'./theme':{money:(value:number)=>String(value)}});
 const props={value:'private',onChange:(value:string)=>selections.push(value),colors:{},vehicles:roomCatalogVehicles(undefined),prefix:'room-vehicle'};
 const rows=elements(VehiclePicker(props)).filter(node=>node.props?.accessibilityRole==='radio');assert.equal(rows.length,4);assert.equal(rows.find(node=>node.props.testID==='room-vehicle-private').props.accessibilityState.checked,true);
 rows.find(node=>node.props.testID==='room-vehicle-private').props.onPress();assert.equal(selections.length,0);rows.find(node=>node.props.testID==='room-vehicle-kam-fung').props.onPress();assert.equal(selections.join(','),'kam-fung');assert.equal(cues.join(','),'select');
 const modern=elements(VehiclePicker({...props,vehicles:VEHICLES,value:'tesla-model-y',prefix:'vehicle'}));const tesla=modern.find(node=>node.props?.testID==='vehicle-tesla-model-y');assert.ok(tesla.props.accessibilityLabel.includes('Up to 4 passengers'));assert.ok(tesla.props.accessibilityLabel.includes('Charging'));assert.equal(elements(tesla).find(node=>node.type==='art')?.props.width,66);
 fontScale=2;assert.ok(!elements(VehiclePicker({...props,vehicles:VEHICLES})).some(node=>node.type==='art'),'Large text gives width to the name and metadata');
});

test('restored vehicle components use the original silhouettes and theme paints',()=>{
 const {CarIllustration}=load('./CarIllustration.tsx',{'../i18n':localized,'react-native-svg':svg});
 const marker=load('../map/VehicleMarker.tsx',{'../i18n':localized,'react-native-svg':svg}).VehicleMarker.type;
 for(const {id} of VEHICLES){
  const {body,taxi}=vehicleArtwork(id);
  for(const dark of [false,true]){
   const side=CarIllustration({id,width:66,dark}),top=marker({vehicleId:id,dark});
   assert.equal(side.props.width,66);
   assert.equal(side.props.height,33);
   assert.equal(side.props.viewBox,'0 0 280 140');
   assert.equal(top.props.viewBox,'-22 -36 44 68');
   assert.equal(top.props.width,44);
   assert.equal(top.props.height,68);
   assert.ok(elements(side).some(node=>node.type==='path'&&node.props.fill===(dark&&!taxi?'#C6CDD3':body)),id);
   assert.ok(elements(top).some(node=>node.type==='path'&&node.props.fill===body),id);
  }
 }
});

test('actual map rendering hides decorative traffic while preserving real peers and physical queue coordinates',()=>{
 const React=createRequire(import.meta.url)('react');let npcCalls=0;
 const react={...React,__esModule:true,default:React,useState:(initial:any)=>{const value=typeof initial==='function'?initial():initial;return[typeof value==='boolean'?true:value,()=>{}];},useRef:(value:any)=>({current:value}),useMemo:(fn:any)=>fn(),useEffect:()=>{}};
 const shared=(value:any)=>({get:()=>value,set:(next:any)=>{value=next;}}),graph={nodes:{},edges:{},outgoing:{}};
 const filename=fileURLToPath(new URL('../map/GameMap.tsx',import.meta.url)),module={exports:{}as any},require=createRequire(filename);
 const source=ts.transpileModule(readFileSync(filename,'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 const mocks:Record<string,unknown>={react,'react-native':{View:'view',StyleSheet:{create:(s:any)=>s,absoluteFill:{}}},'../i18n':localized,'expo-asset':{},'expo-file-system':{},'@maplibre/maplibre-react-native':{Camera:'camera',GeoJSONSource:'source',Layer:'layer',Map:'native-map',Marker:'marker'},'react-native-reanimated':{__esModule:true,default:{createAnimatedComponent:()=> 'animated-marker',View:'animated-view'},Easing:{linear:()=>{}},useAnimatedProps:(fn:any)=>fn(),useAnimatedStyle:(fn:any)=>fn(),useReducedMotion:()=>false,useSharedValue:shared,withTiming:(value:any)=>value},'./roadGraph':{ROAD_GRAPH:graph,MAP_DATA_CREDIT:'Credit',distanceMetres:(a:any,b:any)=>Math.hypot((a.lat-b.lat)*111000,(a.lon-b.lon)*102000)},'./nativeData':{},'./VehicleMarker':{VehicleMarker:'own-vehicle'},'./PeerVehicle':{PeerVehicle:'peer',QueueVehicle:'queue',peerColor:()=> '#112233',validPeerCoordinate:(p:any)=>Number.isFinite(p?.lat)&&Number.isFinite(p?.lon)},'./surgeLayers':{makeSurgeLayers:()=>({heat:{},labels:{}}),demandHeatLayers:()=>[{id:'heat-last'}],demandWaitLabel:()=>'',WAIT_PILL_COLORS:{},surgeLevel:()=> 'quiet',surgeSignature:()=>''},'./useTripOverview':{useTripOverview:()=>({coordinates:null,activeRef:{current:false},cancel:()=>false})},'../game/traffic':{getNearbyNpcTraffic:()=>{npcCalls++;return[{id:'decorative-road-car',position:{lat:22.3,lon:114.104,heading:0}}];}},'../game/access':{getVehicleGraph:()=>graph}};
 const wrapper=runInNewContext(`(function(require,module,exports){${source}\n})`,{process:{env:{EXPO_OS:'ios'}},console});wrapper((id:string)=>mocks[id]??require(id),module,module.exports);
 const position={lat:22.3,lon:114.1,heading:0},queue={id:'true-queue-slot',position:{...position,lon:114.1005},vehicleId:'kam-fung'},peer={id:'friend',position:{...position,lon:114.101},name:'Driver',color:'#112233'};
 const rendered=elements(module.exports.GameMap.type({position,lookahead:[],branches:[],dark:false,onBranch:()=>{},roadGraph:graph,queueVehicles:[queue],peers:[peer],trafficWorld:{seed:1,startTimeMinutes:300,clockMinutes:5}}));
 assert.equal(npcCalls,0);assert.equal(rendered.filter(node=>node.type==='queue').length,1);assert.deepEqual(rendered.find(node=>node.type==='queue')!.props.vehicle.position,queue.position);assert.equal(rendered.filter(node=>node.type==='peer').length,1);assert.deepEqual(rendered.find(node=>node.type==='peer')!.props.peer.position,peer.position);assert.equal(rendered.filter(node=>node.type==='own-vehicle').length,1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import type { FeatureCollection, Point } from 'geojson';
import type { SurgeArea } from '../game/types';
import { demandHeatLayers, demandWaitLabel, makeSurgeLayers, surgeSignature, WAIT_PILL_COLORS } from '../map/surgeLayers';
import { translateForLocale } from '../i18n/translate';

const area: SurgeArea = { id:'moving-field',name:'Field',center:{lat:22.3,lon:114.17},level:'normal',multiplier:1,waitMinutesMin:3,waitMinutesMax:7,radiusM:2000,intensity:.4,sampledAtMinute:42 };
const collection = (value:string) => JSON.parse(value) as FeatureCollection<Point>;

test('quiet demand has a real soft footprint and a yellow point, without a wait-pill tier',()=>{
  const pickupDot={lat:22.301,lon:114.168};
  const quiet={...area,pickupDot,level:'quiet' as const,intensity:.12,radiusM:1400,waitMinutesMin:6,waitMinutesMax:10};
  const data=makeSurgeLayers([quiet]);
  const heat=collection(data.heat),anchor=collection(data.labels).features[0];
  assert.ok(heat.features.length>1);
  assert.ok(heat.features.every(feature=>feature.properties?.level==='quiet' && feature.properties.weight>0));
  assert.equal(anchor.properties?.color,'#FFC44D');
  assert.deepEqual(anchor.geometry.coordinates,[pickupDot.lon,pickupDot.lat]);
  assert.equal(Object.hasOwn(WAIT_PILL_COLORS,'quiet'),false);
});

test('orange waits always begin at one, while red/purple uses one minute',()=>{
  assert.equal(demandWaitLabel(area),'1–7 分鐘');
  assert.equal(demandWaitLabel({...area,level:'busy',waitMinutesMin:2,waitMinutesMax:3}),'1–3 分鐘');
  assert.equal(demandWaitLabel({...area,level:'surge',waitMinutesMax:2}),'1 分鐘');
  assert.equal(demandWaitLabel({...area,waitMinutesMax:15}),'1–15 分鐘');
  assert.equal(demandWaitLabel({...area,waitMinutesMax:NaN}),'1 分鐘');
});

test('wait labels remain localized through the actual translator in every locale',()=>{
  for(const [input,english,hans]of [[area,'1–7 min','1–7 分钟'],[{...area,level:'surge' as const},'1 min','1 分钟']]as const){
    const label=demandWaitLabel(input);
    assert.equal(translateForLocale(label,'en'),english);
    assert.equal(translateForLocale(label,'zh-Hans'),hans);
    assert.equal(translateForLocale(label,'zh-Hant'),label);
    assert.equal(translateForLocale(label,'zh-HK'),label);
  }
});

test('a mixed field does not promote quiet or orange patches into the hot colour ramp',()=>{
  for(const dark of [false,true]){
    const layers=demandHeatLayers(dark);
    const quiet=layers.find(layer=>layer.id.endsWith('quiet'))!;
    const normal=layers.find(layer=>layer.id.endsWith('normal'))!;
    const busy=layers.find(layer=>layer.id.endsWith('busy'))!;
    const hot=layers.find(layer=>layer.id.endsWith('surge'))!;
    assert.deepEqual(quiet.filter,['==',['get','level'],'quiet']);
    assert.deepEqual(normal.filter,['==',['get','level'],'normal']);
    assert.deepEqual(busy.filter,['==',['get','level'],'busy']);
    assert.notDeepEqual(quiet.paint?.['heatmap-color'],hot.paint?.['heatmap-color']);
    assert.notDeepEqual(normal.paint?.['heatmap-color'],busy.paint?.['heatmap-color']);
    const errors=validateStyleMin({version:8,sources:{'demand-heat':{type:'geojson',data:collection(makeSurgeLayers([area]).heat)}},layers});
    assert.deepEqual(errors,[]);
  }
});

test('the cloud remains deterministic and follows the world field without mutating estimates',()=>{
  const original=structuredClone(area),first=makeSurgeLayers([area]);
  assert.deepEqual(makeSurgeLayers([area]),first);
  const shifted={...area,center:{lat:area.center.lat+.001,lon:area.center.lon+.002}};
  const points=collection(first.heat).features,moved=collection(makeSurgeLayers([shifted]).heat).features;
  assert.ok(Math.abs(moved[0].geometry.coordinates[0]-points[0].geometry.coordinates[0]-.002)<1e-10);
  assert.ok(Math.abs(moved[0].geometry.coordinates[1]-points[0].geometry.coordinates[1]-.001)<1e-10);
  assert.notEqual(surgeSignature([area]),surgeSignature([shifted]));
  assert.deepEqual(area,original);
});

test('wait pills keep small white labels readable in both appearances',()=>{
  const linear=(value:number)=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4;
  for(const color of Object.values(WAIT_PILL_COLORS)){
    const rgb=color.match(/[a-f0-9]{2}/gi)!.map(value=>linear(parseInt(value,16)/255));
    const luminance=.2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];
    assert.ok(1.05/(luminance+.05)>=4.5,`${color} white label contrast`);
  }
});

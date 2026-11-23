import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateIOSScreenCorners, type IOSCornerGeometry } from '../map/screenCornerGeometry';
import { insetScreenCornerRadius } from '../map/mapScale';

const phone:IOSCornerGeometry={width:393,height:852,insets:{top:59,right:0,bottom:34,left:0},idiom:'phone'};
test('modern phone layout gets an explicit estimate rather than a claimed hardware measurement',()=>{
  const result=estimateIOSScreenCorners(phone);
  assert.equal(result.supported,true);
  assert.equal(result.source,'ios-safe-area-estimate');
  assert.equal(result.accuracy,'estimated');
  assert.equal(result.bottomLeft,result.bottomRight);
  const card=insetScreenCornerRadius(result.bottomLeft,12,34,24);
  assert.ok(card>=26&&card<=32);
});
test('rotation retains the same bounded curve while actual side insets are applied separately',()=>{
  const portrait=estimateIOSScreenCorners(phone);
  const landscape=estimateIOSScreenCorners({...phone,width:852,height:393,insets:{top:0,right:59,bottom:21,left:59}});
  assert.equal(landscape.bottomLeft,portrait.bottomLeft);
  assert.equal(insetScreenCornerRadius(landscape.bottomLeft,71,21,24),24);
});
test('home-button, tablet, resized and non-phone windows use the ordinary card fallback',()=>{
  for(const geometry of [
    {...phone,width:375,height:667,insets:{top:20,right:0,bottom:0,left:0}},
    {...phone,width:834,height:1194,idiom:'pad' as const},
    {...phone,idiom:'other' as const},
    {...phone,width:393,height:500},
    {...phone,insets:{...phone.insets,bottom:80}},
  ]){
    const result=estimateIOSScreenCorners(geometry);
    assert.equal(result.supported,false);
    assert.equal(result.accuracy,'unavailable');
    assert.equal(insetScreenCornerRadius(result.bottomLeft,12,34,24),24);
  }
});
test('small and large phone estimates stay conservative and invalid measurements never leak NaN',()=>{
  for(const width of [320,360,375,390,393,402,430,440,500]){
    const value=estimateIOSScreenCorners({...phone,width,height:width*2.1}).bottomLeft;
    assert.ok(value>=52&&value<=68);
  }
  for(const invalid of [NaN,Infinity,-1]){
    assert.equal(estimateIOSScreenCorners({...phone,width:invalid}).supported,false);
    assert.equal(estimateIOSScreenCorners({...phone,insets:{...phone.insets,bottom:invalid}}).supported,false);
  }
});

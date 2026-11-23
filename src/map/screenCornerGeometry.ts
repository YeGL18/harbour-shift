export interface ScreenCorners {
  /** A usable layout value is available; inspect accuracy before calling it measured. */
  supported: boolean;
  source: 'android-window-insets' | 'ios-safe-area-estimate' | 'unavailable';
  accuracy: 'measured' | 'estimated' | 'unavailable';
  topLeft: number;
  topRight: number;
  bottomLeft: number;
  bottomRight: number;
}
export interface WindowSafeInsets {top:number;right:number;bottom:number;left:number}
export interface IOSCornerGeometry {width:number;height:number;insets:WindowSafeInsets;idiom:'phone'|'pad'|'other'}
export const UNAVAILABLE_CORNERS: ScreenCorners = {
  supported:false,source:'unavailable',accuracy:'unavailable',topLeft:0,topRight:0,bottomLeft:0,bottomRight:0,
};
const valid=(value:number)=>Number.isFinite(value)&&value>=0;

/**
 * UIKit's public safe area is an unobscured-content rectangle, not the panel's
 * corner radius. This bounded phone-layout heuristic is deliberately labelled
 * estimated. It uses no model table, private selector or physical-screen query.
 * New UIKit can configure native container-concentric views, but RN's numeric
 * borderRadius does not expose that resolver.
 */
export function estimateIOSScreenCorners({width,height,insets,idiom}:IOSCornerGeometry):ScreenCorners {
  if(idiom!=='phone'||![width,height,...Object.values(insets)].every(valid)||width===0||height===0)return UNAVAILABLE_CORNERS;
  const portraitWidth=Math.min(width,height),longSide=Math.max(width,height);
  // Exclude tablets, small resizable windows, home-button phones and safe
  // areas enlarged by an app's own bottom bars. No hardware inference there.
  const modernSafeArea=insets.bottom>=18&&insets.bottom<=40&&(Math.max(insets.top,insets.left,insets.right)>=40||insets.bottom>=28);
  if(portraitWidth<300||portraitWidth>500||longSide/portraitWidth<1.6||!modernSafeArea)return UNAVAILABLE_CORNERS;
  const value=Math.round(Math.max(52,Math.min(68,portraitWidth*.15+2))*2)/2;
  return {supported:true,source:'ios-safe-area-estimate',accuracy:'estimated',topLeft:value,topRight:value,bottomLeft:value,bottomRight:value};
}

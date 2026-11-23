import React from 'react';
import Svg, { Path, Rect, Circle, Ellipse, Line, Text as SvgText } from 'react-native-svg';
import type { VehicleId } from '../game/types';
import {VEHICLE_BY_ID} from '../data/vehicles';
import {getLocalizedPlaceName,useLocale} from '../i18n';
import {vehicleArtwork} from './vehiclePresentation';

/** Original side silhouettes. Private models never acquire a taxi roof light. */
export function CarIllustration({ id, width = 200, dark = false }: { id: VehicleId; width?: number; dark?: boolean }) {
 useLocale();const profile=vehicleArtwork(id),{taxi,style}=profile;
 const body=taxi?profile.body:dark?'#C6CDD3':profile.body,roof=taxi?'#D5D5D3':body,glass=dark?'#263D4A':'#B4C6CD',seam=taxi?'#7D3432':dark?'#75818C':'#303C48';
 const tall=style==='mpv',fastback=style==='fastback';
 return <Svg width={width} height={width*.5} viewBox="0 0 280 140" accessibilityLabel={getLocalizedPlaceName(VEHICLE_BY_ID[id])}>
  <Ellipse cx="142" cy="115" rx="116" ry="8" fill={dark?'#0C0D0F':'#DDDEDF'}/>
  {tall?<>
   <Path d="M23 91L30 66Q34 58 53 57L73 27Q79 20 94 20H211Q225 20 230 35L244 77L257 81V107H21Z" fill={body}/>
   <Path d="M73 27Q79 20 94 20H211Q225 20 230 35L236 54H55Z" fill={roof}/>
   <Path d="M80 29H116V58H62Z M124 29H168V58H124Z M176 29H212L224 58H176Z" fill={glass}/>
   <Path d="M119 64V101M171 64V101" stroke={seam} strokeWidth="2"/>
   <Rect x="136" y="68" width="18" height="3" rx="1" fill="#DDE1E4"/>
   {!taxi&&<><Path d="M237 83H253V101H239" fill={seam}/>{(id==='vellfire-hybrid'?[87,95]:[86,91,96]).map(y=><Line key={y} x1="241" y1={y} x2="252" y2={y} stroke="#BEC7CE" strokeWidth="1.6"/>)}</>}
  </>:style==='crossover'?<>
   <Path d={id==='tesla-model-y'?'M20 91L35 73L70 62L95 33Q103 25 120 25H177Q190 25 204 41L231 69L255 80L261 106H18Z':'M20 92L31 72L59 64L78 31Q84 24 103 24H199Q213 25 223 48L237 72L257 81L261 106H18Z'} fill={body}/>
   <Path d={id==='tesla-model-y'?'M99 35Q105 31 120 31H177Q189 32 198 44L215 64H79Z':'M84 33H120V62H69Z M128 33H168V62H128Z M176 33H199Q207 34 215 61H176Z'} fill={glass}/>
   <Path d="M124 67V102M208 68L219 103" stroke={seam} strokeWidth="2"/><Rect x="138" y="72" width="17" height="3" rx="1" fill="#D5DEE2"/>
  </>:style==='hatchback'?<>
   <Path d="M22 90L37 72L66 65L86 35Q92 29 107 29H176Q189 30 199 44L221 69L251 80L260 106H20Z" fill={body}/>
   <Path d="M91 38H124V63H76Z M132 37H176Q183 38 190 49L207 64H132Z" fill={glass}/><Path d="M127 69V102M207 72L218 103" stroke={seam} strokeWidth="2"/>
   <Path d="M28 79L51 76L47 85H24M231 76L250 81L254 86H238" fill="#DFE8ED"/>
  </>:fastback?<>
   <Path d={profile.long?'M15 91L32 77L68 66L98 36Q108 28 127 28H177Q191 29 205 42L231 69L258 80L265 106H14Z':'M20 91L34 76L71 65L99 35Q105 30 121 30H177Q188 30 202 40L229 68L255 79L262 104H18Z'} fill={body}/>
   <Path d="M71 65L99 35Q105 30 121 30H177Q188 30 202 40L229 68Z" fill={roof}/><Path d="M103 39H136V64H81Z M143 39H177Q185 39 193 46L213 64H143Z" fill={glass}/>
   <Path d="M139 69V102M213 70L222 101" stroke={seam} strokeWidth="2"/><Rect x="151" y="73" width="16" height="3" rx="1" fill="#D6DEE1"/>
  </>:<>
   <Path d="M18 87L62 76L87 43Q92 37 105 37H177Q190 37 197 46L218 74L252 80L260 106H17Z" fill={body}/>
   <Path d="M62 76L87 43Q92 37 105 37H177Q190 37 197 46L218 74Z" fill={roof}/><Path d="M91 45H124V71H72Z M132 45H175Q183 45 188 52L203 71H132Z" fill={glass}/>
   <Path d="M127 77V103M205 77V103" stroke={seam} strokeWidth="2"/><Rect x="141" y="80" width="17" height="3" rx="1" fill="#E4E7E9"/>
  </>}
  {taxi&&<><Rect x={tall?136:125} y={tall?11:fastback?21:28} width="31" height="10" rx="2" fill="#F5F0DA"/><SvgText x={tall?151.5:140.5} y={tall?18.5:fastback?28.5:35.5} fill="#3B3A35" fontSize="6.5" fontWeight="700" textAnchor="middle">TAXI</SvgText><SvgText x="113" y={tall?87:94} fill="#F4EEDC" fontSize="9" fontWeight="700">的士 TAXI</SvgText></>}
  <Path d="M24 87H44L42 93H22M241 82H254L257 89H245" fill="#F2EEDB"/>
  <Line x1="24" y1="103" x2="253" y2="103" stroke={taxi?'#9B3937':seam} strokeWidth="4"/>
  {[62,216].map(x=><React.Fragment key={x}><Circle cx={x} cy="105" r="19" fill="#25272A"/><Circle cx={x} cy="105" r="11" fill="#B8BDC0"/><Circle cx={x} cy="105" r="5" fill="#737B80"/></React.Fragment>)}
 </Svg>;
}

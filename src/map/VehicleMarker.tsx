import React, { memo } from 'react';
import Svg, { Ellipse, Line, Path, Rect } from 'react-native-svg';
import type { VehicleId } from '../game/types';
import {getLocalizedPlaceName,t,useLocale} from '../i18n';
import {VEHICLE_BY_ID} from '../data/vehicles';
import {vehicleArtwork} from '../ui/vehiclePresentation';

/** Original top-down profiles share exactly the garage's taxi/body classification. */
export const VehicleMarker=memo(function VehicleMarker({vehicleId,dark}:{vehicleId:VehicleId;dark:boolean}){
 useLocale();const profile=vehicleArtwork(vehicleId),{taxi,style}=profile,tall=style==='mpv',crossover=style==='crossover',fastback=style==='fastback';
 const body=profile.body,roof=taxi?'#DDDEDA':dark?'#A5B2BC':'#8596A3',outline=dark?'#E0E5E8':'#FFFFFF',glass='#233844';
 const silhouette=tall?'M-14,-23Q-14,-29 -8,-29H8Q14,-29 14,-23V25Q14,31 8,31H-8Q-14,31 -14,25Z':crossover?'M-14,-19Q-13,-29 0,-30Q13,-29 14,-19V21Q14,29 7,30H-7Q-14,29 -14,21Z':fastback?(profile.long?'M-12,-22Q-10,-32 0,-33Q10,-32 12,-22L14,19Q13,30 6,31H-6Q-13,30 -14,19Z':'M-12,-20Q-11,-28 0,-29Q11,-28 12,-20L14,17Q14,27 6,29H-6Q-14,27 -14,17Z'):style==='hatchback'?'M-13,-18Q-12,-27 0,-28Q12,-27 13,-18V21Q13,26 7,26H-7Q-13,26 -13,21Z':'M-12,-21Q-12,-27 -6,-27H6Q12,-27 12,-21L13,23Q13,28 7,28H-7Q-13,28 -13,23Z';
 return <Svg width={44} height={68} viewBox="-22 -36 44 68" accessibilityLabel={t(`地圖車輛：${getLocalizedPlaceName(VEHICLE_BY_ID[vehicleId])}`)}>
  <Path d="M0,-35L7,-27H-7Z" fill={dark?'#6C9EFF':'#276EF1'}/><Ellipse cx={1} cy={4} rx={16} ry={27} fill="#000000" opacity={.2}/>
  {[-1,1].map(side=><React.Fragment key={side}><Rect x={side<0?-16:12} y={-17} width={4} height={10} rx={1.5} fill="#182126"/><Rect x={side<0?-16:12} y={14} width={4} height={9} rx={1.5} fill="#182126"/></React.Fragment>)}
  <Path d={silhouette} fill={body} stroke={outline} strokeWidth={1.4}/>
  {tall||crossover?<><Rect x={-11} y={-19} width={22} height={41} rx={5} fill={roof}/><Path d="M-10,-18H10L11,-9H-11Z M-11,14H11L10,22H-10Z" fill={glass}/><Line x1={-10} y1={-5} x2={-10} y2={10} stroke={glass} strokeWidth={2}/><Line x1={10} y1={-5} x2={10} y2={10} stroke={glass} strokeWidth={2}/>{!taxi&&tall&&<Line x1={-8} y1={-25} x2={8} y2={-25} stroke="#C7D0D6" strokeWidth={1.5}/>}</>:fastback?<><Path d="M-10,-14Q0,-19 10,-14L11,16Q0,22 -11,16Z" fill={roof}/><Path d="M-9,-14Q0,-18 9,-14L10,-6H-10Z M-10,10H10L10,17Q0,20 -10,17Z" fill={glass}/><Line x1={-9} y1={-3} x2={-10} y2={8} stroke={glass} strokeWidth={2}/><Line x1={9} y1={-3} x2={10} y2={8} stroke={glass} strokeWidth={2}/></>:<><Rect x={-10} y={-13} width={20} height={30} rx={4} fill={roof}/><Path d="M-9,-14H9L10,-6H-10Z M-10,11H10L9,18H-9Z" fill={glass}/><Line x1={-9} y1={-3} x2={-9} y2={8} stroke={glass} strokeWidth={2}/><Line x1={9} y1={-3} x2={9} y2={8} stroke={glass} strokeWidth={2}/></>}
  {taxi&&<Rect x={-6} y={-1} width={12} height={5} rx={1.2} fill="#F6EBCF" stroke="#B1A994" strokeWidth={.5}/>}
  <Path d="M-10,-23H-6 M6,-23H10" stroke="#FFF0CB" strokeWidth={2.5}/><Path d="M-10,24H-6 M6,24H10" stroke="#F3A1A1" strokeWidth={2}/>
 </Svg>;
});

import React from 'react';
import {Button} from './components';
import type {Palette} from './theme';

/** Remains in the measured bottom panel, above an offer that otherwise hides the status controls. */
export function OfferPlanningResume({online,planning,hasOffer,mapReady,onResume,colors}:{online:boolean;planning:boolean;hasOffer:boolean;mapReady:boolean;onResume:()=>void;colors:Palette}){
  if(online||!planning||!hasOffer||!mapReady)return null;
  return <Button testID="resume-offer-planning" title="繼續行車" colors={colors} onPress={onResume} cue={false} style={{minHeight:44,paddingVertical:10}}/>;
}

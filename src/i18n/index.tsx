import React from 'react';
import { Pressable as NativePressable,Switch as NativeSwitch,Text as NativeText,TextInput as NativeTextInput,type PressableProps,type SwitchProps,type TextProps,type TextInputProps } from 'react-native';
import { getLocalityDetails,type LocalityPoint } from '../data/localities';
import { translateForLocale } from './translate';
export { clearUntranslatedStrings, getUntranslatedStrings, normalizeSearchText, toSimplified } from './translate';
import { getLocale,useLocale,type Locale } from './store';
export { getLocale,initializeLocale,intlLocale,isLocaleReady,LOCALES,setLocale,useLocale,useLocaleReady,type Locale } from './store';

export function translateText(source:string,locale:Locale=getLocale()):string { return translateForLocale(source,locale); }
export const t=translateText;
function childrenText(children:React.ReactNode,locale:Locale):React.ReactNode {
  const items=React.Children.toArray(children);
  if(items.every(item=>typeof item==='string'||typeof item==='number'))return translateText(items.join(''),locale);
  return items.map(item=>typeof item==='string'?translateText(item,locale):item);
}
type TranslationProp={translate?:boolean};
function translatedValue(value:TextProps['accessibilityValue'],locale:Locale,enabled:boolean){return value&&enabled&&value.text?{...value,text:translateText(value.text,locale)}:value;}
export function LocalizedText({children,translate=true,...props}:TextProps&TranslationProp){
  const locale=useLocale();return <NativeText {...props} accessibilityValue={translatedValue(props.accessibilityValue,locale,translate)} accessibilityLabel={translate&&props.accessibilityLabel?translateText(props.accessibilityLabel,locale):props.accessibilityLabel} accessibilityHint={translate&&props.accessibilityHint?translateText(props.accessibilityHint,locale):props.accessibilityHint}>{translate?childrenText(children,locale):children}</NativeText>;
}
export function LocalizedPressable({translate=true,...props}:PressableProps&TranslationProp){
  const locale=useLocale();return <NativePressable {...props} accessibilityValue={translatedValue(props.accessibilityValue,locale,translate)} accessibilityLabel={translate&&props.accessibilityLabel?translateText(props.accessibilityLabel,locale):props.accessibilityLabel} accessibilityHint={translate&&props.accessibilityHint?translateText(props.accessibilityHint,locale):props.accessibilityHint}/>;
}
export function LocalizedTextInput({translate=true,...props}:TextInputProps&TranslationProp){
  const locale=useLocale();return <NativeTextInput {...props} accessibilityValue={translatedValue(props.accessibilityValue,locale,translate)} placeholder={translate&&props.placeholder?translateText(props.placeholder,locale):props.placeholder} accessibilityLabel={translate&&props.accessibilityLabel?translateText(props.accessibilityLabel,locale):props.accessibilityLabel} accessibilityHint={translate&&props.accessibilityHint?translateText(props.accessibilityHint,locale):props.accessibilityHint}/>;
}
export function LocalizedSwitch({translate=true,...props}:SwitchProps&TranslationProp){
  const locale=useLocale();return <NativeSwitch {...props} accessibilityValue={translatedValue(props.accessibilityValue,locale,translate)} accessibilityLabel={translate&&props.accessibilityLabel?translateText(props.accessibilityLabel,locale):props.accessibilityLabel} accessibilityHint={translate&&props.accessibilityHint?translateText(props.accessibilityHint,locale):props.accessibilityHint}/>;
}
export function getLocalizedPlaceName(place:{name:string;nameEn?:string}):string {
  return getLocale()==='en'&&place.nameEn?place.nameEn:translateText(place.name);
}
export function getLocalizedLocality(place:LocalityPoint,districtHint?:string):string {
  const details=getLocalityDetails(place,districtHint);
  return getLocale()==='en'&&details.nameEn?details.nameEn:translateText(details.name);
}

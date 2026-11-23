import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import type { Locale } from './types';
export type { Locale } from './types';
export const LOCALES:Array<{value:Locale;label:string}>=[
  {value:'zh-HK',label:'粵語'},{value:'zh-Hant',label:'繁體中文'},{value:'zh-Hans',label:'简体中文'},{value:'en',label:'English'},
];
const KEY='harbour-shift.locale.v1';
let locale:Locale='zh-HK',ready=false,revision=0;
let initialization:Promise<void>|undefined;
let pendingWrite:Promise<void>=Promise.resolve();
const listeners=new Set<()=>void>();
const notify=()=>{for(const listener of listeners)listener();};
const subscribe=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};};
export const getLocale=()=>locale;
export const isLocaleReady=()=>ready;
export function initializeLocale():Promise<void>{
  if(!initialization){const epoch=revision;initialization=AsyncStorage.getItem(KEY).then(value=>{
    if(epoch===revision&&LOCALES.some(item=>item.value===value))locale=value as Locale;
  }).catch(()=>{}).finally(()=>{ready=true;notify();});}
  return initialization;
}
export async function setLocale(value:Locale):Promise<void>{
  if(!LOCALES.some(item=>item.value===value))throw new Error('Unsupported language');
  const epoch=++revision;
  const write=pendingWrite.catch(()=>{}).then(()=>AsyncStorage.setItem(KEY,value));
  pendingWrite=write;await write;
  if(epoch===revision){locale=value;ready=true;notify();}
}
export function useLocale():Locale{return useSyncExternalStore(subscribe,getLocale,getLocale);}
export function useLocaleReady():boolean{return useSyncExternalStore(subscribe,isLocaleReady,isLocaleReady);}
export const intlLocale=(value:Locale=getLocale())=>value==='en'?'en-HK':value==='zh-Hans'?'zh-Hans-CN':value==='zh-Hant'?'zh-Hant-HK':'zh-HK';

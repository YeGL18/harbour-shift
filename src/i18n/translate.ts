import zh from './zh.json';
import templates from './zh-templates.json';
import simplifiedCharacters from './hans-characters.json';
import { translateEnglish } from './en';
import type { Locale } from './types';

const strings=zh as Record<string,{'zh-Hant':string;'zh-Hans':string}>;
const characterMap=simplifiedCharacters as Record<string,string>;
const escapeRegex=(value:string)=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
/** Placeholders correspond to complete values, never executable formatting code. */
export function compileTranslationTemplate(source:string):RegExp {
  return new RegExp('^'+source.split(/\$\{\d+\}/u).map(escapeRegex).join('(.*?)')+'$','su');
}
const patterns=templates.map(entry=>({...entry,pattern:compileTranslationTemplate(entry.source)}))
  .sort((a,b)=>b.source.replace(/\$\{\d+\}/gu,'').length-a.source.replace(/\$\{\d+\}/gu,'').length);
const untranslated=new Set<string>();
const cache=new Map<string,string>();
export const getUntranslatedStrings=()=>[...untranslated];
export const clearUntranslatedStrings=()=>{untranslated.clear();cache.clear();};
export function toSimplified(value:string):string {
  return [...value].map(character=>characterMap[character]??character).join('');
}
export function normalizeSearchText(value:string):string {
  return toSimplified(value.normalize('NFKC')).toLowerCase().replace(/\s/gu,'');
}
/** Pure translator; callers supply a locale so server code and tests need no native runtime. */
export function translateForLocale(source:string,locale:Locale,depth=0):string {
  if(depth>0)return translateValue(source,locale,depth);
  const key=locale+'\0'+source,cached=cache.get(key);
  if(cached!==undefined)return cached;
  const value=translateValue(source,locale,depth);
  if(cache.size>=4096)cache.delete(cache.keys().next().value!);
  cache.set(key,value);return value;
}
function translateValue(source:string,locale:Locale,depth:number):string {
  if(locale==='zh-HK'||!source||depth>8)return source;
  if(locale==='en') {
    const english=translateEnglish(source);
    if(english!==undefined)return english;
  } else {
    const exact=strings[source]?.[locale];
    if(exact!==undefined)return exact;
    for(const entry of patterns){
      const match=source.match(entry.pattern);
      if(match)return entry[locale].replace(/\$\{(\d+)\}/gu,(_,index:string)=>translateForLocale(match[Number(index)+1]??'',locale,depth+1));
    }
  }
  const trimmed=source.trim();
  if(trimmed&&trimmed!==source) {
    const translated=translateForLocale(trimmed,locale,depth+1);
    if(translated!==trimmed)return source.slice(0,source.indexOf(trimmed))+translated+source.slice(source.indexOf(trimmed)+trimmed.length);
  }
  if(untranslated.size<2000&&/[\u3400-\u9fff]/u.test(source))untranslated.add(source);
  // Names without an official English source retain their original form.
  return locale==='zh-Hans'?toSimplified(source):source;
}

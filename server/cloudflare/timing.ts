import type {D1Database,D1Statement,D1Result} from './store';
export interface RequestTiming {d1Calls:number;d1Milliseconds:number;sqlMilliseconds:number;d1Attempts:number;dbRegions:Set<string>;gzipMilliseconds:number;phases:Record<string,number>}
export function newTiming():RequestTiming{return{d1Calls:0,d1Milliseconds:0,sqlMilliseconds:0,d1Attempts:0,dbRegions:new Set(),gzipMilliseconds:0,phases:{}};}
export async function timed<T>(timing:RequestTiming,name:string,operation:()=>Promise<T>):Promise<T>{const started=performance.now();try{return await operation();}finally{timing.phases[name]=(timing.phases[name]||0)+performance.now()-started;}}
/** Wall-time diagnostics only; no SQL, room codes, bodies or credentials. */
export function traceDatabase(db:D1Database,timing:RequestTiming):D1Database{
 const originals=new WeakMap<D1Statement,D1Statement>();
 const record=(value:unknown):void=>{if(Array.isArray(value)){for(const entry of value)record(entry);return;}const meta=(value as D1Result|undefined)?.meta;if(!meta)return;timing.sqlMilliseconds+=meta.timings?.sql_duration_ms??meta.duration??0;timing.d1Attempts+=meta.total_attempts??1;if(meta.served_by_region&&/^[A-Z0-9-]{1,20}$/.test(meta.served_by_region))timing.dbRegions.add(meta.served_by_region);};
 const run=async<T>(operation:()=>Promise<T>):Promise<T>=>{timing.d1Calls++;const started=performance.now();try{const result=await operation();record(result);return result;}finally{timing.d1Milliseconds+=performance.now()-started;}};
 // All current first() queries are bounded by a primary key or LIMIT 1.
 // all() preserves their D1 execution metadata without another round trip.
 const wrap=(statement:D1Statement):D1Statement=>{const wrapped:D1Statement={bind(...values){return wrap(statement.bind(...values));},first<T>(){return run(()=>statement.all<T>()).then(result=>result.results?.[0]??null);},all<T>(){return run(()=>statement.all<T>());},run(){return run(()=>statement.run());}};originals.set(wrapped,statement);return wrapped;};
 return{prepare(sql){return wrap(db.prepare(sql));},batch<T>(statements:D1Statement[]){return run(()=>db.batch<T>(statements.map(statement=>originals.get(statement)||statement)));}};
}
export function timingHeader(timing:RequestTiming):string{return[`d1;dur=${timing.d1Milliseconds.toFixed(1)}`,`sql;dur=${timing.sqlMilliseconds.toFixed(2)}`,`d1calls;dur=${timing.d1Calls}`,`dbattempts;dur=${timing.d1Attempts}`,...(timing.dbRegions.size?[`dbregion;desc="${[...timing.dbRegions].join('|')}"`]:[]),`gzip;dur=${timing.gzipMilliseconds.toFixed(1)}`,...Object.entries(timing.phases).map(([name,value])=>`${name};dur=${value.toFixed(1)}`)].join(', ');}

/** Keep a brief publisher collision inside one HTTP request, avoiding another WAN round trip. */
export async function acquireActionLease<T>(attempt:()=>Promise<T|null>,options:{now?:()=>number;sleep?:(milliseconds:number)=>Promise<void>;maximumWaitMilliseconds?:number}={}):Promise<T|null>{
 const now=options.now||Date.now,sleep=options.sleep||(milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds)));
 const deadline=now()+(options.maximumWaitMilliseconds??750);
 for(let count=0;count<8;count++){
  if(count&&now()>=deadline)return null;
  const lease=await attempt();if(lease)return lease;
  const remaining=deadline-now();if(remaining<=0||count===7)return null;
  await sleep(Math.min(50,remaining));
 }
 return null;
}

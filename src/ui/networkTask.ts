export type NetworkTaskResult<T=unknown>={ok:true;value:T}|{ok:false;reason:'busy'|'unmounted'|'error';error?:unknown};
export interface NetworkTaskCallbacks {busy:(key:string|null)=>void;error:(message:string|null)=>void}
/** A mounted screen owns its callbacks; a finished request may outlive it. */
export function createNetworkTaskRunner(callbacks:NetworkTaskCallbacks){
  let mounted=true,inFlight=false;
  return {
    mount(){mounted=true;},dispose(){mounted=false;},isMounted:()=>mounted,isBusy:()=>inFlight,
    async run<T>(key:string,action:()=>Promise<T>,after?:()=>void):Promise<NetworkTaskResult<T>>{
      if(!mounted)return{ok:false,reason:'unmounted'};
      if(inFlight)return{ok:false,reason:'busy'};
      inFlight=true;callbacks.busy(key);callbacks.error(null);
      try{const value=await action();if(mounted)after?.();return{ok:true,value};}
      catch(error){if(mounted)callbacks.error(error instanceof Error?error.message:'操作未完成，請重試。');return{ok:false,reason:'error',error};}
      finally{inFlight=false;if(mounted)callbacks.busy(null);}
    },
  };
}

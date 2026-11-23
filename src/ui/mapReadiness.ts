export type MapLoadStatus='loading'|'ready'|'error';
export interface MapReadiness {session:string;instance:string;status:MapLoadStatus}
/** Only the currently mounted map may release the clock. */
export function reportMapReadiness(current:MapReadiness|null,session:string,instance:string,status:MapLoadStatus):MapReadiness|null {
  if(!current||current.session!==session||current.instance!==instance||current.status==='error'&&status!=='error')return current;
  return current.status===status?current:{...current,status};
}
export const isCurrentMapReady=(current:MapReadiness|null,session:string)=>current?.session===session&&current.status==='ready';
export function soloMayRun(input:{online:boolean;paused:boolean;planning:boolean;foreground:boolean;visible:boolean;mapReady:boolean;startupPending:boolean}) {
  return !input.online&&!input.paused&&!input.planning&&input.foreground&&input.visible&&input.mapReady&&!input.startupPending;
}

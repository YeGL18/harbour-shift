export function seededRandom(seed:number,index:number,salt=0):number {
  let value=(seed^Math.imul(index+1,0x9e3779b1)^Math.imul(salt+1,0x85ebca6b))|0;
  value=Math.imul(value^(value>>>16),0x7feb352d);value=Math.imul(value^(value>>>15),0x846ca68b);
  return((value^(value>>>16))>>>0)/4294967296;
}
export function stringHash(value:string):number {let result=2166136261;for(let index=0;index<value.length;index++)result=Math.imul(result^value.charCodeAt(index),16777619);return result|0;}

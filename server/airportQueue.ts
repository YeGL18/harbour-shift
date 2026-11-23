import type {GameState} from '../src/game/types';
import {getVehicleGraph} from '../src/game/access';
import {leaveAirportQueue} from '../src/game/engine';
import {airportQueueOrder,airportQueueStillEligible,airportRoomView} from '../src/game/airport';
import type {DispatchDriver} from './dispatch';
import type {SharedAirportTicket} from '../shared/airport';
export type {SharedAirportTicket} from '../shared/airport';

/** Room authority is the sole sequence allocator; clients never supply priority or ordinal. */
export function coordinateAirportQueues(drivers:DispatchDriver[],existing:readonly SharedAirportTicket[]=[],nextSequence=0,clock=0){
 const games=new Map<string,GameState>(drivers.map(d=>[d.id,d.game]));
 const active=new Map<string,DispatchDriver>();
 for(const driver of drivers){const state=driver.game;if(!state.airportQueue)continue;
  if(driver.left||driver.forfeited||!airportQueueStillEligible(state,getVehicleGraph(state.vehicleId))){games.set(driver.id,state.phase==='airport-queue'?leaveAirportQueue(state):{...state,airportQueue:null});continue;}
  active.set(state.airportQueue.id,driver);
 }
 const seen=new Set<string>();
 const tickets=existing.filter(t=>{if(active.get(t.id)?.id!==t.playerId||!Number.isSafeInteger(t.sequence)||t.sequence<=0||seen.has(t.id))return false;seen.add(t.id);return true;}).slice(0,8).map(t=>({...t,pool:active.get(t.id)!.game.airportQueue!.pool,priority:active.get(t.id)!.game.proTier==='diamond'}));
 let sequence=Math.max(Number.isSafeInteger(nextSequence)&&nextSequence>=0?nextSequence:0,0,...tickets.map(t=>t.sequence));
 const known=new Set(tickets.map(t=>t.id));
 const arrivals=[...active.values()].filter(d=>!known.has(d.game.airportQueue!.id)).sort((a,b)=>a.game.airportQueue!.joinedAt-b.game.airportQueue!.joinedAt||a.id.localeCompare(b.id));
 for(const driver of arrivals){const queue=driver.game.airportQueue!;tickets.push({...queue,playerId:driver.id,sequence:++sequence,priority:driver.game.proTier==='diamond',assignmentPending:false});}
 const ordered=[...tickets].sort(airportQueueOrder);
 for(const record of ordered){const driver=active.get(record.id)!;const pool=ordered.filter(t=>t.pool===record.pool);const position=pool.findIndex(t=>t.id===record.id)+1;const {playerId,...own}=record;
  games.set(driver.id,{...games.get(driver.id)!,airportQueue:{...own,position,ahead:position-1,total:pool.length,assignmentPending:false}});
 }
 const reference=drivers[0]?.game;
 return{tickets:ordered,nextSequence:sequence,games,view:airportRoomView(ordered,reference?.seed??0,clock,reference?.startTimeMinutes??300)};
}

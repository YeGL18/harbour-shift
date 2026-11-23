import type { WorldEvent } from '../src/game/types';
import type { RoomWorldEvent } from './protocol';

/** Simulation events, not a claim that a real-world event is taking place today.
 * The fixed anchors are existing, road-snapped entries in the bundled HK catalog.
 * No catalog scan or wall clock is needed to reproduce a room's schedule. */
/** Existing official building records stand for broad estate areas in the
 * simulation. Their names are display aliases, not resident demographics. */
export const WORLD_EVENT_RESIDENTIAL_ANCHORS = [
  {id:'building-1108241290',name:'擎天半島一帶',en:'Sorrento area',lat:22.3067489,lon:114.1615188},
  {id:'building-1108241439',name:'黃埔花園一帶',en:'Whampoa Garden area',lat:22.3065352,lon:114.1901835},
  {id:'building-1102444542',name:'沙田第一城一帶',en:'City One Shatin area',lat:22.3887444,lon:114.2030398},
  {id:'building-1101781191',name:'將軍澳中心一帶',en:'Park Central area',lat:22.307627,lon:114.2575688},
  {id:'building-1108225461',name:'碧海藍天一帶',en:'Aqua Marine area',lat:22.3328764,lon:114.1491212},
  {id:'building-1103123646',name:'康怡花園一帶',en:'Kornhill area',lat:22.2844034,lon:114.2151949},
] as const;
const ANCHORS = [
  { id:'megabox', name:'MegaBox', en:'MegaBox', lat:22.3198434, lon:114.2081645 },
  { id:'elements', name:'圓方', en:'Elements', lat:22.3046641, lon:114.1619166 },
  { id:'harbour-city', name:'海港城', en:'Harbour City', lat:22.2960669, lon:114.1687537 },
  { id:'olympian', name:'奧海城一期', en:'Olympian City One', lat:22.3191534, lon:114.1584172 },
  { id:'west-kowloon', name:'西九龍站', en:'West Kowloon Station', lat:22.3081366, lon:114.1644219 },
  ...WORLD_EVENT_RESIDENTIAL_ANCHORS,
] as const;

function random(seed:number):()=>number {
  let value=(seed>>>0)^0x65766e74;
  return ()=>{value=(value+0x6d2b79f5)|0;let n=Math.imul(value^(value>>>15),1|value);n^=n+Math.imul(n^(n>>>7),61|n);return((n^(n>>>14))>>>0)/4294967296;};
}

const EVENT_WINDOWS = [
  {from: 6*60+30, until: 10*60+30, title: '通勤人潮', titleEn: 'commuter rush', anchors: [5, 6, 7, 8, 9, 10]},
  {from: 11*60, until: 19*60+15, title: '商場人潮', titleEn: 'shopping rush', anchors: [0, 1, 2, 3]},
  {from: 19*60+30, until: 23*60+45, title: '散場人潮', titleEn: 'evening pickup rush', anchors: [0, 1, 2]},
] as const;

export function getWorldEventSchedule(seed: number, duration: 360|720|1440 = 720, startTimeMinutes = 300): WorldEvent[] {
  const rng = random(seed);
  const shiftStart = ((startTimeMinutes % 1440) + 1440) % 1440;
  const schedule: WorldEvent[] = [];
  for (let index = 0; index < duration / 180; index++) {
    const slotStart = shiftStart + index*180;
    const slotEnd = slotStart + 180;
    const preferred = slotStart + 50 + Math.floor(rng()*31);
    const length = 25 + Math.floor(rng()*16);
    const venueRoll = rng();
    const radiusM = 1400 + Math.floor(rng()*601);
    const demandBoost = 1.7 + Math.round(rng()*7)/10;
    const candidates = [];
    for (let day = Math.floor(slotStart/1440); day <= Math.floor(slotEnd/1440); day++) {
      for (const window of EVENT_WINDOWS) {
        const earliest = Math.max(slotStart, day*1440 + window.from);
        const latest = Math.min(slotEnd, day*1440 + window.until) - length;
        if (latest < earliest) continue;
        const minute = Math.max(earliest, Math.min(latest, preferred));
        candidates.push({window, minute});
      }
    }
    candidates.sort((a,b) => Math.abs(a.minute-preferred) - Math.abs(b.minute-preferred) || a.minute-b.minute);
    const selected = candidates[0];
    if (!selected) continue;
    const {window, minute} = selected;
    const anchor = ANCHORS[window.anchors[Math.floor(venueRoll*window.anchors.length)]];
    const startsAt = minute - shiftStart;
    schedule.push({id: `world-${seed>>>0}-${duration}-${index}`, title: `${anchor.name}${window.title}`, titleEn: `${anchor.en} ${window.titleEn}`, pickupPlaceId: anchor.id, center: {lat: anchor.lat, lon: anchor.lon}, radiusM, startsAt, endsAt: startsAt + length, demandBoost});
  }
  return schedule;
}

export function getWorldEventAt(seed: number, clockMinutes: number, duration: 360|720|1440 = 720, startTimeMinutes = 300): WorldEvent|undefined {
  return getWorldEventSchedule(seed, duration, startTimeMinutes).find(event => clockMinutes >= event.startsAt && clockMinutes < event.endsAt);
}

export function getWorldEventForecast(seed: number, clockMinutes: number, duration: 360|720|1440 = 720, lookaheadMinutes = 60, startTimeMinutes = 300): WorldEvent|undefined {
  return getWorldEventSchedule(seed, duration, startTimeMinutes).find(event => event.startsAt > clockMinutes && event.startsAt <= clockMinutes + Math.max(0, lookaheadMinutes));
}

export function getWorldEventViews(seed: number, clockMinutes: number, duration: 360|720|1440 = 720, startTimeMinutes = 300): RoomWorldEvent[] {
  const schedule = getWorldEventSchedule(seed, duration, startTimeMinutes);
  const active = schedule.find(event => clockMinutes >= event.startsAt && clockMinutes < event.endsAt);
  const next = schedule.find(event => event.startsAt > clockMinutes && event.startsAt <= clockMinutes + 60);
  return [...(active ? [{...active, status: 'active' as const}] : []), ...(next ? [{...next, status: 'forecast' as const}] : [])];
}

import type {DriverCredential,DriverProfile,DriverSession,DriverCounters} from '../../shared/protocol';
import {driverStats} from '../driverStats';
import {fail,keys,object,randomToken,tokenHash} from '../validation';
import type {D1Database,D1Statement} from './store';
interface Row {id:string;offered:number;accepted:number;cancelled:number;completed_trips:number;updated_at:number;review_id?:string;review_started?:number;review_offered?:number;review_accepted?:number;review_cancelled?:number;review_completed?:number;elite_assessment?:string;elite_version?:string;elite_at?:number}
export interface DriverDelta {driverId:string;counters:DriverCounters}
function profile(row:Row):DriverProfile{return{driverId:row.id,...(row.elite_assessment?{eliteCertification:{assessmentId:row.elite_assessment,courseVersion:row.elite_version!,certifiedAt:row.elite_at!}}:{}),stats:{...driverStats({offered:row.offered,accepted:row.accepted,cancelled:row.cancelled,completedTrips:row.completed_trips},row.updated_at),...(row.review_id?{reviewBaseline:{periodId:row.review_id,startedAt:row.review_started!,counters:{offered:row.review_offered!,accepted:row.review_accepted!,cancelled:row.review_cancelled!,completedTrips:row.review_completed!}}}:{})}};}
const ELITE_COLUMNS=',e.assessment_id AS elite_assessment,e.course_version AS elite_version,e.certified_at AS elite_at';
const ELITE_JOIN=' LEFT JOIN driver_elite_certifications e ON e.driver_id=a.id';
const BASE_SELECT='SELECT a.id,a.offered,a.accepted,a.cancelled,a.completed_trips,a.updated_at FROM driver_accounts a';
const REVIEW_SELECT='SELECT a.id,a.offered,a.accepted,a.cancelled,a.completed_trips,a.updated_at,p.assessment_id AS review_id,p.started_at AS review_started,p.offered AS review_offered,p.accepted AS review_accepted,p.cancelled AS review_cancelled,p.completed_trips AS review_completed FROM driver_accounts a LEFT JOIN driver_review_periods p ON p.assessment_id=(SELECT assessment_id FROM driver_review_periods WHERE driver_id=a.id ORDER BY started_at DESC,rowid DESC LIMIT 1)';
export class DriverStore {
 constructor(private db:D1Database,private now:()=>number=Date.now){}
 private async rows(filter:string,values:unknown[]):Promise<Row[]>{
   let review=true,elite=true;
   for(;;){
     const select=review?REVIEW_SELECT:BASE_SELECT;
     const sql=elite?select.replace(' FROM driver_accounts',ELITE_COLUMNS+' FROM driver_accounts')+ELITE_JOIN:select;
     try{return (await this.db.prepare(sql+' WHERE '+filter).bind(...values).all<Row>()).results||[];}
     catch(error){
       if(!(error instanceof Error))throw error;
       if(review&&/no such table: (?:main\.)?driver_review_periods\b/i.test(error.message)){review=false;continue;}
       if(elite&&/no such table: (?:main\.)?driver_elite_certifications\b/i.test(error.message)){elite=false;continue;}
       throw error;
     }
   }
 }
 async create(input:unknown):Promise<DriverSession>{keys(object(input),[]);const id=crypto.randomUUID(),token=randomToken(),now=this.now();await this.db.prepare('INSERT INTO driver_accounts(id,token_hash,offered,accepted,cancelled,completed_trips,created_at,updated_at) VALUES(?,?,0,0,0,0,?,?)').bind(id,await tokenHash(token),now,now).run();return{driverId:id,driverToken:token,stats:driverStats(undefined,now)};}
 async authenticate(input:unknown):Promise<DriverProfile>{const credential=object(input);keys(credential,['driverId','driverToken']);if(typeof credential.driverId!=='string'||credential.driverId.length>64||typeof credential.driverToken!=='string')fail('unauthorized','重連憑證無效。',401);const row=(await this.rows('a.id=? AND a.token_hash=?',[credential.driverId,await tokenHash(credential.driverToken)]))[0];if(!row)fail('unauthorized','重連憑證無效。',401);return profile(row);}
 async me(token:string):Promise<DriverProfile>{const row=(await this.rows('a.token_hash=?',[await tokenHash(token)]))[0];if(!row)fail('unauthorized','重連憑證無效。',401);return profile(row);}
 async histories(ids:string[]):Promise<DriverProfile[]>{if(!ids.length)return[];const unique=[...new Set(ids)].slice(0,8);const rows=await this.rows(`a.id IN (${unique.map(()=>'?').join(',')})`,unique);return rows.map(profile);}
 /** Exactly-once deltas share the room's atomic publication transaction. */
 deltaStatements(code:string,generation:string,version:number,deltas:DriverDelta[]):D1Statement[]{const statements:D1Statement[]=[];for(const delta of deltas){const c=delta.counters;if(!Object.values(c).some(value=>value>0))continue;const event=`${generation}:${delta.driverId}`;statements.push(this.db.prepare(`INSERT OR IGNORE INTO driver_stat_events(event_id,room_code,driver_id,offered,accepted,cancelled,completed_trips,applied)
  SELECT ?,?,?,?,?,?,?,0 WHERE EXISTS(SELECT 1 FROM rooms WHERE code=? AND generation=? AND version=?)`).bind(event,code,delta.driverId,c.offered,c.accepted,c.cancelled,c.completedTrips,code,generation,version));
 statements.push(this.db.prepare(`UPDATE driver_accounts SET offered=offered+(SELECT offered FROM driver_stat_events WHERE event_id=?),accepted=accepted+(SELECT accepted FROM driver_stat_events WHERE event_id=?),cancelled=cancelled+(SELECT cancelled FROM driver_stat_events WHERE event_id=?),completed_trips=completed_trips+(SELECT completed_trips FROM driver_stat_events WHERE event_id=?),updated_at=? WHERE id=? AND EXISTS(SELECT 1 FROM driver_stat_events WHERE event_id=? AND applied=0)`).bind(event,event,event,event,this.now(),delta.driverId,event));
 statements.push(this.db.prepare('UPDATE driver_stat_events SET applied=1 WHERE event_id=? AND applied=0').bind(event));}return statements;}
}

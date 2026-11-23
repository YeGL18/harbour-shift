import {gradeResetAnswers,RESET_COURSE_VERSION} from '../../shared/trainingCourse';
import {TRAINING_API,reviewCounts,reviewPeriod,type TrainingAttempt,type TrainingConfirmation,type TrainingStatus} from '../../shared/training';
import type {DriverCounters} from '../../shared/protocol';
import {DriverStore} from './drivers';
import type {D1Database} from './store';
import {fail,keys,object} from '../validation';

interface AttemptRow {id:string;driver_id:string;course_version:string;created_at:number;submitted_at:number|null;answers:string|null;score:number|null;passed:number}
interface PeriodRow {assessment_id:string;started_at:number;offered:number;accepted:number;cancelled:number;completed_trips:number}
const count=(row:PeriodRow):DriverCounters=>({offered:row.offered,accepted:row.accepted,cancelled:row.cancelled,completedTrips:row.completed_trips});
// Check authoritative committed participant state, including another device or
// another room. Driver counter publication is in the same SQLite transaction.
const ACTIVE_MATCH=`SELECT 1 FROM rooms r,json_each(json_extract(r.metadata,'$.authority'),'$.players') p WHERE r.expires_at>? AND json_extract(json_extract(r.metadata,'$.authority'),'$.room.status') IN ('countdown','running') AND json_extract(p.value,'$.driverId')=? AND COALESCE(json_extract(p.value,'$.left'),0)=0 AND COALESCE(json_extract(p.value,'$.forfeited'),0)=0 AND json_extract(p.value,'$.finishedAt') IS NULL`;
const identity=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,160}$/.test(value);
function attempt(row:AttemptRow):TrainingAttempt {return{assessmentId:row.id,courseVersion:row.course_version,createdAt:row.created_at,...(row.submitted_at===null?{}:{submittedAt:row.submitted_at,score:row.score!,passed:row.passed===1,correct:gradeResetAnswers(row.course_version,JSON.parse(row.answers!)).correct})};}

export class TrainingStore {
  constructor(private db:D1Database,private now:()=>number=Date.now){}
  private async periods(driverId:string):Promise<PeriodRow[]>{return(await this.db.prepare('SELECT assessment_id,started_at,offered,accepted,cancelled,completed_trips FROM driver_review_periods WHERE driver_id=? ORDER BY started_at ASC,rowid ASC').bind(driverId).all<PeriodRow>()).results||[];}
  async status(token:string):Promise<TrainingStatus>{
    const profile=await new DriverStore(this.db,this.now).me(token),periods=await this.periods(profile.driverId),latest=periods.at(-1);
    const initial:PeriodRow={assessment_id:'lifetime',started_at:0,offered:0,accepted:0,cancelled:0,completed_trips:0};
    const history=[initial,...periods].slice(0,-1).map((period,index)=>reviewPeriod(period.assessment_id,period.started_at,reviewCounts(count(periods[index]),count(period)),periods[index].started_at));
    const active=await this.db.prepare(ACTIVE_MATCH+' LIMIT 1').bind(this.now(),profile.driverId).first();
    return{courseVersion:RESET_COURSE_VERSION,lifetime:{offered:profile.stats.offered,accepted:profile.stats.accepted,cancelled:profile.stats.cancelled,completedTrips:profile.stats.completedTrips},activePeriod:reviewPeriod(latest?.assessment_id||'lifetime',latest?.started_at||0,reviewCounts(profile.stats,latest?count(latest):undefined)),history,canReset:!active};
  }
  async start(token:string,input:unknown):Promise<TrainingAttempt>{
    const body=object(input);keys(body,['courseVersion']);if(body.courseVersion!==RESET_COURSE_VERSION)fail('training_version','課程已更新，請重新開始。',409);
    const profile=await new DriverStore(this.db,this.now).me(token),id=crypto.randomUUID(),now=this.now();
    await this.db.prepare('INSERT INTO driver_training_attempts(id,driver_id,course_version,created_at) VALUES(?,?,?,?)').bind(id,profile.driverId,RESET_COURSE_VERSION,now).run();
    return{assessmentId:id,courseVersion:RESET_COURSE_VERSION,createdAt:now};
  }
  private async owned(token:string,id:unknown):Promise<AttemptRow>{
    const profile=await new DriverStore(this.db,this.now).me(token);if(!identity(id))fail('invalid_training','答題資料無效。');
    const row=await this.db.prepare('SELECT * FROM driver_training_attempts WHERE id=? AND driver_id=?').bind(id,profile.driverId).first<AttemptRow>();if(!row)fail('training_not_found','找不到這次學習紀錄。',404);return row;
  }
  async submit(token:string,input:unknown):Promise<TrainingAttempt>{
    const body=object(input);keys(body,['assessmentId','answers']);const row=await this.owned(token,body.assessmentId);
    let grade;try{grade=gradeResetAnswers(row.course_version,body.answers);}catch{fail('invalid_training','答題資料無效。');}
    const answers=JSON.stringify(body.answers);
    if(row.submitted_at!==null){if(row.answers!==answers)fail('training_submitted','這次答題已提交，請重新開始。',409);return attempt(row);}
    await this.db.prepare('UPDATE driver_training_attempts SET submitted_at=?,answers=?,score=?,passed=? WHERE id=? AND driver_id=? AND submitted_at IS NULL').bind(this.now(),answers,grade!.score,grade!.passed?1:0,row.id,row.driver_id).run();
    const saved=await this.owned(token,row.id);if(saved.answers!==answers)fail('training_submitted','這次答題已提交，請重新開始。',409);return attempt(saved);
  }
  async confirm(token:string,input:unknown):Promise<TrainingConfirmation>{
    const body=object(input);keys(body,['assessmentId','expectedPeriodId','confirm']);if(body.confirm!==true||!identity(body.expectedPeriodId))fail('invalid_training','請先確認開新觀察期。');
    const row=await this.owned(token,body.assessmentId);
    const existing=await this.db.prepare('SELECT assessment_id FROM driver_review_periods WHERE assessment_id=? AND driver_id=?').bind(row.id,row.driver_id).first();
    if(existing)return{appliedPeriodId:row.id,alreadyApplied:true,status:await this.status(token)};
    if(row.submitted_at===null||row.passed!==1)fail('training_not_passed','請先完成並通過課程。',409);
    // Single INSERT snapshots all counters atomically. The same assessment can
    // apply once, and concurrent confirmations cannot replace a newer period.
    const inserted=await this.db.prepare(`INSERT OR IGNORE INTO driver_review_periods(assessment_id,driver_id,started_at,offered,accepted,cancelled,completed_trips)
      SELECT ?,a.id,?,a.offered,a.accepted,a.cancelled,a.completed_trips FROM driver_accounts a WHERE a.id=?
      AND NOT EXISTS(${ACTIVE_MATCH})
      AND COALESCE((SELECT assessment_id FROM driver_review_periods WHERE driver_id=a.id ORDER BY started_at DESC,rowid DESC LIMIT 1),'lifetime')=?`).bind(row.id,this.now(),row.driver_id,this.now(),row.driver_id,body.expectedPeriodId).run();
    if(!inserted.meta?.changes){
      const concurrent=await this.db.prepare('SELECT assessment_id FROM driver_review_periods WHERE assessment_id=? AND driver_id=?').bind(row.id,row.driver_id).first();
      if(concurrent)return{appliedPeriodId:row.id,alreadyApplied:true,status:await this.status(token)};
      if(await this.db.prepare(ACTIVE_MATCH+' LIMIT 1').bind(this.now(),row.driver_id).first())fail('training_active_match','請先完成本更並離開房間。',409);
      fail('training_period_changed','觀察期已更新，請重新確認。',409);
    }
    return{appliedPeriodId:row.id,alreadyApplied:false,status:await this.status(token)};
  }
  async handle(path:string,method:string,token:string,input?:unknown):Promise<unknown>{
    try{
      if(path===TRAINING_API.status&&method==='GET')return await this.status(token);
      if(path===TRAINING_API.start&&method==='POST')return await this.start(token,input);
      if(path===TRAINING_API.submit&&method==='POST')return await this.submit(token,input);
      if(path===TRAINING_API.confirm&&method==='POST')return await this.confirm(token,input);
      fail('not_found','找不到此 API',404);
    }catch(error){if(error instanceof Error&&/no such table: (?:main\.)?driver_(?:training_attempts|review_periods)/i.test(error.message))fail('training_unavailable','線上課程暫未開放。',503);throw error;}
  }
}

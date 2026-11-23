import React,{useEffect,useLayoutEffect,useRef,useState} from 'react';
import {ScrollView,View} from 'react-native';
import {usePreventRemove} from '@react-navigation/native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {LocalizedText as Text,LocalizedPressable as Pressable,toSimplified,useLocale} from '../i18n';
import {useGame} from '../GameProvider';
import {useMultiplayer} from '../MultiplayerProvider';
import {MultiplayerError,request} from '../multiplayer/transport';
import {MULTIPLAYER_BASE_URL} from '../multiplayer/config';
import {RESET_COURSE_VERSION,RESET_QUESTIONS,gradeResetAnswers,type LessonCopy} from '../../shared/trainingCourse';
import {TRAINING_API,type TrainingAttempt,type TrainingConfirmation,type TrainingStatus} from '../../shared/training';
import type {DriverCredential} from '../../shared/protocol';
import type {RootStackParamList} from '../navigation';
import {Button,Icon} from './components';

export function TrainingScreen({navigation}:NativeStackScreenProps<RootStackParamList,'Training'>){
  const locale=useLocale(),controller=useGame(),mp=useMultiplayer(),{colors:c}=controller,insets=useSafeAreaInsets();
  const [mode,setMode]=useState<'solo'|'online'>('solo'),[phase,setPhase]=useState<'intro'|'quiz'|'result'|'confirm'|'done'>('intro');
  const [status,setStatus]=useState<TrainingStatus|null>(null),[attempt,setAttempt]=useState<TrainingAttempt|null>(null),[answers,setAnswers]=useState<number[]>([]),[index,setIndex]=useState(0),[busy,setBusy]=useState(''),[error,setError]=useState(''),[unavailable,setUnavailable]=useState(false);
  const account=useRef<DriverCredential|null>(null);
  const copy=(value:LessonCopy)=>locale==='en'?value.en:locale==='zh-HK'?value.hk:locale==='zh-Hans'?toSimplified(value.zh):value.zh;
  const current=mode==='solo'?mp.soloReview.activePeriod:status?.activePeriod;
  const history=mode==='solo'?mp.soloReview.history:status?.history??[];
  const [historyCount,setHistoryCount]=useState(3);
  const mayConfirm=controller.canResetTraining&&(mode==='solo'||status?.canReset===true);
  usePreventRemove(busy==='confirm',()=>{});
  useLayoutEffect(()=>navigation.setOptions({headerRight:()=> <Pressable accessibilityRole="button" disabled={busy==='confirm'} onPress={()=>navigation.goBack()} style={{minWidth:44,minHeight:44,justifyContent:'center'}}><Text style={{color:c.text,fontSize:17}}>關閉</Text></Pressable>}),[navigation,c,busy]);
  const call=async<T,>(path:string,body?:unknown):Promise<T>=>{account.current=account.current??await mp.ensureTrainingAccount();return request<T>(MULTIPLAYER_BASE_URL,path,body,account.current.driverToken);};
  const fail=(cause:unknown)=>{const missing=cause instanceof MultiplayerError&&(cause.code==='training_unavailable'||cause.status===404);setUnavailable(missing);setError(missing?'線上課程暫未開放。':cause instanceof Error?cause.message:'未能完成操作，請重試。');};
  const load=async()=>{setBusy('load');setError('');try{setStatus(await call<TrainingStatus>(TRAINING_API.status));setUnavailable(false);}catch(cause){fail(cause);}finally{setBusy('');}};
  useEffect(()=>{if(mode==='online')void load();},[mode]);
  const begin=async()=>{setBusy('start');setError('');try{
    const value=mode==='solo'?{assessmentId:`solo:${Date.now()}:${Math.random().toString(36).slice(2)}`,courseVersion:RESET_COURSE_VERSION,createdAt:Date.now()}:await call<TrainingAttempt>(TRAINING_API.start,{courseVersion:RESET_COURSE_VERSION});
    setAttempt(value);setAnswers(Array(RESET_QUESTIONS.length).fill(-1));setIndex(0);setPhase('quiz');
  }catch(cause){fail(cause);}finally{setBusy('');}};
  const submit=async()=>{if(!attempt)return;setBusy('submit');setError('');try{
    const value=mode==='solo'?{...attempt,...gradeResetAnswers(attempt.courseVersion,answers),submittedAt:Date.now()}:await call<TrainingAttempt>(TRAINING_API.submit,{assessmentId:attempt.assessmentId,answers});
    setAttempt(value);setPhase('result');
  }catch(cause){fail(cause);}finally{setBusy('');}};
  const confirm=async()=>{if(!attempt||!mayConfirm||!attempt.passed)return;setBusy('confirm');setError('');try{
    if(mode==='solo')await controller.resetSoloTraining({assessmentId:attempt.assessmentId,courseVersion:attempt.courseVersion,answers});
    else{const response=await call<TrainingConfirmation>(TRAINING_API.confirm,{assessmentId:attempt.assessmentId,expectedPeriodId:status!.activePeriod.periodId,confirm:true});setStatus(response.status);await mp.refreshDriver();}
    setPhase('done');
  }catch(cause){fail(cause);if(cause instanceof MultiplayerError&&cause.code==='training_period_changed'){try{setStatus(await call<TrainingStatus>(TRAINING_API.status));}catch{/* Keep the explicit retry/error state. */}}}finally{setBusy('');}};
  const rate=(value:number|null|undefined)=>value==null?'—':`${Math.round(value*100)}%`;
  const question=RESET_QUESTIONS[index];
  return <View style={{flex:1,backgroundColor:c.background}}>
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{padding:20,gap:18,paddingBottom:24}}>
      <Text style={{color:c.text,fontSize:25,fontWeight:'700'}}>學習以重置</Text>
      {phase==='intro'?<>
        <Text style={{color:c.secondary,fontSize:15,lineHeight:23}}>自願學習，十題答對八題後，再由你確認開新觀察期。毋須付費或指定更次。</Text>
        <View accessibilityRole="radiogroup" style={{flexDirection:'row',padding:4,borderRadius:12,backgroundColor:c.muted}}>{(['solo','online']as const).map(value=><Pressable key={value} accessibilityRole="radio" accessibilityState={{checked:mode===value}} disabled={!!busy} onPress={()=>{setError('');setMode(value);}} style={{flex:1,minHeight:48,borderRadius:9,backgroundColor:mode===value?c.surface:'transparent',alignItems:'center',justifyContent:'center'}}><Text style={{color:c.text,fontSize:15,fontWeight:'600'}}>{value==='solo'?'本機單人':'線上已核實'}</Text></Pressable>)}</View>
        <View style={{padding:16,borderRadius:16,backgroundColor:c.surface,gap:10}}><Text style={{color:c.text,fontSize:17,fontWeight:'600'}}>目前觀察期</Text><Text translate={false} style={{color:c.text,fontSize:22,fontVariant:['tabular-nums']}}>{rate(current?.acceptanceRate)} / {rate(current?.cancellationRate)}</Text><Text style={{color:c.secondary,fontSize:13}}>接單率／取消率；沒有新樣本時顯示「—」。</Text><Text style={{color:c.secondary,fontSize:13,lineHeight:20}}>生涯次數、收入、成本、行程及仍生效的制裁保持不變。</Text></View>
        {!controller.canResetTraining||status?.canReset===false?<Text style={{color:c.secondary,fontSize:14,lineHeight:21}}>可以先學習；請先完成本更並離開房間，才確認重置。</Text>:null}
        {RESET_QUESTIONS.map((item,i)=><View key={item.id} style={{gap:5}}><Text translate={false} style={{color:c.text,fontSize:15,fontWeight:'600'}}>{i+1}. {copy(item.prompt)}</Text><Text translate={false} style={{color:c.secondary,fontSize:14,lineHeight:21}}>{copy(item.explanation)}</Text></View>)}
        {history.length?<View style={{gap:8}}><Text style={{color:c.text,fontSize:17,fontWeight:'600'}}>過往觀察期</Text>{[...history].reverse().slice(0,historyCount).map(period=><View key={period.periodId} style={{padding:12,borderRadius:10,backgroundColor:c.surface}}><Text translate={false} style={{color:c.text,fontSize:15}}>{rate(period.acceptanceRate)} / {rate(period.cancellationRate)}</Text><Text translate={false} style={{color:c.secondary,fontSize:12}}>{period.counts.accepted}/{period.counts.offered} · {period.counts.cancelled}/{period.counts.accepted}</Text></View>)}{history.length>historyCount?<Button title="顯示較早觀察期" colors={c} secondary onPress={()=>setHistoryCount(value=>value+5)}/>:null}</View>:null}
      </>:null}
      {phase==='quiz'?<>
        <Text translate={false} style={{color:c.secondary,fontSize:14}}>{index+1} / {RESET_QUESTIONS.length}</Text><Text translate={false} style={{color:c.text,fontSize:21,fontWeight:'600',lineHeight:29}}>{copy(question.prompt)}</Text>
        {question.choices.map((choice,choiceIndex)=><Pressable key={choiceIndex} testID={`training-answer-${choiceIndex}`} accessibilityRole="radio" accessibilityState={{checked:answers[index]===choiceIndex}} disabled={!!busy} onPress={()=>setAnswers(previous=>previous.map((value,i)=>i===index?choiceIndex:value))} style={{minHeight:56,padding:14,gap:10,flexDirection:'row',alignItems:'center',borderWidth:1,borderColor:answers[index]===choiceIndex?c.blue:c.line,borderRadius:12,backgroundColor:c.surface}}><Icon name={{ios:answers[index]===choiceIndex?'checkmark.circle.fill':'circle',android:answers[index]===choiceIndex?'radio_button_checked':'radio_button_unchecked'}} color={answers[index]===choiceIndex?c.blue:c.secondary} size={23}/><Text translate={false} style={{flex:1,color:c.text,fontSize:16,lineHeight:23}}>{copy(choice)}</Text></Pressable>)}
      </>:null}
      {phase==='result'?<><Text style={{color:c.text,fontSize:22,fontWeight:'600'}}>{attempt?.passed?'已通過課程':'未達合格線，可閱讀解說再試'}</Text><Text translate={false} style={{color:c.secondary,fontSize:18}}>{attempt?.score} / {RESET_QUESTIONS.length}</Text>{RESET_QUESTIONS.filter((_,i)=>attempt?.correct?.[i]===false).map(item=><View key={item.id} style={{padding:14,gap:8,borderRadius:12,backgroundColor:c.surface}}><Text translate={false} style={{color:c.text,fontSize:15,fontWeight:'600'}}>{copy(item.prompt)}</Text><Text translate={false} style={{color:c.secondary,fontSize:14,lineHeight:21}}>{copy(item.explanation)}</Text></View>)}<Text style={{color:c.secondary,fontSize:14}}>通過課程未有改動任何紀錄，下一步才作最後確認。</Text></>:null}
      {phase==='confirm'?<><Text style={{color:c.text,fontSize:22,fontWeight:'600'}}>確認開新觀察期？</Text><Text style={{color:c.secondary,fontSize:16,lineHeight:24}}>只重開往後接單率及取消率的計數期。舊期及生涯紀錄保留，收入、成本、訂單與現有制裁不會改變。</Text><Text style={{color:c.secondary,fontSize:14}}>{mode==='solo'?'只套用到這部機的單人紀錄。':'只由伺服器套用到這個司機帳號的已核實紀錄。'}</Text>{!mayConfirm?<Text style={{color:c.secondary,fontSize:15}}>請先完成本更並離開房間。</Text>:null}</>:null}
      {phase==='done'?<><Text style={{color:c.text,fontSize:23,fontWeight:'600'}}>新觀察期已開啟</Text><Text style={{color:c.secondary,fontSize:15,lineHeight:23}}>生涯紀錄保持不變；新的接單及取消事件會從這個界線開始累計。</Text><Text translate={false} style={{color:c.text,fontSize:28}}>{rate(current?.acceptanceRate)} / {rate(current?.cancellationRate)}</Text></>:null}
      {error?<View accessibilityLiveRegion="polite" style={{padding:14,gap:8,borderRadius:12,backgroundColor:c.surface}}><Text style={{color:c.text,fontSize:14,lineHeight:21}}>{error}</Text>{mode==='online'&&phase==='intro'?<Button title="重試" colors={c} secondary onPress={()=>void load()} disabled={!!busy}/>:null}</View>:null}
    </ScrollView>
    <View style={{padding:16,paddingBottom:Math.max(insets.bottom,16),gap:9,backgroundColor:c.surface}}>
      {phase==='intro'?<Button testID="training-begin" title={busy?'讀取中…':'開始十題'} colors={c} disabled={!!busy||(mode==='online'&&(!status||unavailable))} onPress={()=>void begin()}/>:null}
      {phase==='quiz'?<Button testID="training-next" title={busy?'提交中…':index===RESET_QUESTIONS.length-1?'提交答案':'下一題'} colors={c} disabled={!!busy||answers[index]<0} onPress={()=>index===RESET_QUESTIONS.length-1?void submit():setIndex(value=>value+1)}/>:null}
      {phase==='result'?<Button title={attempt?.passed?'繼續':'重新學習'} colors={c} onPress={()=>{setError('');setPhase(attempt?.passed?'confirm':'intro');}}/>:null}
      {phase==='confirm'?<><Button testID="training-confirm" title={busy==='confirm'?'正在開新觀察期…':'確認開新觀察期'} colors={c} disabled={!!busy||!mayConfirm} onPress={()=>void confirm()}/>{mode==='online'&&status?.canReset===false?<Button title="重試" colors={c} secondary disabled={!!busy} onPress={()=>void load()}/>:null}<Button title="保留現有觀察期" colors={c} secondary disabled={!!busy} onPress={()=>navigation.goBack()}/></>:null}
      {phase==='done'?<Button title="完成" colors={c} onPress={()=>navigation.goBack()}/>:null}
    </View>
  </View>;
}

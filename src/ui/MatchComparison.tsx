import { sounds } from '../audio/sounds';
import React,{useState} from 'react';
import {ScrollView,View,useWindowDimensions} from 'react-native';
import Svg,{Circle,Polyline} from 'react-native-svg';
import type {MatchReview,PlayerMatchReview} from '../../shared/protocol';
import {LocalizedText as Text,LocalizedPressable as Pressable,getLocalizedPlaceName} from '../i18n';
import {LANDMARK_BY_ID} from '../data/landmarks';
import {SERVICE_STATIONS} from '../data/serviceStations';
import {ROAD_GRAPH} from '../map/roadGraph';
import {comparisonPlayers,projectReviewRoutes,reviewTimelineTitle,timelinePage} from './reviewPresentation';
import {gameTime,money,type Palette} from './theme';
import {Icon} from './components';

export function MatchComparison({review,selfId,startTimeMinutes,colors:c}:{review:MatchReview;selfId:string;startTimeMinutes:number;colors:Palette}) {
  const [expanded,setExpanded]=useState(false),[primaryId,setPrimaryId]=useState(selfId),[secondaryId,setSecondaryId]=useState(''),[page,setPage]=useState(0);
  const {width,fontScale}=useWindowDimensions();
  const {primary,secondary}=comparisonPlayers(review.players,primaryId,secondaryId,selfId);
  if(!primary)return null;
  const pick=(which:'primary'|'secondary',id:string)=>{sounds.playCue('select');if(which==='primary')setPrimaryId(id);else setSecondaryId(id);setPage(0);};
  const selector=(which:'primary'|'secondary',selected:string)=> <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap:8,paddingVertical:4}}>{review.players.filter(player=>which==='primary'||player.playerId!==primary.playerId).map(player=><Pressable key={player.playerId} testID={`review-${which}-${player.playerId}`} accessibilityRole="radio" accessibilityState={{checked:player.playerId===selected}} onPress={()=>pick(which,player.playerId)} style={({pressed})=>({minHeight:44,maxWidth:210,paddingVertical:10,paddingHorizontal:12,borderRadius:10,borderCurve:'continuous',justifyContent:'center',backgroundColor:player.playerId===selected?c.blue:c.muted,opacity:pressed?.7:1})}><Text translate={false} numberOfLines={2} style={{color:player.playerId===selected?c.onBlue:c.text,fontSize:14,fontWeight:'600'}}>{player.nickname}</Text></Pressable>)}</ScrollView>;
  const rows:Array<{label:string;value:(p:PlayerMatchReview)=>string}>=[{label:'實際淨收入',value:p=>`HK$${money(p.netIncome,2)}`},{label:'司機收入',value:p=>`HK$${money(p.grossIncome,2)}`},{label:'本更車租',value:p=>`HK$${money(p.rentalCost,2)}`},{label:'行車成本',value:p=>`HK$${money(p.operatingCost,2)}`},{label:'空閒時間',value:p=>`${Math.round(p.idleMinutes)} 分鐘`},{label:'完成行程',value:p=>String(p.completedTrips)},{label:'接受訂單',value:p=>String(p.acceptedOffers)},{label:'略過及過期',value:p=>String(p.declinedOffers)},{label:'取消訂單',value:p=>String(p.cancelledTrips)},{label:'行駛距離',value:p=>`${(p.totalDistanceM/1000).toFixed(1)} 公里`}];
  const chartWidth=Math.max(120,Math.min(340,width-96)),routes=projectReviewRoutes([primary.route,secondary?.route??[]],chartWidth,150),timeline=timelinePage(primary.timeline,page);
  const detail=(label?:string)=>{if(!label)return undefined;const place=LANDMARK_BY_ID.get(label)??SERVICE_STATIONS.find(station=>station.id===label);if(place)return getLocalizedPlaceName(place);const road=ROAD_GRAPH.edges[label];return road?.name?getLocalizedPlaceName({name:road.name}):undefined;};
  return <View style={{marginTop:12,padding:14,gap:10,borderRadius:14,borderCurve:'continuous',backgroundColor:c.surface}}>
    <Pressable testID="open-match-comparison" accessibilityRole="button" accessibilityState={{expanded}} onPress={()=>{sounds.playCue('open');setExpanded(value=>!value);}} style={{minHeight:44,flexDirection:'row',alignItems:'center',gap:10}}><View style={{flex:1,gap:4}}><Text style={{color:c.text,fontSize:18,fontWeight:'600'}}>賽後比較</Text><Text style={{color:c.secondary,fontSize:12}}>收入、成本、空閒時間同實際行車紀錄</Text></View><Icon name={{ios:expanded?'chevron.up':'chevron.down',android:expanded?'expand_less':'expand_more'}} color={c.secondary} size={18}/></Pressable>
    {expanded?<>
      <Text style={{color:c.secondary,fontSize:12}}>司機一</Text>{selector('primary',primary.playerId)}
      {secondary?<><Text style={{color:c.secondary,fontSize:12}}>司機二</Text>{selector('secondary',secondary.playerId)}</>:null}
      <View style={{flexDirection:'row',gap:8,paddingBottom:8,borderBottomWidth:.5,borderColor:c.line}}><Text style={{flex:1,color:c.secondary,fontSize:12}}>實際紀錄</Text>{[primary,secondary].map((player,index)=><View key={index} style={{flex:1,gap:4}}><Text translate={false} numberOfLines={2} style={{color:index?c.secondary:c.blue,textAlign:'right',fontSize:13,fontWeight:'600'}}>{player?.nickname??'—'}</Text>{player?.forfeited?<Text style={{color:c.secondary,fontSize:11,textAlign:'right'}}>失去資格</Text>:null}</View>)}</View>
      {rows.map(row=><View key={row.label} style={{flexDirection:fontScale>1.7?'column':'row',gap:8,paddingVertical:5}}><Text style={{flex:1,color:c.secondary,fontSize:13}}>{row.label}</Text><View style={{flex:2,flexDirection:'row',gap:8}}>{[primary,secondary].map((player,index)=><Text key={index} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={.75} style={{flex:1,color:c.text,textAlign:'right',fontSize:14,fontVariant:['tabular-nums']}}>{player?row.value(player):'—'}</Text>)}</View></View>)}
      <Text style={{color:c.text,fontSize:15,fontWeight:'600',marginTop:8}}>行車足跡 · 位置抽樣</Text>
      <View style={{backgroundColor:c.muted,borderRadius:12,borderCurve:'continuous',overflow:'hidden',alignItems:'center'}}>{routes.some(points=>points.length)?<Svg width={chartWidth} height={150}>{routes.map((points,index)=><React.Fragment key={index}>{points.length>1?<Polyline points={points.map(p=>`${p.x},${p.y}`).join(' ')} fill="none" stroke={index?c.secondary:c.blue} strokeWidth={2.5} strokeDasharray={index?'5 4':undefined}/>:null}{points.map((p,i)=><Circle key={i} cx={p.x} cy={p.y} r={2} fill={index?c.secondary:c.blue}/>)}</React.Fragment>)}</Svg>:<Text style={{color:c.secondary,fontSize:13,paddingVertical:30}}>未有行車位置紀錄</Text>}</View>
      <Text style={{color:c.secondary,fontSize:12,lineHeight:18}}>線段連接實際抽樣位置，唔代表逐條道路導航；藍線係司機一，虛線係司機二。</Text>
      <Text style={{color:c.text,fontSize:15,fontWeight:'600',marginTop:8}}>司機一決策時間線</Text>
      {timeline.events.length?timeline.events.map((event,index)=><View key={`${timeline.index}-${index}`} style={{paddingVertical:8,gap:3,borderBottomWidth:.5,borderColor:c.line}}><View style={{flexDirection:'row',gap:8}}><Text translate={false} style={{color:c.secondary,fontSize:12,fontVariant:['tabular-nums']}}>{gameTime(event.minute,startTimeMinutes)}</Text><Text style={{flex:1,color:c.text,fontSize:13}}>{reviewTimelineTitle(event.type)}</Text>{event.amount!==undefined?<Text style={{color:c.text,fontSize:13,fontVariant:['tabular-nums']}}>HK${money(event.amount,2)}</Text>:null}</View>{detail(event.label)?<Text translate={false} style={{color:c.secondary,fontSize:12}}>{detail(event.label)}</Text>:null}</View>):<Text style={{color:c.secondary,fontSize:13}}>未有決策紀錄</Text>}
      {timeline.pages>1?<View style={{flexDirection:'row',alignItems:'center',gap:10}}><Pressable testID="review-previous-page" accessibilityRole="button" disabled={timeline.index===0} onPress={()=>{sounds.playCue('tap');setPage(timeline.index-1);}} style={{minHeight:44,justifyContent:'center',opacity:timeline.index===0?.4:1}}><Text style={{color:c.blue}}>上一頁</Text></Pressable><Text translate={false} style={{flex:1,textAlign:'center',color:c.secondary,fontSize:12}}>{timeline.start}–{timeline.end} / {primary.timeline.length}</Text><Pressable testID="review-next-page" accessibilityRole="button" disabled={timeline.index>=timeline.pages-1} onPress={()=>{sounds.playCue('tap');setPage(timeline.index+1);}} style={{minHeight:44,justifyContent:'center',opacity:timeline.index>=timeline.pages-1?.4:1}}><Text style={{color:c.blue}}>下一頁</Text></Pressable></View>:null}
      {primary.timelineTruncated?<Text style={{color:c.secondary,fontSize:12}}>只保留本更部分決策紀錄。</Text>:null}
      <Text style={{color:c.secondary,fontSize:12,lineHeight:19}}>只比較實際紀錄，唔推算冇接嘅單可以賺幾多。</Text>
    </>:null}
  </View>;
}

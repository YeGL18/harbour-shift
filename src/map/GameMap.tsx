import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { LocalizedText as Text, LocalizedPressable as Pressable, t, useLocale } from '../i18n';
import { Asset } from 'expo-asset';
import { File, Paths } from 'expo-file-system';
import { Camera, GeoJSONSource, Layer, Map as NativeMap, Marker, type CameraRef, type GeoJSONSourceProps, type MapRef, type MarkerProps, type StyleSpecification, type ViewStateChangeEvent } from '@maplibre/maplibre-react-native';
import Animated, { Easing, useAnimatedProps, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import type { FeatureCollection, LineString, Point, Polygon } from 'geojson';
import {HKG_AIRPORT,HKG_DEMAND_BOUNDARY,type AirportDemandEstimate} from '../../shared/airport';
import type { ExpressionSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { Coordinate, LookaheadSegment, RoadGraph, SurgeArea, UpcomingBranch, VehicleId } from '../game/types';
import { ROAD_GRAPH, MAP_DATA_CREDIT, distanceMetres } from './roadGraph';
import { nativeAndroidStyle, nativeBuildings, nativeDistricts, nativeGreen, nativePlaces, nativeRoadNames, nativeRoads, nativeWater } from './nativeData';
import { VehicleMarker } from './VehicleMarker';
import { vehicleMarkerScale } from './mapScale';
import { PeerVehicle, QueueVehicle, peerColor, validPeerCoordinate, type MapPeer, type MapQueueVehicle } from './PeerVehicle';
import { makeSurgeLayers, demandHeatLayers, demandWaitLabel, WAIT_PILL_COLORS, surgeLevel, surgeSignature } from './surgeLayers';
import { useTripOverview, type SavedMapView } from './useTripOverview';
import roadEnglish from '../../assets/map/road-names-en.json';
import type {TrafficWorld} from '../game/traffic';

export interface OfferPreview {
  destinationHidden?: boolean;
  id: string; pickup: Coordinate; destination: Coordinate;
  pickupRoute: Coordinate[]; tripRoute: Coordinate[];
}
export interface GameMapProps {
  position: Coordinate & { heading?: number };
  lookahead: LookaheadSegment[];
  branches: UpcomingBranch[];
  pickup?: Coordinate | null;
  destination?: Coordinate | null;
  selectedPlace?: Coordinate | null;
  dark: boolean;
  onBranch: (junctionNodeId: string, edgeId: string) => void;
  planning?: boolean;
  /** Online worlds keep moving; only solo planning can freeze a junction. */
  canPause?: boolean;
  onPlanningChange?: (planning: boolean) => void;
  onSelectPlace?: (coordinate: Coordinate) => void;
  onMapReady?: () => void;
  onMapError?: () => void;
  onMapLoading?: () => void;
  topInset?: number;
  bottomInset?: number;
  vehicleId?: VehicleId;
  /** A new id triggers one five-second full-trip camera overview. */
  remainingTripRoute?: Coordinate[];
  tripOverview?: { id: string; coordinates: Coordinate[] } | null;
  surgeAreas?: SurgeArea[];
  /** Must match the engine's vehicle access filtered graph. */
  roadGraph?: RoadGraph;
  /** Other room members only; never changes the local camera. */
  peers?: MapPeer[];
  queueVehicles?: MapQueueVehicle[];
  offerPreview?: OfferPreview | null;
  branchPreviewDistance?: number;
  snapshotIntervalMs?: number;
  canCruiseTo?: boolean;
  onCruiseTo?: (coordinate: Coordinate) => void;
  cruisingTarget?: (Coordinate & { name?: string }) | null;
  /** Caller compatibility; traffic remains in the simulation, not as decorative cars. */
  trafficWorld?: TrafficWorld;
  airportDemand?:AirportDemandEstimate;
  onAirportPress?:()=>void;
  airportPreview?:{id:string;coordinates:Coordinate[]}|null;
}
const AnimatedMarker = Animated.createAnimatedComponent(Marker);
const EMPTY_SURGE: SurgeArea[] = [];
const EMPTY_PEERS: MapPeer[] = [];
const EMPTY_QUEUE: MapQueueVehicle[] = [];
const AIRPORT_BOUNDARY:FeatureCollection<Polygon>={type:'FeatureCollection',features:[{type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[HKG_DEMAND_BOUNDARY.map(p=>[p.lon,p.lat])]}}]};
const HK_MAP_BOUNDS: [number,number,number,number] = [113.79,22.12,114.52,22.58];
// The fill paints land tiles. The original background is also themed below so
// newly exposed tiles during a zoom never fall back to the other appearance.
const IOS_LAND = '{"type":"FeatureCollection","features":[{"type":"Feature","properties":{},"geometry":{"type":"Polygon","coordinates":[[[110,18],[118,18],[118,27],[110,27],[110,18]]]}}]}';
const colors = {
  light: { land:'#F0F0ED', water:'#D5DEE3', green:'#DCE6D6', building:'#E2E2DE', road:'#FFFFFF', casing:'#D0D1CD', tunnel:'#AAB5BD', text:'#41484C', minor:'#717C82', blue:'#276EF1', surface:'#FFFFFF', ink:'#17202B', border:'#D8DCDF' },
  dark: { land:'#212627', water:'#121D27', green:'#263B30', building:'#2A3133', road:'#465054', casing:'#141A1D', tunnel:'#536370', text:'#D1D8DD', minor:'#99A7AF', blue:'#6C9EFF', surface:'#30383E', ink:'#F3F6FA', border:'#49535A' },
};
const localFonts = process.env.EXPO_OS === 'android' ? ['Harbour Sans HK'] : ['PingFang TC', 'Helvetica Neue'];
// Changing mapStyle replaces the entire native style, including attached child
// sources. Keep it stable and theme the background through a regular layer.
const BASE_STYLE:StyleSpecification={version:8,sources:{},layers:[{id:'background',type:'background',paint:{'background-color':'#F0F0ED'}}]};
const MAP_STYLE=process.env.EXPO_OS==='android'?nativeAndroidStyle:JSON.stringify(BASE_STYLE);
const IOS_DARK_STYLE=JSON.stringify({...BASE_STYLE,layers:[{id:'background',type:'background',paint:{'background-color':colors.dark.land}}]});
let androidStylePromise:Promise<string> | undefined;
function getAndroidStyle() {
  if(!androidStylePromise)androidStylePromise=Asset.fromModule(require('../../assets/map/harbour-sans-hk.otf')).downloadAsync().then(async font=>{
    if(!font.localUri)throw new Error('Bundled map font has no local file');
    const style=nativeAndroidStyle.replace('{"version":8,','{"version":8,"font-faces":'+JSON.stringify({'Harbour Sans HK':[{url:font.localUri}]})+',');
    // RN's Android wrapper validates inline styles using a Java JSONObject,
    // which expands this large dataset beyond small Java heap limits. Passing
    // a local style URL lets MapLibre's C++ loader own the data directly.
    const styleFile=new File(Paths.cache,'harbour-map-style-v3.json');
    await styleFile.write(style);
    return styleFile.uri;
  });
  return androidStylePromise;
}
function StaticSource({id,children,...props}:GeoJSONSourceProps) {
  if(process.env.EXPO_OS!=='android')return <GeoJSONSource id={id} {...props}>{children}</GeoJSONSource>;
  return <>{React.Children.map(children,child=>React.isValidElement(child)?React.cloneElement(child as React.ReactElement<{source?:string}>,{source:id}):child)}</>;
}
const angleDelta = (a:number,b:number) => ((b-a+540)%360)-180;
function routeHeading(position:Coordinate & {heading?:number},route:LookaheadSegment[]) {
  if (Number.isFinite(position.heading)) return position.heading!;
  for(const segment of route) for(const p of segment.coordinates) if(distanceMetres(position,p)>12) return Math.atan2((p.lon-position.lon)*Math.cos(position.lat*Math.PI/180),p.lat-position.lat)*180/Math.PI;
  return 0;
}
const collection = <G extends LineString | Point>(features:FeatureCollection<G>['features']):FeatureCollection<G> => ({type:'FeatureCollection',features});
function shortPreview(graph:RoadGraph,firstId:string,maximum=240):number[][] {
  let edge=graph.edges[firstId];const result:number[][]=[];let remaining=maximum;const visited=new Set<string>();
  while(edge && remaining>1 && !visited.has(edge.id)) {
    visited.add(edge.id);const points=edge.shape || [graph.nodes[edge.from],graph.nodes[edge.to]];
    for(let i=0;i<points.length;i++) {
      const p=points[i];
      if(i===0) { if(!result.length) result.push([p.lon,p.lat]); continue; }
      const a=points[i-1],d=distanceMetres(a,p);
      if(d>remaining) {const f=remaining/d;result.push([a.lon+(p.lon-a.lon)*f,a.lat+(p.lat-a.lat)*f]);remaining=0;break;}
      result.push([p.lon,p.lat]);remaining-=d;
    }
    const previous=edge;
    const candidates=(graph.outgoing[edge.to]||[]).map(id=>graph.edges[id]).filter(e=>e.to!==previous.from && !visited.has(e.id));
    edge=candidates.find(e=>e.name===previous.name) || candidates[0];
  }
  return result;
}
function horizonCoordinates(segments:Pick<LookaheadSegment,'coordinates'>[],maximum=1000):number[][] {
  const result:number[][]=[];let previous:Coordinate|undefined,remaining=maximum;
  for(const segment of segments)for(const point of segment.coordinates) {
    if(!previous){result.push([point.lon,point.lat]);previous=point;continue;}
    const distance=distanceMetres(previous,point);
    if(distance<.05)continue;
    if(distance>remaining){const fraction=remaining/distance;result.push([previous.lon+(point.lon-previous.lon)*fraction,previous.lat+(point.lat-previous.lat)*fraction]);return result;}
    result.push([point.lon,point.lat]);remaining-=distance;previous=point;
    if(remaining<.05)return result;
  }
  return result;
}

export const GameMap=memo(function GameMap({position,lookahead,branches,pickup,destination,selectedPlace,dark,onBranch,planning=false,canPause=true,onPlanningChange,onSelectPlace,onMapReady,onMapError,onMapLoading,topInset=100,bottomInset=0,vehicleId='kam-fung',tripOverview,remainingTripRoute,surgeAreas=EMPTY_SURGE,roadGraph=ROAD_GRAPH,peers=EMPTY_PEERS,queueVehicles=EMPTY_QUEUE,offerPreview,branchPreviewDistance=180,snapshotIntervalMs=150,canCruiseTo=false,onCruiseTo,cruisingTarget,airportDemand,onAirportPress,airportPreview}:GameMapProps) {
  const c=colors[dark?'dark':'light'];const reduced=useReducedMotion();
  const locale=useLocale();
  const mapName:ExpressionSpecification=locale==='en'?['coalesce',['get','nameEn'],['get','name']]:['get','name'];
  const branchName=(name:string)=>{if(locale!=='en')return t(name);const [street,direction]=name.split(' · ');return [(roadEnglish as Record<string,string>)[street]||t(street),direction?t(direction):''].filter(Boolean).join(' · ');};
  const intervalMs=Math.max(120,Math.min(1800,snapshotIntervalMs));
  const cameraRef=useRef<CameraRef>(null);
  const mapRef=useRef<MapRef>(null);
  const [loaded,setLoaded]=useState(false),[rendered,setRendered]=useState(false),[following,setFollowing]=useState(true),[mode,setMode]=useState<'north'|'heading'>('north');
  const [zoom,setZoom]=useState(14.8),[height,setHeight]=useState(874);
  const [mapStyle,setMapStyle]=useState<string|null>(()=>process.env.EXPO_OS==='android'?null:dark?IOS_DARK_STYLE:MAP_STYLE);
  const [mapError,setMapError]=useState(false);
  const mapFailed=useRef(false),mapCallbacks=useRef({onMapReady,onMapError,onMapLoading});mapCallbacks.current={onMapReady,onMapError,onMapLoading};
  const failMap=()=>{if(mapFailed.current)return;mapFailed.current=true;readyRef.current=false;setRendered(false);androidStylePromise=undefined;setMapError(true);mapCallbacks.current.onMapError?.();};
  const [cruisePick,setCruisePick]=useState<Coordinate|null>(null);
  const cruisePickRef=useRef<Coordinate|null>(null);cruisePickRef.current=cruisePick;
  const mapTapBlockedUntil=useRef(0),lastAirportPress=useRef(0);
  const showAirport=()=>{const now=Date.now();mapTapBlockedUntil.current=now+1000;if(now-lastAirportPress.current<500)return;lastAirportPress.current=now;cruisePickRef.current=null;setCruisePick(null);onAirportPress?.();};
  useEffect(()=>{if(!canCruiseTo || offerPreview)setCruisePick(null);},[canCruiseTo,offerPreview?.id]);
  useEffect(()=>{if(process.env.EXPO_OS!=='android')return;let cancelled=false;void getAndroidStyle().then(style=>{if(!cancelled)setMapStyle(style);}).catch(()=>{androidStylePromise=undefined;if(!cancelled)failMap();});return()=>{cancelled=true;};},[]);
  const zoomRef=useRef(14.8),lastUserAction=useRef(0),lastCenter=useRef<Coordinate>(position),cameraBearing=useRef(0),readyRef=useRef(false);
  const userView=useRef<SavedMapView>({zoom:14.8,pitch:0,bearing:0});
  const latest=useRef({position,lookahead});latest.current={position,lookahead};
  const frozenBranch=useRef<UpcomingBranch | null>(null),wasPlanning=useRef(false);
  const freezePlanning=planning&&canPause;
  if(freezePlanning && !wasPlanning.current) frozenBranch.current=branches[0] ? {...branches[0],options:branches[0].options.map(p=>({...p,coordinate:{...p.coordinate}}))} : null;
  if(!freezePlanning) frozenBranch.current=null;
  wasPlanning.current=freezePlanning;
  const branch=freezePlanning ? frozenBranch.current : branches[0] || null;
  const showBranchPanel=Boolean(!offerPreview && branch && (planning || branch.distanceM<=branchPreviewDistance));
  const currentSelection=branch ? branches.find(b=>b.junctionNodeId===branch.junctionNodeId)?.selectedEdgeId || branch.selectedEdgeId : '';
  const branchKey=branch ? `${branch.junctionNodeId}:${branch.options.map(p=>p.edgeId).join(',')}` : '';
  const alternatives=useMemo<FeatureCollection<LineString>>(()=>collection(branch ? branch.options.map((option,index)=>({type:'Feature',id:option.edgeId,properties:{edgeId:option.edgeId,number:String(index+1)},geometry:{type:'LineString',coordinates:shortPreview(roadGraph,option.edgeId)}})).filter(f=>f.geometry.coordinates.length>1) as FeatureCollection<LineString>['features'] : []),[branchKey,roadGraph]);
  const alternativeEnds=useMemo<FeatureCollection<Point>>(()=>collection(alternatives.features.map(feature=>({type:'Feature',id:feature.id,properties:feature.properties,geometry:{type:'Point',coordinates:feature.geometry.coordinates[feature.geometry.coordinates.length-1]}}))),[alternatives]);
  const points=useMemo<FeatureCollection<Point>>(()=>collection([
    ...((offerPreview?.pickup||pickup)?[{type:'Feature' as const,properties:{kind:'pickup'},geometry:{type:'Point' as const,coordinates:[(offerPreview?.pickup||pickup)!.lon,(offerPreview?.pickup||pickup)!.lat]}}]:[]),
    ...(!offerPreview?.destinationHidden&&(offerPreview?.destination||destination)?[{type:'Feature' as const,properties:{kind:'destination'},geometry:{type:'Point' as const,coordinates:[(offerPreview?.destination||destination)!.lon,(offerPreview?.destination||destination)!.lat]}}]:[]),
    ...(selectedPlace?[{type:'Feature' as const,properties:{kind:'start'},geometry:{type:'Point' as const,coordinates:[selectedPlace.lon,selectedPlace.lat]}}]:[]),
  ]),[pickup?.lat,pickup?.lon,destination?.lat,destination?.lon,selectedPlace?.lat,selectedPlace?.lon,offerPreview?.id,offerPreview?.destinationHidden]);
  const selectorSpace=showBranchPanel?110:0;
  const usable=Math.max(120,height-topInset-bottomInset-selectorSpace);
  const padding=useMemo(()=>({top:topInset+usable*.26,right:0,bottom:bottomInset+selectorSpace,left:0}),[topInset,bottomInset,usable,selectorSpace]);
  const initial=useRef({center:[position.lon,position.lat] as [number,number],zoom:14.8,bearing:0,pitch:0,padding});
  const latestPadding=useRef(padding);latestPadding.current=padding;
  const restoreView=(view:SavedMapView,bearing:number)=>{setFollowing(true);zoomRef.current=view.zoom;userView.current={...view,bearing};lastUserAction.current=Date.now();lastCenter.current=latest.current.position;cameraBearing.current=bearing;};
  const confirmCruisePick=()=>{
    const target=cruisePickRef.current;
    if(!target||!canCruiseTo||!onCruiseTo||offerPreview)return;
    // Android dispatches its marker's native press independently of child
    // Pressable hit testing. Clear synchronously to deduplicate both paths.
    cruisePickRef.current=null;mapTapBlockedUntil.current=Date.now()+1000;
    setCruisePick(null);onCruiseTo(target);setFollowing(true);lastUserAction.current=Date.now();
    cameraRef.current?.easeTo({center:[latest.current.position.lon,latest.current.position.lat],padding:latestPadding.current,duration:reduced?0:350});
  };
  const airportFollowing=useRef(true),viewportCenter=useRef<Coordinate>(position),airportSavedCenter=useRef<Coordinate>(position),airportSavedBearing=useRef(0);
  const airportView=useTripOverview({
    request:airportPreview,durationMilliseconds:null,debugName:'AirportPreview',loaded:rendered,reducedMotion:reduced,cameraRef,position,userView,topInset,bottomInset,selectorSpace,padding,
    restoreBearing:()=>airportSavedBearing.current,restoreCenter:()=>airportFollowing.current?latest.current.position:airportSavedCenter.current,
    onStart:()=>{airportFollowing.current=following;airportSavedCenter.current={...viewportCenter.current};airportSavedBearing.current=cameraBearing.current;setFollowing(true);lastUserAction.current=0;setCruisePick(null);},
    onRestore:(view,bearing)=>{restoreView(view,bearing);setFollowing(airportFollowing.current);},
  });
  const airportRoute=useMemo<FeatureCollection<LineString>>(()=>collection(airportPreview&&airportPreview.coordinates.length>1?[{type:'Feature',properties:{},geometry:{type:'LineString',coordinates:airportPreview.coordinates.map(p=>[p.lon,p.lat])}}]:[]),[airportPreview?.coordinates]);
  const offerView=useTripOverview({
    request:offerPreview?{id:offerPreview.id,coordinates:[...offerPreview.pickupRoute,...offerPreview.tripRoute]}:null,
    durationMilliseconds:null,debugName:'OfferPreview',loaded:rendered,reducedMotion:reduced,cameraRef,position,userView,topInset,bottomInset,selectorSpace,padding,
    restoreBearing:()=>mode==='north'?0:routeHeading(latest.current.position,latest.current.lookahead),
    onStart:()=>{setFollowing(true);lastUserAction.current=0;},onRestore:restoreView,
  });
  const overview=useTripOverview({
    request:tripOverview,loaded:rendered,reducedMotion:reduced,cameraRef,position,userView,topInset,bottomInset,selectorSpace,padding,
    restoreBearing:()=>mode==='north'?0:routeHeading(latest.current.position,latest.current.lookahead),
    onStart:()=>{setFollowing(true);lastUserAction.current=0;},
    onRestore:restoreView,
  });
  const route=useMemo<FeatureCollection<LineString>>(()=>{
    if(offerPreview)return collection([]);
    const fullRoute=remainingTripRoute || overview.coordinates;
    const coordinates=fullRoute ? fullRoute.map(point=>[point.lon,point.lat]) : horizonCoordinates(lookahead);
    return collection(coordinates.length>1 ? [{type:'Feature',properties:{},geometry:{type:'LineString',coordinates}}] : []);
  },[lookahead,overview.coordinates,remainingTripRoute,offerPreview?.id]);
  const showingFullRoute=Boolean(remainingTripRoute?.length || overview.coordinates?.length);
  const offerRoutes=useMemo<FeatureCollection<LineString>>(()=>collection(!offerPreview?[]:[
    {type:'Feature',properties:{leg:'pickup'},geometry:{type:'LineString',coordinates:offerPreview.pickupRoute.map(point=>[point.lon,point.lat])}},
    {type:'Feature',properties:{leg:'trip'},geometry:{type:'LineString',coordinates:offerPreview.tripRoute.map(point=>[point.lon,point.lat])}},
  ].filter(feature=>feature.geometry.coordinates.length>1) as FeatureCollection<LineString>['features']),[offerPreview?.id]);
  const visiblePeers=useMemo(()=>peers.filter(peer=>peer.id && validPeerCoordinate(peer.position)).slice(0,7),[peers]);
  const visibleQueue=useMemo(()=>queueVehicles.filter(vehicle=>vehicle.id&&validPeerCoordinate(vehicle.position)&&Number.isFinite(vehicle.position.heading)&&distanceMetres(vehicle.position,position)>=7&&visiblePeers.every(peer=>distanceMetres(vehicle.position,peer.position)>=7)).slice(0,40),[queueVehicles,position.lat,position.lon,visiblePeers]);
  // Road traffic still affects the shared simulation. Only its decorative cars
  // are hidden; physical fuel queues and real room peers retain their positions.
  const peerRoutes=useMemo<FeatureCollection<LineString>>(()=>collection(visiblePeers.flatMap(peer=>{
    const coordinates=(peer.route || []).slice(0,256).filter(validPeerCoordinate);
    if(coordinates.length<2)return [];
    const line=horizonCoordinates([{coordinates}]);
    return line.length>1?[{type:'Feature' as const,properties:{color:peerColor(peer.color)},geometry:{type:'LineString' as const,coordinates:line}}]:[];
  })),[visiblePeers]);
  const surgeKey=surgeSignature(surgeAreas);
  const demand=useMemo(()=>makeSurgeLayers(surgeAreas),[surgeKey]);
  const heatLayers=useMemo(()=>demandHeatLayers(dark),[dark]);
  const appliedPadding=useRef<typeof padding|null>(null);
  useEffect(()=>{
    if(!loaded){appliedPadding.current=null;return;}
    if(appliedPadding.current===padding)return;
    let cancelled=false;
    let timer:ReturnType<typeof setTimeout>|undefined;
    const apply=()=>{
      if(cancelled || overview.activeRef.current || offerView.activeRef.current || airportView.activeRef.current)return;
      const guardRemaining=800-(Date.now()-lastUserAction.current);
      if(guardRemaining>0){timer=setTimeout(apply,guardRemaining+16);return;}
      const firstApply=appliedPadding.current===null;
      appliedPadding.current=padding;
      if(following){
        // Only this imperative path owns changing insets. A declarative Camera
        // padding stop can interrupt an offer/trip zoom restoration mid-flight.
        const p=latest.current.position;
        if(firstApply)lastUserAction.current=Date.now();
        cameraRef.current?.easeTo({center:[p.lon,p.lat],...(firstApply?{zoom:userView.current.zoom,pitch:userView.current.pitch}:{}),padding,duration:reduced?0:250});
      }else{
        // Inspect mode keeps its geographic camera and chosen zoom/pitch.
        void cameraRef.current?.setStop({padding,duration:reduced?0:250});
      }
    };
    apply();
    return()=>{cancelled=true;if(timer)clearTimeout(timer);};
  },[padding,loaded,following,reduced,overview.coordinates,offerView.coordinates,airportView.coordinates]);
  useEffect(()=>{
    if(!loaded || !following || planning&&canPause)return;
    const update=()=>{
      if(overview.activeRef.current || offerView.activeRef.current || airportView.activeRef.current)return;
      if(Date.now()-lastUserAction.current<800)return;
      const p=latest.current.position,target=mode==='north'?0:routeHeading(p,latest.current.lookahead);
      const delta=angleDelta(cameraBearing.current,target);
      if(distanceMetres(lastCenter.current,p)<7 && (mode==='north' || Math.abs(delta)<8))return;
      const bearing=mode==='north'?0:cameraBearing.current+delta*.35;
      cameraBearing.current=bearing;lastCenter.current=p;
      cameraRef.current?.easeTo({center:[p.lon,p.lat],bearing,padding:latestPadding.current,duration:reduced?0:Math.max(450,intervalMs),easing:'linear'});
    };
    update();const timer=setInterval(update,350);return()=>clearInterval(timer);
  },[loaded,following,planning,canPause,mode,reduced,intervalMs]);
  const onViewport=(event:{nativeEvent:ViewStateChangeEvent})=>{
    if(!loaded)return;
    const state=event.nativeEvent;viewportCenter.current={lon:state.center[0],lat:state.center[1]};zoomRef.current=state.zoom;setZoom(state.zoom);
    bearingShared.set(state.bearing);zoomShared.set(state.zoom);
    if(state.userInteraction){airportView.cancel(false);offerView.cancel(false);overview.cancel(false);userView.current={zoom:state.zoom,pitch:state.pitch,bearing:state.bearing};lastUserAction.current=Date.now();setFollowing(false);cameraBearing.current=state.bearing;}
  };
  const changeZoom=(delta:number)=>{if(!rendered)return;const interruptedOverview=airportView.cancel(false)||offerView.cancel(false)||overview.cancel(false);if(interruptedOverview)setFollowing(false);lastUserAction.current=Date.now();const next=Math.max(8,Math.min(18.5,(interruptedOverview?zoomRef.current:userView.current.zoom)+delta));userView.current={...userView.current,zoom:next};zoomRef.current=next;setZoom(next);cameraRef.current?.zoomTo(next,{padding:latestPadding.current,duration:reduced?0:230});};
  const recenter=()=>{if(!loaded || airportView.cancel(true) || offerView.cancel(true) || overview.cancel(true))return;setFollowing(true);lastUserAction.current=Date.now();const p=latest.current.position,bearing=mode==='north'?0:routeHeading(p,latest.current.lookahead);cameraBearing.current=bearing;lastCenter.current=p;cameraRef.current?.easeTo({center:[p.lon,p.lat],bearing,padding:latestPadding.current,duration:reduced?0:450});};
  const changeMode=()=>{airportView.cancel(true);offerView.cancel(true);overview.cancel(true);const next=mode==='north'?'heading':'north';setMode(next);lastUserAction.current=Date.now();if(next==='north'){cameraBearing.current=0;void cameraRef.current?.setStop({bearing:0,padding:latestPadding.current,duration:reduced?0:400});}else {setFollowing(true);const p=latest.current.position,bearing=routeHeading(p,latest.current.lookahead);cameraBearing.current=bearing;cameraRef.current?.easeTo({center:[p.lon,p.lat],bearing,padding:latestPadding.current,duration:reduced?0:450});}};
  const lon=useSharedValue(position.lon),lat=useSharedValue(position.lat),carHeading=useSharedValue(routeHeading(position,lookahead)),bearingShared=useSharedValue(0),zoomShared=useSharedValue(14.8);
  useEffect(()=>{const duration=reduced?0:intervalMs;lon.set(withTiming(position.lon,{duration,easing:Easing.linear}));lat.set(withTiming(position.lat,{duration,easing:Easing.linear}));const target=routeHeading(position,lookahead);carHeading.set(withTiming(carHeading.get()+angleDelta(carHeading.get(),target),{duration}));},[position.lon,position.lat,position.heading,reduced,mode,intervalMs]);
  const carProps=useAnimatedProps<MarkerProps>(()=>({lngLat:[lon.get(),lat.get()]}));
  const carRotation=useAnimatedStyle(()=>({transform:[{rotate:`${carHeading.get()-bearingShared.get()}deg`},{scale:vehicleMarkerScale(zoomShared.get())}]}));
  const rgba=dark?'108,158,255':'39,110,241';
  const markReady=()=>{if(!readyRef.current&&!mapFailed.current){readyRef.current=true;setRendered(true);mapCallbacks.current.onMapReady?.();}};
  useEffect(()=>{if(rendered)return;const timer=setTimeout(failMap,25_000);return()=>clearTimeout(timer);},[rendered]);
  useEffect(()=>{
    if(!loaded || rendered || mapError)return;
    let cancelled=false,busy=false;
    // Continuous route updates can prevent Android's fully-rendered event.
    // Confirm actual native road features instead of declaring the empty style ready.
    const check=async()=>{if(busy || cancelled)return;busy=true;try{const features=await mapRef.current?.queryRenderedFeatures({layers:['road-fill']});if(!cancelled && features?.length)markReady();}catch{/* Style/source attachment is still in progress. */}finally{busy=false;}};
    const timer=setInterval(()=>{void check();},700);void check();
    return()=>{cancelled=true;clearInterval(timer);};
  },[loaded,rendered,mapError]);
  // Android's native scale plugin only honours top/left. A shared overlay keeps
  // the scale above measured panels on both platforms (MapLibre uses 512px tiles).
  const metresPerPoint=78271.51696*Math.cos(position.lat*Math.PI/180)/2**zoom;
  const scaleMetres=[5,10,20,50,100,200,500,1000,2000,5000,10000].filter(v=>v<=metresPerPoint*86).at(-1) || 5;
  const demandBadges:SurgeArea[]=[];
  for(const area of [...surgeAreas].sort((a,b)=>b.multiplier-a.multiplier||a.waitMinutesMin-b.waitMinutesMin)) {
    if(surgeLevel(area)==='quiet')continue;
    if(demandBadges.every(other=>distanceMetres(area.center,other.center)>metresPerPoint*100))demandBadges.push(area);
  }
  return <View style={styles.root} onLayout={event=>setHeight(event.nativeEvent.layout.height)}>
    {mapStyle && <NativeMap ref={mapRef} testID="native-game-map" accessibilityLabel={t('香港離線地圖')} accessibilityValue={{text:t(rendered?'已載入':'載入中')}} mapStyle={mapStyle} dragPan touchZoom touchRotate touchPitch preferredFramesPerSecond={60} attribution={false} logo={false} compass={false} scaleBar={false} onWillStartLoadingMap={()=>{if(mapFailed.current)return;readyRef.current=false;setRendered(false);setLoaded(false);mapCallbacks.current.onMapLoading?.();}} onDidFailLoadingMap={failMap} onDidFinishLoadingStyle={()=>setLoaded(true)} onRegionWillChange={event=>{if(event.nativeEvent.userInteraction){airportView.cancel(false);offerView.cancel(false);overview.cancel(false);setFollowing(false);lastUserAction.current=Date.now();}}} onRegionIsChanging={event=>{const state=event.nativeEvent;bearingShared.set(state.bearing);zoomShared.set(state.zoom);if(state.userInteraction)userView.current={zoom:state.zoom,pitch:state.pitch,bearing:state.bearing};}} onRegionDidChange={onViewport} onLongPress={event=>{const [lon,lat]=event.nativeEvent.lngLat;onSelectPlace?.({lat,lon});}} onPress={event=>{if(Date.now()<mapTapBlockedUntil.current||!canCruiseTo||!onCruiseTo||offerPreview||!rendered)return;const [lon,lat]=event.nativeEvent.lngLat;setCruisePick({lat,lon});setFollowing(false);lastUserAction.current=Date.now();}}>
      <Camera ref={cameraRef} initialViewState={initial.current} minZoom={8} maxZoom={18.5} maxBounds={HK_MAP_BOUNDS}/>
      {loaded && <>
      {/* Native iOS Layer reuses an existing matching id: update the original
          background paint without replacing the style or attached sources. */}
      {process.env.EXPO_OS==='ios'&&<Layer id="background" type="background" paint={{'background-color':c.land}}/>}
      {process.env.EXPO_OS==='ios' ? <GeoJSONSource id="ios-land" data={IOS_LAND}><Layer id="land-theme" type="fill" paint={{'fill-color':c.land}}/></GeoJSONSource> : <Layer id="land-theme" type="background" afterId="background" paint={{'background-color':c.land}}/>}
      <StaticSource id="water" data={nativeWater}><Layer id="water-fill" type="fill" paint={{'fill-color':c.water}}/></StaticSource>
      <StaticSource id="green" data={nativeGreen}><Layer id="green-fill" type="fill" paint={{'fill-color':c.green}}/></StaticSource>
      <StaticSource id="buildings" data={nativeBuildings}><Layer id="building-fill" type="fill" minzoom={13} paint={{'fill-color':c.building}}/></StaticSource>
      {/* Demand light sits above the ground/greenery and below every road. */}
      <GeoJSONSource id="demand-heat" data={demand.heat}>{heatLayers.map((layer,index)=><Layer key={layer.id} {...layer} afterId={index?heatLayers[index-1].id:'building-fill'}/>)}</GeoJSONSource>
      {airportDemand&&<GeoJSONSource id="airport-boundary" data={AIRPORT_BOUNDARY}>
        <Layer id="airport-demand-fill" type="fill" afterId={heatLayers.at(-1)!.id} paint={{'fill-color':c.blue,'fill-opacity':dark?.14:.12}}/>
        <Layer id="airport-demand-outline" type="line" afterId="airport-demand-fill" paint={{'line-color':c.blue,'line-width':2,'line-opacity':.8,'line-dasharray':[3,1]}}/>
      </GeoJSONSource>}
      <StaticSource id="roads" data={nativeRoads} tolerance={.5}>
        <Layer id="road-casing" type="line" afterId={airportDemand?'airport-demand-outline':heatLayers.at(-1)!.id} layout={{'line-cap':'round','line-join':'round'}} paint={{'line-color':c.casing,'line-width':['interpolate',['linear'],['zoom'],10,.8,14,3.5,17,10]}}/>
        <Layer id="road-fill" type="line" afterId="road-casing" layout={{'line-cap':'round','line-join':'round'}} paint={{'line-color':['match',['get','class'],'tunnel',c.tunnel,c.road],'line-width':['interpolate',['linear'],['zoom'],10,.5,14,2.2,17,7.4]}}/>
      </StaticSource>
      <GeoJSONSource id="demand-anchors" data={demand.labels}><Layer id="demand-quiet-dots" type="circle" afterId="road-fill" filter={['==',['get','level'],'quiet']} paint={{'circle-radius':7,'circle-color':['get','color'],'circle-opacity':.98,'circle-blur':.06}}/></GeoJSONSource>
      <GeoJSONSource id="peer-routes" data={peerRoutes}><Layer id="peer-route-preview" type="line" layout={{'line-cap':'round','line-join':'round'}} paint={{'line-color':['get','color'],'line-width':3,'line-opacity':.5,'line-dasharray':[2,2]}}/></GeoJSONSource>
      <GeoJSONSource id="airport-preview-route" data={airportRoute}><Layer id="airport-preview-line" type="line" afterId="road-fill" layout={{'line-cap':'round','line-join':'round'}} paint={{'line-color':c.blue,'line-width':4,'line-opacity':.85,'line-dasharray':[2,1.5]}}/></GeoJSONSource>
      <GeoJSONSource id="route" data={route} lineMetrics><Layer id="selected-route" type="line" layout={{'line-cap':'round','line-join':'round'}} paint={{'line-width':6,'line-gradient':['interpolate',['linear'],['line-progress'],0,`rgba(${rgba},1)`,.55,`rgba(${rgba},${showingFullRoute?1:.75})`,1,`rgba(${rgba},${showingFullRoute?1:.08})`]}}/></GeoJSONSource>
      <GeoJSONSource id="offer-routes" data={offerRoutes}>
        <Layer id="offer-route-casing" type="line" layout={{'line-cap':'round','line-join':'round'}} paint={{'line-color':c.surface,'line-width':9,'line-opacity':.85}}/>
        <Layer id="offer-route-pickup" type="line" filter={['==',['get','leg'],'pickup']} layout={{'line-cap':'round','line-join':'round'}} paint={{'line-color':dark?'#59D3D8':'#009EA4','line-width':5}}/>
        <Layer id="offer-route-trip" type="line" filter={['==',['get','leg'],'trip']} layout={{'line-cap':'round','line-join':'round'}} paint={{'line-color':c.blue,'line-width':5}}/>
      </GeoJSONSource>
      <GeoJSONSource id="alternatives" data={alternatives}>
        <Layer id="alternative-casing" type="line" filter={['!=',['get','edgeId'],currentSelection]} layout={{'line-cap':'round','line-join':'round'}} paint={{'line-color':c.surface,'line-width':8,'line-opacity':.9}}/>
        <Layer id="alternative-preview" type="line" filter={['!=',['get','edgeId'],currentSelection]} layout={{'line-cap':'butt','line-join':'round'}} paint={{'line-color':dark?'#B3BBC2':'#727D86','line-width':5,'line-opacity':1,'line-dasharray':[2,1.5]}}/>
      </GeoJSONSource>
      {showBranchPanel&&<GeoJSONSource id="alternative-ends" data={alternativeEnds}>
        <Layer id="alternative-end-circles" type="circle" filter={['!=',['get','edgeId'],currentSelection]} paint={{'circle-radius':11,'circle-color':c.surface,'circle-stroke-width':2,'circle-stroke-color':c.minor}}/>
        <Layer id="alternative-end-labels" type="symbol" filter={['!=',['get','edgeId'],currentSelection]} layout={{'text-field':['get','number'],'text-font':localFonts,'text-size':12,'text-allow-overlap':true,'text-ignore-placement':true}} paint={{'text-color':c.ink}}/>
      </GeoJSONSource>}
      <StaticSource id="road-names" data={nativeRoadNames}><Layer id="road-labels" type="symbol" minzoom={13.5} layout={{'text-field':mapName,'text-font':localFonts,'text-size':11,'text-padding':10,'text-max-width':10,'symbol-sort-key':['get','rank']}} paint={{'text-color':c.minor,'text-halo-color':c.land,'text-halo-width':1.5}}/></StaticSource>
      <StaticSource id="places" data={nativePlaces}><Layer id="place-labels" type="symbol" minzoom={16} layout={{'text-field':mapName,'text-font':localFonts,'text-size':11,'text-padding':12,'text-max-width':9}} paint={{'text-color':c.minor,'text-halo-color':c.land,'text-halo-width':1.5}}/></StaticSource>
      <StaticSource id="districts" data={nativeDistricts}><Layer id="district-labels" type="symbol" minzoom={10} layout={{'text-field':mapName,'text-font':localFonts,'text-size':['interpolate',['linear'],['zoom'],10,12,15,17],'text-padding':25}} paint={{'text-color':c.text,'text-halo-color':c.land,'text-halo-width':2}}/></StaticSource>
      {demandBadges.map(area=>{const level=surgeLevel(area) as keyof typeof WAIT_PILL_COLORS;return <Marker key={`demand-${area.id}`} id={`demand-${area.id}`} lngLat={[area.center.lon,area.center.lat]}><View pointerEvents="none" style={[styles.demandBadge,{backgroundColor:WAIT_PILL_COLORS[level]}]}><Text translate={false} maxFontSizeMultiplier={1} style={{fontSize:14,lineHeight:16,fontWeight:'700',color:'#FFFFFF'}}>⌃</Text><Text numberOfLines={1} maxFontSizeMultiplier={1.2} style={{fontSize:locale==='en'?10:11,fontWeight:'700',color:'#FFFFFF'}}>{demandWaitLabel(area)}</Text></View></Marker>;})}
      {airportDemand&&onAirportPress&&<Marker id="hkg-demand-label" lngLat={[HKG_AIRPORT.center.lon,HKG_AIRPORT.center.lat]} onPress={event=>{event.stopPropagation();showAirport();}}><Pressable testID="airport-demand-map-label" accessibilityRole="button" accessibilityLabel="機場需求及輪候" onPressIn={()=>{mapTapBlockedUntil.current=Date.now()+1000;}} onPress={event=>{event.stopPropagation();showAirport();}} style={{minHeight:44,paddingHorizontal:14,borderRadius:22,justifyContent:'center',backgroundColor:c.blue,borderWidth:2,borderColor:c.surface}}><Text translate={false} maxFontSizeMultiplier={1.2} numberOfLines={1} style={{color:dark?'#17202B':'#FFFFFF',fontWeight:'700',fontSize:12}}>{`HKG · ${t(airportDemand.level==='busy'?'需求較高':airportDemand.level==='normal'?'一般需求':'需求較低')}`}</Text></Pressable></Marker>}
      <GeoJSONSource id="service-points" data={points}><Layer id="service-point-halo" type="circle" paint={{'circle-radius':14,'circle-color':c.surface,'circle-opacity':.95}}/><Layer id="service-point" type="circle" paint={{'circle-radius':6,'circle-color':['match',['get','kind'],'pickup',dark?'#59D3D8':'#009EA4',c.blue],'circle-stroke-width':2,'circle-stroke-color':c.surface}}/></GeoJSONSource>
      {cruisingTarget&&<Marker id="cruising-target" lngLat={[cruisingTarget.lon,cruisingTarget.lat]}><View testID="cruising-target" accessibilityLabel={`${t('巡航目的地')}，${cruisingTarget.name||t('地圖位置')}`} pointerEvents="none" style={[styles.targetBadge,{backgroundColor:c.surface,borderColor:c.blue}]}><Text numberOfLines={1} style={{color:c.ink,fontSize:11,fontWeight:'600'}}>{cruisingTarget.name||'巡航目的地'}</Text></View></Marker>}
      {canCruiseTo&&!offerPreview&&cruisePick&&<Marker id="cruise-location-picker" lngLat={[cruisePick.lon,cruisePick.lat]} anchor="bottom" offset={[0,-12]} onPress={process.env.EXPO_OS==='android'?event=>{event.stopPropagation();confirmCruisePick();}:undefined}><View style={[styles.cruiseCapsule,{backgroundColor:c.surface,borderColor:c.border}]}><Text style={{color:c.ink,fontSize:13}}>地圖位置</Text><Pressable accessibilityRole="button" accessibilityLabel="前往所選地圖位置" onPressIn={()=>{mapTapBlockedUntil.current=Date.now()+1000;}} onPress={event=>{event.stopPropagation();confirmCruisePick();}} style={[styles.cruiseGo,{backgroundColor:c.blue}]}><Text style={{color:dark?'#17202B':'#FFFFFF',fontWeight:'600'}}>前往</Text></Pressable></View></Marker>}
      {visibleQueue.map(vehicle=><QueueVehicle key={vehicle.id} vehicle={vehicle} bearing={bearingShared} zoom={zoomShared} dark={dark} reduced={reduced} intervalMs={intervalMs} fallbackVehicleId={vehicleId}/>)}
      {visiblePeers.map(peer=><PeerVehicle key={peer.id} peer={peer} bearing={bearingShared} zoom={zoomShared} dark={dark} reduced={reduced} intervalMs={intervalMs}/>)}
      <AnimatedMarker id="vehicle" lngLat={[position.lon,position.lat]} animatedProps={carProps}>
        <Animated.View testID={`map-vehicle-${vehicleId}`} pointerEvents="none" style={[styles.car,carRotation]}><VehicleMarker vehicleId={vehicleId} dark={dark}/></Animated.View>
      </AnimatedMarker>
      </>}
    </NativeMap>}
    {!rendered && <View pointerEvents="none" style={[StyleSheet.absoluteFill,{backgroundColor:c.land}]}/>}
    {!rendered && <View pointerEvents="none" style={[styles.loading,{top:topInset+70,backgroundColor:c.surface}]}><Text style={{color:c.ink,fontSize:12}}>{mapError?'離線地圖載入失敗，請重新開啟遊戲':'載入離線地圖…'}</Text></View>}
    <View style={[styles.controls,{top:topInset+8}]}>
      <Pressable accessibilityRole="button" accessibilityLabel="放大地圖" accessibilityValue={{text:`縮放 ${zoom.toFixed(1)}`}} onPress={()=>changeZoom(.5)} style={[styles.control,{backgroundColor:c.surface,borderColor:c.border}]}><Text numberOfLines={1} maxFontSizeMultiplier={1} style={[styles.controlSymbol,{color:c.ink}]}>＋</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="縮細地圖" accessibilityValue={{text:`縮放 ${zoom.toFixed(1)}`}} onPress={()=>changeZoom(-.5)} style={[styles.control,{backgroundColor:c.surface,borderColor:c.border}]}><Text numberOfLines={1} maxFontSizeMultiplier={1} style={[styles.controlSymbol,{color:c.ink}]}>−</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={mode==='north'?'切換車頭方向跟隨':'切換北向地圖'} onPress={changeMode} style={[styles.control,{backgroundColor:c.surface,borderColor:c.border}]}><Text numberOfLines={1} maxFontSizeMultiplier={1.2} adjustsFontSizeToFit minimumFontScale={.6} style={{maxWidth:40,textAlign:'center',color:c.ink,fontSize:14,fontWeight:'600'}}>{mode==='north'?'北向':'車頭'}</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="回到架車位置" accessibilityState={{selected:following}} onPress={recenter} style={[styles.control,{backgroundColor:following?c.blue:c.surface,borderColor:following?c.blue:c.border}]}><Text numberOfLines={1} maxFontSizeMultiplier={1.2} adjustsFontSizeToFit minimumFontScale={.6} style={{maxWidth:40,textAlign:'center',color:following?(dark?'#17202B':'#FFFFFF'):c.ink,fontSize:13,fontWeight:'600'}}>跟車</Text></Pressable>
      {branch && onPlanningChange && (!canPause || !planning&&!showBranchPanel) && <Pressable accessibilityRole="button" accessibilityLabel={canPause?'暫停行駛，選擇下一路口':planning?'完成選路':'選擇下一路口'} onPress={()=>onPlanningChange(canPause?true:!planning)} style={[styles.control,{backgroundColor:c.surface,borderColor:c.border}]}><Text numberOfLines={1} maxFontSizeMultiplier={1.2} adjustsFontSizeToFit minimumFontScale={.6} style={{maxWidth:40,textAlign:'center',color:c.ink,fontSize:13,fontWeight:'600'}}>{!canPause&&planning?'完成':'選路'}</Text></Pressable>}
    </View>
    {overview.coordinates && <View pointerEvents="none" accessibilityLabel={t('行程全覽，五秒後回復跟車')} style={[styles.inspect,{top:topInset+64,backgroundColor:c.surface}]}><Text numberOfLines={1} maxFontSizeMultiplier={1.2} style={{color:c.ink,fontSize:12}}>行程全覽 · 5 秒後跟車</Text></View>}
    {!following && !overview.coordinates && <View pointerEvents="none" style={[styles.inspect,{top:topInset+64,backgroundColor:c.surface}]}><Text numberOfLines={1} maxFontSizeMultiplier={1.2} style={{color:c.ink,fontSize:12}}>自由查看 · {zoom.toFixed(1)}</Text></View>}
    {showBranchPanel && branch && <View style={[styles.branchPanel,{bottom:bottomInset+30,backgroundColor:c.surface,borderColor:c.border}]}>
      <Text style={{color:c.minor,fontSize:12,paddingHorizontal:12,paddingTop:10}}>下個路口 · {Math.round(branch.distanceM)} 米</Text>
      <View style={styles.branchChoices}>
        {branch.options.map((option,index)=>{const selected=option.edgeId===currentSelection;return <Pressable key={option.edgeId} testID={`branch-${option.edgeId}`} accessibilityRole="button" accessibilityState={{selected}} accessibilityLabel={`${t('選擇')}${branchName(option.name)}`} onPress={()=>{overview.cancel(true);onBranch(branch.junctionNodeId,option.edgeId);}} style={[styles.choice,{borderColor:selected?c.blue:c.border,backgroundColor:selected?(dark?'#25374F':'#ECF2FF'):c.surface}]}><Text style={{color:selected?c.blue:c.minor,fontSize:12,fontWeight:'600'}}>{selected?'已選方向':`方向 ${index+1}`}</Text><Text numberOfLines={2} style={{color:c.ink,fontSize:14,fontWeight:'500'}} translate={false}>{branchName(option.name)}</Text></Pressable>;})}
      </View>
    </View>}
    <View pointerEvents="none" style={[styles.credit,{bottom:bottomInset+8}]}><Text numberOfLines={2} maxFontSizeMultiplier={1.2} adjustsFontSizeToFit minimumFontScale={.85} style={{color:c.minor,fontSize:10}}>{MAP_DATA_CREDIT}</Text></View>
    <View pointerEvents="none" style={[styles.scale,{bottom:bottomInset+8}]}><Text numberOfLines={1} maxFontSizeMultiplier={1.2} style={{color:c.text,fontSize:10,textAlign:'center'}}>{scaleMetres>=1000?`${scaleMetres/1000} km`:`${scaleMetres} m`}</Text><View style={{width:scaleMetres/metresPerPoint,height:5,borderColor:c.text,borderBottomWidth:1.5,borderLeftWidth:1.5,borderRightWidth:1.5}}/></View>
  </View>;
});
export default GameMap;
const styles=StyleSheet.create({
  root:{flex:1,overflow:'hidden'},car:{width:44,height:68,alignItems:'center',justifyContent:'center'},
  controls:{position:'absolute',right:12,gap:6,flexDirection:'column',zIndex:20,elevation:20},control:{width:44,height:44,borderRadius:22,borderCurve:'continuous',borderWidth:StyleSheet.hairlineWidth,alignItems:'center',justifyContent:'center',boxShadow:'0 2px 7px rgba(0,0,0,.12)'},controlSymbol:{fontSize:27,lineHeight:32},
  inspect:{position:'absolute',left:12,borderRadius:14,paddingHorizontal:10,paddingVertical:7},
  branchPanel:{position:'absolute',left:12,right:12,borderRadius:14,borderCurve:'continuous',borderWidth:StyleSheet.hairlineWidth,zIndex:21,elevation:21},branchChoices:{flexDirection:'row',padding:8,gap:8},choice:{flex:1,minWidth:0,minHeight:64,padding:8,gap:4,borderWidth:1.5,borderRadius:10,borderCurve:'continuous'},
  credit:{position:'absolute',left:10,right:115},
  scale:{position:'absolute',right:12,alignItems:'center',gap:2},loading:{position:'absolute',left:12,borderRadius:14,paddingHorizontal:12,paddingVertical:8,zIndex:10},
  demandBadge:{paddingHorizontal:9,paddingVertical:5,borderRadius:15,borderCurve:'continuous',flexDirection:'row',gap:3,alignItems:'center',boxShadow:'0 1px 4px rgba(0,0,0,.12)'},
  targetBadge:{maxWidth:150,borderWidth:1.5,borderRadius:14,borderCurve:'continuous',paddingHorizontal:9,paddingVertical:6},
  cruiseCapsule:{flexDirection:'row',alignItems:'center',gap:12,padding:6,paddingLeft:12,borderRadius:28,borderCurve:'continuous',borderWidth:1,boxShadow:'0 3px 12px rgba(0,0,0,.18)'},
  cruiseGo:{minWidth:58,height:44,borderRadius:22,borderCurve:'continuous',alignItems:'center',justifyContent:'center',paddingHorizontal:12},
});

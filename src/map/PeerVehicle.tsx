import React, { memo, useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { LocalizedText as Text, t, useLocale } from '../i18n';
import { Marker, type MarkerProps } from '@maplibre/maplibre-react-native';
import Animated, { Easing, useAnimatedProps, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import type { Coordinate, VehicleId } from '../game/types';
import { VehicleMarker } from './VehicleMarker';
import { queueVehicleScale, vehicleMarkerScale } from './mapScale';

/** Presentation data only. The multiplayer authority owns these positions. */
export interface MapPeer {
  id: string;
  name: string;
  color: string;
  position: Coordinate & { heading?: number };
  vehicleId?: VehicleId;
  route?: Coordinate[];
  connected?: boolean;
  /** Short localized driving/order phase; long trip details stay in the room. */
  statusLabel?: string;
  tripLabel?: string;
}

/** Background queue cars only. Real room drivers are rendered as MapPeer. */
export interface MapQueueVehicle { id: string; position: Coordinate & { heading: number }; vehicleId?: VehicleId }

const AnimatedMarker = Animated.createAnimatedComponent(Marker);
export const validPeerCoordinate = (point: Coordinate) => Number.isFinite(point?.lat) && Number.isFinite(point?.lon) && Math.abs(point.lat) <= 90 && Math.abs(point.lon) <= 180;
export const peerColor = (value: string) => /^#[0-9a-f]{6}$/i.test(value) ? value : '#AB85EB';

export const PeerVehicle = memo(function PeerVehicle({ peer, bearing, zoom, dark, reduced, intervalMs }: { peer: MapPeer; bearing: SharedValue<number>; zoom: SharedValue<number>; dark: boolean; reduced: boolean; intervalMs: number }) {
  const lon = useSharedValue(peer.position.lon), lat = useSharedValue(peer.position.lat);
  const heading = useSharedValue(Number.isFinite(peer.position.heading) ? peer.position.heading! : 0);
  const lastUpdate = useRef(Date.now());
  useEffect(() => {
    const now = Date.now(), duration = reduced ? 0 : Math.min(1800, Math.max(120, intervalMs, now - lastUpdate.current));
    lastUpdate.current = now;
    lon.set(withTiming(peer.position.lon, { duration, easing: Easing.linear }));
    lat.set(withTiming(peer.position.lat, { duration, easing: Easing.linear }));
    if (Number.isFinite(peer.position.heading)) {
      const current = heading.get(), delta = ((peer.position.heading! - current + 540) % 360) - 180;
      heading.set(withTiming(current + delta, { duration, easing: Easing.linear }));
    }
  }, [peer.position.lat, peer.position.lon, peer.position.heading, reduced, intervalMs]);
  const markerProps = useAnimatedProps<MarkerProps>(() => ({ lngLat: [lon.get(), lat.get()] }));
  const rotation = useAnimatedStyle(() => ({ transform: [{ rotate: `${heading.get() - bearing.get()}deg` }, { scale: .75 * vehicleMarkerScale(zoom.get()) }] }));
  const color = peerColor(peer.color), name = peer.name.trim().slice(0, 24) || '同行司機';
  const status=peer.connected===false?'已離線':peer.statusLabel||'巡遊';
  useLocale();
  return <AnimatedMarker id={`peer-${peer.id}`} lngLat={[peer.position.lon, peer.position.lat]} animatedProps={markerProps} offset={[0, -16]}>
    <View testID={`map-peer-${peer.id}`} accessibilityLabel={`${name}，${t(status)}${peer.tripLabel?`，${peer.tripLabel}`:''}`} pointerEvents="none" style={[styles.frame, { opacity: peer.connected === false ? .45 : 1 }]}>
      <View style={[styles.name, { backgroundColor: dark ? '#30383E' : '#FFFFFF', borderColor: color }]}><View style={[styles.dot, { backgroundColor: color }]}/><Text translate={false} numberOfLines={1} maxFontSizeMultiplier={1.3} style={[styles.nameText, { color: dark ? '#F3F6FA' : '#17202B' }]}>{name}</Text><Text numberOfLines={1} maxFontSizeMultiplier={1.2} style={{fontSize:9,fontWeight:'600',color:dark?'#C9D1D9':'#4E5A64'}}>{status}</Text></View>
      <View style={[styles.halo, { borderColor: color, backgroundColor: `${color}22` }]}/>
      <Animated.View style={[styles.car, rotation]}><VehicleMarker vehicleId={peer.vehicleId || 'kam-fung'} dark={dark}/></Animated.View>
    </View>
  </AnimatedMarker>;
});

export const QueueVehicle = memo(function QueueVehicle({ vehicle, bearing, zoom, dark, reduced, intervalMs, fallbackVehicleId }: { vehicle: MapQueueVehicle; bearing: SharedValue<number>; zoom: SharedValue<number>; dark: boolean; reduced: boolean; intervalMs: number; fallbackVehicleId: VehicleId }) {
  const position=vehicle.position;
  const lon=useSharedValue(position.lon),lat=useSharedValue(position.lat),heading=useSharedValue(position.heading);
  useEffect(()=>{
    const duration=reduced?0:intervalMs;
    lon.set(withTiming(position.lon,{duration,easing:Easing.linear}));
    lat.set(withTiming(position.lat,{duration,easing:Easing.linear}));
    const current=heading.get(),delta=((position.heading-current+540)%360)-180;
    heading.set(withTiming(current+delta,{duration,easing:Easing.linear}));
  },[position.lat,position.lon,position.heading,reduced,intervalMs]);
  const markerProps=useAnimatedProps<MarkerProps>(()=>({lngLat:[lon.get(),lat.get()]}));
  const transform=useAnimatedStyle(()=>({transform:[{rotate:`${heading.get()-bearing.get()}deg`},{scale:queueVehicleScale(zoom.get(),lat.get())}]}));
  return <AnimatedMarker id={`queue-${vehicle.id}`} lngLat={[position.lon,position.lat]} animatedProps={markerProps}>
    <Animated.View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none" style={[{width:44,height:68},transform]}><VehicleMarker vehicleId={vehicle.vehicleId||fallbackVehicleId} dark={dark}/></Animated.View>
  </AnimatedMarker>;
});

const styles = StyleSheet.create({
  frame: { width: 120, height: 108 },
  name: { position: 'absolute', top: 4, left: 0, right: 0, height: 26, borderRadius: 13, borderWidth: 1.5, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 7, gap: 4 },
  nameText: { flex: 1, fontSize: 11, fontWeight: '600' },
  dot: { width: 6, height: 6, borderRadius: 3 },
  halo: { position: 'absolute', left: 39, top: 49, width: 42, height: 42, borderRadius: 21, borderWidth: 2 },
  car: { position: 'absolute', left: 38, top: 36, width: 44, height: 68 },
});

import { LocalizedText as Text, LocalizedPressable as Pressable, LocalizedTextInput as TextInput, t, useLocale, getLocalizedPlaceName, getLocalizedLocality, normalizeSearchText } from '../i18n';
import React, { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useGame } from '../GameProvider';
import { LANDMARKS, nearestNode, type Coordinate, type Landmark } from '../game';
import { ROAD_GRAPH } from '../map/roadGraph';
import { getVehicleRoadGraph, isPlaceAllowed } from '../data/vehicleAccess';
import { GameMap } from '../map/GameMap';
import type { RootStackParamList } from '../navigation';
import { Button, Icon } from './components';

const searchKey = normalizeSearchText;
const INDEX = LANDMARKS.map(place => ({ place, key: searchKey(`${place.name} ${place.nameEn ?? ''} ${place.district}`) }));
const POPULAR = ['harbour-city','sorrento','megabox','central','west-kowloon','langham','elements'];
export function StartLocationScreen({ navigation, route }: NativeStackScreenProps<RootStackParamList, 'StartLocation'>) {
  const locale = useLocale();
  const { colors: c, isDark, startPlace, setStartPlace, handoverPlace, setHandoverPlace, vehicleId } = useGame();
  const graph = useMemo(() => getVehicleRoadGraph(vehicleId), [vehicleId]);
  const forHandover = route.params?.purpose === 'handover';
  const selectedPlace = forHandover ? handoverPlace ?? startPlace : startPlace;
  useLayoutEffect(() => navigation.setOptions({ title: t(forHandover ? '交更地點' : '開工地點') }), [forHandover, navigation, locale]);
  const inset = useSafeAreaInsets();
  const list = useRef<FlatList<Landmark>>(null);
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [mapMode, setMapMode] = useState(false);
  const [candidate, setCandidate] = useState(selectedPlace);
  const results = useMemo(() => {
    const term = searchKey(deferredQuery);
    if (!term) {
      const popular = POPULAR.flatMap(id => LANDMARKS.find(place => place.id === id && isPlaceAllowed(place, vehicleId)) ?? []);
      return { places: [...popular, ...LANDMARKS.filter(place => !POPULAR.includes(place.id) && isPlaceAllowed(place, vehicleId)).slice(0, 33)], total: LANDMARKS.length };
    }
    const found = INDEX.filter(item => item.key.includes(term) && isPlaceAllowed(item.place, vehicleId));
    return { places: found.slice(0, 150).map(item => item.place), total: found.length };
  }, [deferredQuery, vehicleId]);
  useEffect(() => { list.current?.scrollToOffset({ offset: 0, animated: false }); }, [deferredQuery]);
  const select = (place: Landmark) => { (forHandover ? setHandoverPlace : setStartPlace)(place); navigation.goBack(); };
  const selectMapPoint = (coordinate: Coordinate) => {
    const node = nearestNode(coordinate, graph);
    const edge = graph.edges[graph.outgoing[node.id]?.[0]];
    setCandidate({ id: `custom:${node.id}`, name: `${node.name || edge?.name || '所選道路'}附近`, district: '地圖自選開工點', kind: 'transport', nodeId: node.id, lat: node.lat, lon: node.lon });
  };
  return <View style={{ flex: 1, backgroundColor: c.background }}>
    <View style={s.searchRow}>
      <View style={[s.searchBox, { backgroundColor: c.muted }]}><Icon name={{ ios: 'magnifyingglass', android: 'search' }} color={c.secondary} size={19}/><TextInput testID="start-place-search" accessibilityLabel="搜尋開工地點" value={query} onChangeText={text => { setQuery(text); setMapMode(false); }} clearButtonMode="while-editing" placeholder="屋苑、商場、村落、街道或英文名" placeholderTextColor={c.secondary} style={[s.input, { color: c.text }]} returnKeyType="search" autoCorrect={false} /></View>
      <Pressable accessibilityRole="button" testID="toggle-location-map" onPress={() => setMapMode(value => !value)} style={[s.mapButton, { backgroundColor: c.muted }]}><Icon name={{ ios: mapMode ? 'list.bullet' : 'map', android: mapMode ? 'list' : 'map' }} color={c.text}/></Pressable>
    </View>
    {mapMode ? <View style={{ flex: 1 }}>
      <GameMap roadGraph={graph} vehicleId={vehicleId} position={{ lat: candidate.lat, lon: candidate.lon }} lookahead={[]} branches={[]} dark={isDark} onBranch={() => {}} onSelectPlace={selectMapPoint} selectedPlace={candidate} planning={false} topInset={60} bottomInset={165 + inset.bottom}/>
      <View pointerEvents="none" style={[s.mapHint, { backgroundColor: c.surface }]}><Text style={{ color: c.text, fontSize: 14 }}>長按地圖揀{forHandover ? '交更' : '開工'}位置，再放大微調</Text></View>
      <View style={[s.mapSelection, { backgroundColor: c.surface, bottom: Math.max(inset.bottom, 16) }]}><Text numberOfLines={1} style={[s.name, { color: c.text }]}>{getLocalizedPlaceName(candidate)}</Text><Text style={[s.district, { color: c.secondary }]}>吸附至可行駛道路，作為所選地點</Text><Button title="用呢個位置" colors={c} testID="confirm-map-start" onPress={() => select(candidate)}/></View>
    </View> : <FlatList ref={list} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" data={results.places} keyExtractor={place => place.id} initialNumToRender={15} windowSize={7} contentContainerStyle={{ paddingBottom: inset.bottom + 20 }} ListHeaderComponent={<Text style={[s.count, { color: c.secondary }]}>{deferredQuery ? `搵到 ${results.total.toLocaleString('en-HK')} 個地點${results.total > 150 ? ' · 顯示首 150 個，輸入更多字可縮窄' : ''}` : `全港 ${LANDMARKS.length.toLocaleString('en-HK')} 個真實地點 · 常用地點`}</Text>} ListEmptyComponent={<Text style={[s.empty, { color: c.secondary }]}>未搵到呢個名稱，可以試英文名、區名，或用地圖選點。</Text>} renderItem={({ item }) => <Pressable testID={`start-place-${item.id}`} accessibilityRole="button" onPress={() => select(item)} style={({ pressed }) => [s.row, { borderBottomColor: c.line, backgroundColor: pressed ? c.muted : c.background }]}><View style={{ flex: 1, gap: 5 }}><Text style={[s.name, { color: c.text }]}>{getLocalizedPlaceName(item)}</Text><Text style={[s.district, { color: c.secondary }]}>{getLocalizedLocality(item)}{locale !== 'en' && item.nameEn ? ` · ${item.nameEn}` : ''}</Text></View>{item.id === selectedPlace.id && <Icon name={{ ios: 'checkmark', android: 'check' }} color={c.text} size={18}/>}</Pressable>} />}
  </View>;
}
const s = StyleSheet.create({ searchRow: { padding: 16, flexDirection: 'row', gap: 10 }, searchBox: { flex: 1, paddingLeft: 12, minHeight: 48, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 8 }, input: { flex: 1, fontSize: 15, minHeight: 48, paddingRight: 10 }, mapButton: { width: 48, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }, count: { fontSize: 12, paddingHorizontal: 20, paddingBottom: 12, lineHeight: 18 }, row: { minHeight: 72, paddingVertical: 14, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth }, name: { fontSize: 17, fontWeight: '500' }, district: { fontSize: 12, lineHeight: 18 }, empty: { padding: 24, fontSize: 15, lineHeight: 24 }, mapHint: { position: 'absolute', top: 8, left: 16, right: 16, borderRadius: 12, padding: 12 }, mapSelection: { position: 'absolute', left: 16, right: 16, padding: 16, gap: 10, borderRadius: 16 } });

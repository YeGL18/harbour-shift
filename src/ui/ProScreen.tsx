import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Alert, StyleSheet, useWindowDimensions, View} from 'react-native';
import {useGame} from '../GameProvider';
import {useMultiplayer} from '../MultiplayerProvider';
import {LocalizedText as Text, LocalizedPressable as Pressable, LocalizedTextInput as TextInput, getLocalizedPlaceName, t, useLocale} from '../i18n';
import {PRO_API, PRO_TIER_ENGLISH_NAME, PRO_TIER_NAME, activeProPack, proActivationBlock, proDestinationAllowance, type PremiumProTier, type ProStatus, type ProTier} from '../../shared/pro';
import {request} from '../multiplayer/transport';
import {MULTIPLAYER_BASE_URL} from '../multiplayer/config';
import {LANDMARKS, LANDMARK_BY_ID} from '../data/landmarks';
import {getVehicleRoadGraph} from '../data/vehicleAccess';
import {Button, Icon} from './components';
import {Group, MultiplayerPage, StatusMessage, SupportingText} from './multiplayerParts';

const benefits: Record<PremiumProTier, string> = {
  gold: '額外目的地',
  platinum: '額外目的地 · 優先派單',
  diamond: '額外目的地 · 優先派單 · 機場優先',
};
const selectableTiers = ['gold','platinum','diamond'] as const;
type ProScope = 'solo' | 'online';

function tierLabel(tier: ProTier, english: boolean) {
  const name = PRO_TIER_ENGLISH_NAME[tier];
  return english ? name : `${t(PRO_TIER_NAME[tier])} · ${name}`;
}

export function ProScreen() {
  const controller = useGame();
  const mp = useMultiplayer();
  const {colors:c, game} = controller;
  const english = useLocale() === 'en';
  const {fontScale} = useWindowDimensions();
  const [mode, setMode] = useState<ProScope>(controller.online || mp.hasSession ? 'online' : 'solo');
  const [onlineStatus, setOnlineStatus] = useState<ProStatus|null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const inFlight = useRef(false);
  const trialIntents = useRef<Partial<Record<PremiumProTier,string>>>({});

  async function call<T>(path: string, body?: unknown) {
    const account = await mp.ensureTrainingAccount();
    return request<T>(MULTIPLAYER_BASE_URL, path, body, account.driverToken);
  }
  async function loadOnline() {
    setBusy(true);
    setError('');
    try { setOnlineStatus(await call<ProStatus>(PRO_API.status)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '未能完成操作，請重試。'); }
    finally { setBusy(false); }
  }
  useEffect(() => { if (mode === 'online') void loadOnline(); }, [mode]);

  const packs = mode === 'solo' ? mp.soloPro.packs : onlineStatus?.packs ?? [];
  const active = activeProPack(packs);
  const currentTier = active?.tier ?? 'blue';
  const locked = !mp.hydrated || busy || mp.soloProPending || (mode === 'online' && !onlineStatus?.trialAvailable);

  async function activate(tier: PremiumProTier) {
    if (inFlight.current || locked || proActivationBlock(tier, packs)) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      if (mode === 'solo') await mp.activateSoloPro(tier);
      else {
        const requestId = trialIntents.current[tier] ?? `trial-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        trialIntents.current[tier] = requestId;
        setOnlineStatus(await call<ProStatus>(PRO_API.trial, {tier, requestId}));
        delete trialIntents.current[tier];
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '未能完成操作，請重試。');
    } finally {
      setBusy(false);
      inFlight.current = false;
    }
  }

  function chooseTier(tier: PremiumProTier) {
    if (!active) { void activate(tier); return; }
    Alert.alert(t('確認升級'), t('升級會取代原有剩餘更次。'), [
      {text:t('取消'),style:'cancel'},
      {text:t('升級'),onPress:() => void activate(tier)},
    ]);
  }

  const destination = game?.proDestination && game.proDestination.expiresAt > game.clockMinutes
    ? LANDMARK_BY_ID.get(game.proDestination.placeId) : undefined;
  const destinationsLeft = game ? Math.max(0, proDestinationAllowance(game.proTier) - (game.proDestinationsUsed ?? 0)) : 0;
  const graph = useMemo(() => game ? getVehicleRoadGraph(game.vehicleId) : undefined, [game?.vehicleId]);
  const results = useMemo(() => {
    const key = query.trim().toLocaleLowerCase();
    return key.length >= 2 && graph
      ? LANDMARKS.filter(place => !!place.nodeId && !!graph.nodes[place.nodeId]
        && `${place.name} ${place.nameEn ?? ''}`.toLocaleLowerCase().includes(key)).slice(0,10)
      : [];
  }, [query,graph]);
  const showShift = game && game.phase !== 'ended' && game.advancedRulesVersion === 1
    && mode === (controller.online ? 'online' : 'solo');

  return <MultiplayerPage colors={c} keyboard>
    <View accessibilityRole="radiogroup" style={[s.segment,{backgroundColor:c.muted}]}>
      {(['solo','online'] as const).map(value =>
        <Pressable key={value} accessibilityRole="radio" accessibilityState={{checked:mode === value,disabled:busy}}
          disabled={busy} onPress={() => {setMode(value);setError('');}} style={[s.tab, mode === value && {backgroundColor:c.surface}]}>
          <Text style={[s.tabText,{color:c.text}]}>{value === 'solo' ? '單人' : '多人'}</Text>
        </Pressable>)}
    </View>
    <SupportingText colors={c}>{mode === 'solo' ? '單人權益保存在這部機。' : '多人權益跟司機帳號。'}</SupportingText>

    <Group colors={c} style={s.group}>
      <Text style={[s.tag,{color:c.secondary}]}>目前級別</Text>
      <Text testID="pro-current-tier" translate={false} style={[s.current,{color:c.text}]}>{tierLabel(currentTier,english)}</Text>
      {active ? <Text style={[s.text,{color:c.secondary}]}>{`尚餘 ${active.remaining} 更`}</Text> : null}
      {game && game.phase !== 'ended' && showShift && game.proTier !== currentTier
        ? <SupportingText colors={c}>新級別下一更生效。</SupportingText> : null}
    </Group>

    <Group colors={c} style={s.group}>
      <Text accessibilityRole="header" style={[s.heading,{color:c.text}]}>七更免費試玩</Text>
      {selectableTiers.map((tier,index) => {
        const block = proActivationBlock(tier,packs);
        const title = block === 'same-tier' ? '使用中' : block === 'downgrade' ? '暫不可選' : active ? '升級' : '啟用';
        return <View key={tier} style={[s.tierRow,fontScale > 1.3 && s.stacked,index > 0 && {borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:c.line}]}>
          <View style={s.tierText}>
            <Text translate={false} style={[s.heading,{color:c.text}]}>{tierLabel(tier,english)}</Text>
            <Text style={[s.detail,{color:c.secondary}]}>{benefits[tier]}</Text>
          </View>
          <Pressable testID={`activate-pro-${tier}`} accessibilityRole="button"
            accessibilityLabel={`${tierLabel(tier,english)} · ${t(title)}`} translate={false}
            accessibilityState={{disabled:locked||!!block}} disabled={locked||!!block} onPress={() => chooseTier(tier)}
            style={[s.tierAction,{backgroundColor:c.muted}]}>
            <Text style={[s.actionText,{color:locked||block?c.secondary:c.text}]}>{title}</Text>
          </Pressable>
        </View>;
      })}
    </Group>
    {mode === 'online' && !busy && onlineStatus && !onlineStatus.trialAvailable
      ? <StatusMessage colors={c} title="線上試玩暫未開放。"/> : null}

    {showShift ? <Group colors={c} style={s.group}>
      <Text accessibilityRole="header" style={[s.heading,{color:c.text}]}>本更目的地篩選</Text>
      <Text style={[s.detail,{color:c.secondary}]}>{`尚餘 ${destinationsLeft} 次`}</Text>
      {destination ? <View style={s.target}>
        <Icon name={{ios:'location.fill',android:'location_on'}} size={18} color={c.blue}/>
        <Text translate={false} style={[s.text,{color:c.text,flex:1}]}>{getLocalizedPlaceName(destination)}</Text>
      </View> : null}
      {destinationsLeft > 0 ? <TextInput testID="pro-destination-search" accessibilityLabel="搜尋目的地篩選" value={query}
        onChangeText={setQuery} placeholder="搜尋地點" placeholderTextColor={c.secondary} style={[s.search,{backgroundColor:c.muted,color:c.text}]}/> : null}
      {results.map(place => <Pressable key={place.id} accessibilityRole="button" disabled={!!mp.pending||destinationsLeft===0}
        onPress={() => {controller.proDestination(place.id);setQuery('');}} style={[s.result,{borderBottomColor:c.line}]}>
        <Text translate={false} style={[s.text,{color:c.text}]}>{getLocalizedPlaceName(place)}</Text>
      </Pressable>)}
      {destination ? <Button title="清除目的地篩選" colors={c} secondary disabled={!!mp.pending} onPress={() => controller.proDestination()}/> : null}
    </Group> : null}
    {controller.proSettlementRequired ? <StatusMessage colors={c} title="權益使用紀錄尚未儲存，請重試。" actionTitle="重試"
      action={() => void controller.retryProSettlement().catch(cause => setError(String(cause)))}/> : null}
    {error ? <StatusMessage colors={c} title="操作未完成" detail={error}
      actionTitle={mode === 'online' ? '重試' : undefined} action={mode === 'online' ? () => void loadOnline() : undefined}/> : null}
  </MultiplayerPage>;
}

const s = StyleSheet.create({
  segment:{flexDirection:'row',padding:4,gap:4,borderRadius:16,borderCurve:'continuous'},
  tab:{flex:1,minHeight:52,borderRadius:12,borderCurve:'continuous',paddingHorizontal:8,alignItems:'center',justifyContent:'center'},
  tabText:{fontSize:17,fontWeight:'600'},
  group:{padding:16,gap:8,borderRadius:18},
  tag:{fontSize:14,fontWeight:'600'},
  current:{fontSize:24,fontWeight:'700'},
  heading:{fontSize:17,fontWeight:'600'},
  text:{fontSize:16,fontVariant:['tabular-nums']},
  detail:{fontSize:14,lineHeight:20},
  tierRow:{flexDirection:'row',alignItems:'center',gap:12,minHeight:68,paddingVertical:8},
  stacked:{flexDirection:'column',alignItems:'stretch'},
  tierText:{flex:1,gap:4},
  tierAction:{minHeight:48,minWidth:80,paddingHorizontal:12,paddingVertical:10,borderRadius:12,borderCurve:'continuous',alignItems:'center',justifyContent:'center'},
  actionText:{fontSize:16,fontWeight:'600',textAlign:'center'},
  target:{flexDirection:'row',gap:8,alignItems:'center',minHeight:44},
  search:{minHeight:52,padding:12,fontSize:16,borderRadius:12,borderCurve:'continuous'},
  result:{minHeight:48,paddingVertical:10,justifyContent:'center',borderBottomWidth:StyleSheet.hairlineWidth},
});


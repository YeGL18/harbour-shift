import React, { useLayoutEffect, useState } from 'react';
import { Linking, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { sounds } from '../audio/sounds';
import { LocalizedText as Text, LocalizedPressable as Pressable, LocalizedSwitch as Switch, useLocale, LOCALES, setLocale } from '../i18n';
import { useMultiplayer } from '../MultiplayerProvider';
import { useGame } from '../GameProvider';
import type { RootStackParamList } from '../navigation';
import { Button, Icon } from './components';
import type { Appearance, Palette } from './theme';
import { version as appVersion } from '../../package.json';
import { ROOM_SPEEDS } from '../../shared/protocol';

function SettingsSwitch({ title, value, onChange, colors: c, testID }: {
  title: string; value: boolean; onChange: (value: boolean) => void; colors: Palette; testID: string;
}) {
  return <View style={[s.row, { backgroundColor: c.surface }]}>
    <Text style={[s.rowText, { color: c.text }]}>{title}</Text>
    <Switch testID={testID} accessibilityLabel={title} value={value} onValueChange={onChange}
      trackColor={{ false: c.line, true: c.blue }} style={s.switch} />
  </View>;
}

function Segmented<T extends string | number>({ options, value, onChange, colors: c, disabled = false, stacked = false }: {
  options: readonly { value: T; label: string }[]; value: T; onChange: (value: T) => void; colors: Palette;
  disabled?: boolean; stacked?: boolean;
}) {
  return <View accessibilityRole="radiogroup" style={[s.segment, stacked && s.stacked, { backgroundColor: c.muted }]}>
    {options.map(item => <Pressable accessibilityRole="radio" accessibilityState={{ checked: item.value === value, disabled }}
      key={item.value} disabled={disabled} onPress={() => {
        if (item.value === value) return;
        sounds.playCue('select');
        onChange(item.value);
      }} style={[s.option, !stacked && s.inlineOption, item.value === value && { backgroundColor: c.surface }]}>
      <Text style={[s.optionText, { color: disabled ? c.secondary : c.text }]}>{item.label}</Text>
    </Pressable>)}
  </View>;
}

const appearanceOptions: readonly { value: Appearance; label: string }[] = [
  {value:'system',label:'跟隨系統'}, {value:'light',label:'淺色'}, {value:'dark',label:'深色'},
];
const speedOptions = ROOM_SPEEDS.map(value => ({value, label: `${value}×`}));
const densityOptions = [{value:'normal',label:'一般'}, {value:'busy',label:'繁忙'}] as const;

export function SettingsScreen({ navigation }: NativeStackScreenProps<RootStackParamList, 'Settings'>) {
  const locale = useLocale();
  const mp = useMultiplayer();
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  const [languagePending, setLanguagePending] = useState(false);
  const [languageError, setLanguageError] = useState('');
  const [showRules, setShowRules] = useState(false);
  const { colors: c, appearance, setAppearance, speed, setSpeed, game, setPaused, density, setDensity, soundEnabled, setSoundEnabled, showFullTripRoute, setShowFullTripRoute } = useGame();
  async function changeLanguage(value: typeof locale) {
    if (languagePending || value === locale) return;
    sounds.playCue('select');
    setLanguagePending(true);
    setLanguageError('');
    try { await setLocale(value); }
    catch { setLanguageError('未能儲存語言設定，請重試。'); }
    finally { setLanguagePending(false); }
  }
  useLayoutEffect(() => navigation.setOptions({
    headerRight: () => <Pressable accessibilityRole="button" style={s.headerButton} onPress={() => navigation.goBack()}>
      <Text style={{ color: c.text, fontSize: 17, fontWeight: '600' }}>完成</Text>
    </Pressable>,
  }), [c, navigation, locale]);

  return <ScrollView testID="settings-sheet" contentInsetAdjustmentBehavior="automatic"
    style={{ flex: 1, backgroundColor: c.background }} contentContainerStyle={[s.content, {paddingBottom: Math.max(24, insets.bottom + 12)}]}>
    <View style={s.section}>
      <Text accessibilityRole="header" style={[s.label, {color:c.secondary}]}>外觀</Text>
      <Segmented options={appearanceOptions} value={appearance} onChange={setAppearance} colors={c} stacked={fontScale > 1.5}/>
      <SettingsSwitch testID="sound-enabled" title="遊戲音效" value={soundEnabled} onChange={setSoundEnabled} colors={c}/>
      <SettingsSwitch testID="show-full-trip-route" title="顯示完整剩餘路線" value={showFullTripRoute} onChange={setShowFullTripRoute} colors={c}/>
    </View>

    <View style={s.section}>
      <Text accessibilityRole="header" style={[s.label, {color:c.secondary}]}>行車速度</Text>
      <Segmented options={speedOptions} value={speed} onChange={setSpeed} colors={c} disabled={!!mp.snapshot} stacked={fontScale>1.5}/>
      <Text accessibilityRole="header" style={[s.label, {color:c.secondary}]}>下一更需求密度</Text>
      <Segmented options={densityOptions} value={density} onChange={setDensity} colors={c} disabled={!!mp.snapshot}/>
      {mp.snapshot ? <Text style={[s.help, {color:c.secondary}]}>多人由房主設定</Text> : null}
    </View>

    <View style={s.section}>
      <Text accessibilityRole="header" style={[s.label, {color:c.secondary}]}>語言</Text>
      <View accessibilityRole="radiogroup" style={[s.languages, {backgroundColor:c.surface}]}>
        {LOCALES.map((item, index) => <Pressable key={item.value} testID={`language-${item.value}`}
          accessibilityRole="radio" accessibilityState={{ checked: locale === item.value, disabled: languagePending }}
          disabled={languagePending} onPress={() => void changeLanguage(item.value)}
          style={[s.language, index > 0 && {borderTopWidth:StyleSheet.hairlineWidth, borderTopColor:c.line}]}>
          <Text translate={false} style={[s.rowText, {color:c.text}]}>{item.label}</Text>
          {locale === item.value && <Icon name={{ios:'checkmark',android:'check'}} size={19} color={c.blue}/>}
        </Pressable>)}
      </View>
      {languageError ? <Text accessibilityLiveRegion="polite" style={[s.help, {color:c.secondary}]}>{languageError}</Text> : null}
    </View>

    <View style={s.section}>
      <Pressable accessibilityRole="button" accessibilityState={{expanded:showRules}}
        onPress={() => setShowRules(value => !value)} style={[s.row, {backgroundColor:c.surface}]}>
        <Text style={[s.rowText, {color:c.text}]}>玩法與資料</Text>
        <Icon name={{ios:showRules?'chevron.up':'chevron.down',android:showRules?'expand_less':'expand_more'}} size={18} color={c.secondary}/>
      </Pressable>
      {showRules && <View style={[s.details, {backgroundColor:c.surface}]}>
        <Text style={[s.help, {color:c.secondary}]}>新單有現實五秒接單。單人離開行車畫面會暫停。</Text>
        <Text style={[s.help, {color:c.secondary}]}>夠鐘時已在排隊或補給，會等完成再標記遲到。</Text>
        <Text style={[s.help, {color:c.secondary}]}>道路同地點資料來自運輸署及地政總署。© 香港政府。</Text>
        <Pressable accessibilityRole="link" onPress={() => void Linking.openURL('https://www.uber.com/hk/zh-hk/blog/driver-fare-taxi/')} style={s.link}>
          <Text style={{color:c.blue,fontSize:16}}>查看的士收入資料</Text>
        </Pressable>
        <Pressable accessibilityRole="link" onPress={() => void Linking.openURL('https://www.uber.com/hk/zh-hk/blog/driver-fare/')} style={s.link}>
          <Text style={{color:c.blue,fontSize:16}}>查看私家車收入資料</Text>
        </Pressable>
      </View>}
      <Text translate={false} style={[s.help, {color:c.secondary}]}>{appVersion}</Text>
    </View>

    {game && game.phase !== 'ended' && <Button title={mp.snapshot ? '返回房間' : '暫停，返回車房'} colors={c} secondary
      onPress={() => {
        if (mp.snapshot) navigation.navigate('Room');
        else { setPaused(true); navigation.reset({ index: 0, routes: [{ name: 'Garage' }] }); }
      }}/>}
  </ScrollView>;
}

const s = StyleSheet.create({
  content:{padding:20,gap:24},
  section:{gap:8},
  label:{fontSize:14,fontWeight:'600',marginHorizontal:4},
  row:{minHeight:64,paddingHorizontal:16,paddingVertical:10,borderRadius:18,borderCurve:'continuous',flexDirection:'row',alignItems:'center',gap:14},
  rowText:{flex:1,fontSize:17,fontWeight:'500'},
  switch:{minHeight:44},
  segment:{flexDirection:'row',padding:4,gap:4,borderRadius:17,borderCurve:'continuous'},
  stacked:{flexDirection:'column'},
  inlineOption:{flex:1},
  option:{minHeight:52,paddingHorizontal:8,paddingVertical:8,borderRadius:13,borderCurve:'continuous',alignItems:'center',justifyContent:'center'},
  optionText:{fontSize:16,fontWeight:'600',textAlign:'center'},
  languages:{borderRadius:18,borderCurve:'continuous',overflow:'hidden'},
  language:{minHeight:60,paddingHorizontal:16,paddingVertical:10,flexDirection:'row',alignItems:'center',gap:12},
  details:{padding:16,gap:10,borderRadius:18,borderCurve:'continuous'},
  headerButton:{minHeight:44,paddingHorizontal:6,justifyContent:'center'},
  help:{fontSize:14,lineHeight:21},
  link:{minHeight:44,justifyContent:'center'},
});


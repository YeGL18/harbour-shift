import React, {useEffect, useState} from 'react';
import {Modal, ScrollView, StyleSheet, View} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {LocalizedText as Text} from '../i18n';
import {Button} from './components';
import {releaseHighlights} from './releaseNotes';
import type {Palette} from './theme';
import {version} from '../../package.json';

const RELEASE_SEEN_KEY = 'harbour-shift.release-notes.seen';

export function ReleaseNotesDialog({eligible, radius, colors:c}: {eligible:boolean;radius:number;colors:Palette}) {
  const [seen, setSeen] = useState<string | null>();
  const insets = useSafeAreaInsets();
  useEffect(() => {
    let mounted = true;
    void AsyncStorage.getItem(RELEASE_SEEN_KEY).then(
      value => { if(mounted) setSeen(value); },
      () => { if(mounted) setSeen(null); },
    );
    return () => { mounted = false; };
  }, []);
  const items = releaseHighlights(version, seen);
  if (!eligible || seen === undefined || items.length === 0) return null;

  function dismiss() {
    setSeen(version);
    void AsyncStorage.setItem(RELEASE_SEEN_KEY,version).catch(() => {});
  }
  return <Modal animationType="fade" transparent onRequestClose={dismiss} statusBarTranslucent>
    <View style={[s.backdrop,{paddingTop:insets.top+12}]}>
      <View testID="release-notes-dialog" accessibilityViewIsModal style={[
        s.sheet,{backgroundColor:c.surface,borderTopLeftRadius:radius,borderTopRightRadius:radius,
          paddingBottom:Math.max(insets.bottom,18)},
      ]}>
        <ScrollView style={s.scroll} contentContainerStyle={s.content} bounces={false}>
          <Text translate={false} style={[s.version,{color:c.secondary}]}>{version}</Text>
          <Text accessibilityRole="header" style={[s.title,{color:c.text}]}>今次更新</Text>
          {items.map(item => <View key={item} style={s.item}>
            <View accessible={false} style={[s.dot,{backgroundColor:c.blue}]}/>
            <Text style={[s.text,{color:c.text}]}>{item}</Text>
          </View>)}
        </ScrollView>
        <Button testID="dismiss-release-notes" title="知道喇" colors={c} onPress={dismiss} style={s.action}/>
      </View>
    </View>
  </Modal>;
}
const s = StyleSheet.create({
  backdrop:{flex:1,justifyContent:'flex-end',backgroundColor:'rgba(0,0,0,0.44)'},
  sheet:{paddingHorizontal:24,paddingTop:24,gap:16,maxHeight:'100%',borderCurve:'continuous'},
  scroll:{flexShrink:1},
  content:{gap:12},
  version:{fontSize:14,fontVariant:['tabular-nums'],fontWeight:'600'},
  title:{fontSize:26,fontWeight:'700',marginBottom:4},
  item:{flexDirection:'row',gap:10,alignItems:'flex-start'},
  dot:{width:6,height:6,borderRadius:3,marginTop:9},
  text:{flex:1,fontSize:16,lineHeight:24},
  action:{borderRadius:18},
});


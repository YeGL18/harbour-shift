import React, {useRef} from 'react';
import {Alert} from 'react-native';
import {t,useLocale} from '../i18n';
import {useMultiplayer} from '../MultiplayerProvider';
import type {Palette} from './theme';
import {StatusMessage,useNetworkTask} from './multiplayerParts';

/** Recovery remains available before any authoritative snapshot has arrived. */
export function RestoreRoomExit({colors,onLeft}:{colors:Palette;onLeft:()=>void}){
  useLocale();
  const mp=useMultiplayer(),task=useNetworkTask(),latest=useRef(mp);latest.current=mp;
  if(!mp.hasSession||mp.snapshot)return null;
  const leave=()=>{void task.run('restore-leave',()=>{latest.current.clearError();return latest.current.leaveRoom();},onLeft);};
  const confirm=()=>{
    if(task.busy)return;
    Alert.alert(t('離開已儲存房間？'),t('單人存檔會保留。若比賽已開始，其他玩家會繼續，伺服器會按斷線規則處理你今場嘅參與。'),[{text:t('繼續重連'),style:'cancel'},{text:t('離開房間，返回單人'),style:'destructive',onPress:leave}]);
  };
  return <StatusMessage testID="restore-room-exit" colors={colors} title={task.busy?'離開中…':'房間連線未恢復'} detail={task.error??mp.error??'可以等候重連，或離開房間返回單人模式。'} action={task.busy?undefined:confirm} actionTitle="離開房間，返回單人"/>;
}

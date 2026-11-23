import 'react-native-gesture-handler';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, DarkTheme, DefaultTheme, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { MultiplayerProvider } from './src/MultiplayerProvider';
import { initializeLocale, t, useLocale, useLocaleReady } from './src/i18n';
import {TrainingScreen} from './src/ui/TrainingScreen';
import {ProScreen} from './src/ui/ProScreen';
import {EliteScreen} from './src/ui/EliteScreen';
import {IconButton} from './src/ui/components';
import {ReleaseNotesDialog} from './src/ui/ReleaseNotesDialog';
import {useScreenCorners} from './src/map/useScreenCorners';
import { ProfileScreen } from './src/ui/ProfileScreen';
import { MultiplayerLobbyScreen } from './src/ui/MultiplayerLobbyScreen';
import { RoomScreen } from './src/ui/RoomScreen';
import { RoomSetupScreen } from './src/ui/RoomSetupScreen';
import { LeaderboardScreen } from './src/ui/LeaderboardScreen';
import { GameProvider, useGame } from './src/GameProvider';
import { GarageScreen } from './src/ui/GarageScreen';
import { ShiftScreen } from './src/ui/ShiftScreen';
import { SummaryScreen } from './src/ui/SummaryScreen';
import { SettingsScreen } from './src/ui/SettingsScreen';
import { StartLocationScreen } from './src/ui/StartLocationScreen';
import { OrderFeedScreen } from './src/ui/OrderFeedScreen';
import { StationsScreen } from './src/ui/StationsScreen';
import { OperationsScreen } from './src/ui/OperationsScreen';
import type { RootStackParamList } from './src/navigation';
import {GameEffects} from './src/audio/GameEffects';

const Stack = createNativeStackNavigator<RootStackParamList>();
function Navigation() {
  const { colors: c, isDark, hydrated } = useGame();
  const corners = useScreenCorners();
  const sheetCornerRadius = Math.round(Math.min(56, Math.max(32, corners.topLeft, corners.topRight)));
  const navRef=useMemo(()=>createNavigationContainerRef<RootStackParamList>(),[]);
  const [routeName,setRouteName]=useState('Garage');
  const syncRoute=()=>setRouteName(navRef.getCurrentRoute()?.name??'Garage');
  useLocale();
  const ready = useLocaleReady();
  useEffect(() => { void initializeLocale(); }, []);
  if (!ready) return <View style={{ flex: 1, backgroundColor: c.background, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={c.text}/></View>;
  const base = isDark ? DarkTheme : DefaultTheme;
  return <><NavigationContainer ref={navRef} onReady={syncRoute} onStateChange={syncRoute} theme={{ ...base, colors: { ...base.colors, primary: c.text, background: c.background, card: c.surface, text: c.text, border: c.line } }}>
    <StatusBar style={isDark ? 'light' : 'dark'} />
    <Stack.Navigator screenOptions={{ headerTintColor: c.text, headerStyle: { backgroundColor: c.background }, contentStyle: { backgroundColor: c.background }, headerShadowVisible: false, statusBarStyle: isDark ? 'light' : 'dark' }}>
      <Stack.Screen name="Garage" component={GarageScreen} options={{ title: t('港更'), headerLargeTitle: true, headerLargeTitleStyle: { fontWeight: '700' } }} />
      <Stack.Screen name="StartLocation" component={StartLocationScreen} options={{ title: t('開工地點') }} />
      <Stack.Screen name="OrderFeed" component={OrderFeedScreen} options={{ title: t('附近單'), presentation: 'formSheet', sheetAllowedDetents: [.7, 1], sheetGrabberVisible: true, sheetCornerRadius }} />
      <Stack.Screen name="Stations" component={StationsScreen} options={{ title: t('能源補給'), presentation: 'formSheet', sheetAllowedDetents: [.8, 1], sheetGrabberVisible: true, sheetCornerRadius }} />
      <Stack.Screen name="Operations" component={OperationsScreen} options={{ title: t('本更安排'), presentation: 'formSheet', sheetAllowedDetents: [.8, 1], sheetGrabberVisible: true, sheetCornerRadius }} />
      <Stack.Screen name="Shift" component={ShiftScreen} options={{ headerShown: false, gestureEnabled: false }} />
      <Stack.Screen name="Summary" component={SummaryScreen} options={{ title: t('收更'), headerBackVisible: false, gestureEnabled: false }} />
      <Stack.Screen name="Training" component={TrainingScreen} options={{title:t('學習以重置'),presentation:'modal'}} />
      <Stack.Screen name="Pro" component={ProScreen} options={{title:t('港運 Pro')}} />
      <Stack.Screen name="Elite" component={EliteScreen} options={({navigation})=>({title:t('專屬預約（ELITE）'),presentation:'modal',headerRight:()=> <IconButton label="關閉" name={{ios:'xmark',android:'close'}} colors={c} onPress={()=>navigation.goBack()}/>})} />
      <Stack.Screen name="Profile" component={ProfileScreen} options={{ title: t('玩家資料') }} />
      <Stack.Screen name="MultiplayerLobby" component={MultiplayerLobbyScreen} options={{ title: t('多人開更') }} />
      <Stack.Screen name="Room" component={RoomScreen} options={{ title: t('房間') }} />
      <Stack.Screen name="RoomSetup" component={RoomSetupScreen} options={{ title: t('車輛與成本'), presentation: 'formSheet', sheetAllowedDetents: [.85, 1], sheetGrabberVisible: true, sheetCornerRadius }} />
      <Stack.Screen name="Leaderboard" component={LeaderboardScreen} options={{ title: t('今場名次') }} />
      <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: t('設定'), presentation: 'formSheet', sheetAllowedDetents: [.65, 1], sheetGrabberVisible: true, sheetCornerRadius }} />
    </Stack.Navigator>
  </NavigationContainer><GameEffects routeName={routeName}/><ReleaseNotesDialog eligible={hydrated && routeName==='Garage'} colors={c} radius={sheetCornerRadius}/></>;
}
export default function App() {
  return <GestureHandlerRootView style={{ flex: 1 }}><SafeAreaProvider><MultiplayerProvider><GameProvider><Navigation /></GameProvider></MultiplayerProvider></SafeAreaProvider></GestureHandlerRootView>;
}

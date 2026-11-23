import { LocalizedText as Text, LocalizedPressable as Pressable } from '../i18n';
import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import * as Haptics from 'expo-haptics';
import type { Palette } from './theme';
import { sounds,type SoundCue } from '../audio/sounds';

export function Icon({ name, size = 22, color }: { name: SymbolViewProps['name']; size?: number; color: string }) {
  return <SymbolView name={name} size={size} tintColor={color} style={{ width: size, height: size }} />;
}
export function IconButton({ label, name, onPress, colors, style,cue='tap' }: { label: string; name: SymbolViewProps['name']; onPress: () => void; colors: Palette; style?: StyleProp<ViewStyle>;cue?:SoundCue|false }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={()=>{if(cue)sounds.playCue(cue);onPress();}} style={({ pressed }) => [styles.iconButton, { backgroundColor: colors.surface, opacity: pressed ? .65 : 1 }, style]}><Icon name={name} color={colors.text} /></Pressable>;
}
export function Button({ title, onPress, colors, secondary = false, disabled = false, style, testID,cue='tap' }: { title: string; onPress: () => void; colors: Palette; secondary?: boolean; disabled?: boolean; style?: StyleProp<ViewStyle>; testID?: string;cue?:SoundCue|false }) {
  return <Pressable testID={testID} accessibilityRole="button" disabled={disabled} onPress={() => { if(cue)sounds.playCue(cue);void Haptics.selectionAsync(); onPress(); }} style={({ pressed }) => [styles.button, { backgroundColor: secondary ? colors.muted : colors.primary, opacity: disabled ? .4 : pressed ? .75 : 1 }, style]}><Text style={[styles.buttonText, { color: secondary ? colors.text : colors.onPrimary }]}>{title}</Text></Pressable>;
}
export function Divider({ colors }: { colors: Palette }) { return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.line }} />; }
export const styles = StyleSheet.create({
  iconButton: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', boxShadow: '0px 2px 10px rgba(0,0,0,0.06)' },
  button: { minHeight: 56, paddingHorizontal: 20, paddingVertical: 16, borderRadius: 12, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center' },
  buttonText: { fontSize: 18, fontWeight: '600', textAlign: 'center' },
});

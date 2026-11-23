import { useColorScheme } from 'react-native';

export type Appearance = 'system' | 'light' | 'dark';
const light = { background: '#F6F6F6', surface: '#FFFFFF', elevated: '#FFFFFF', text: '#111111', secondary: '#626262', line: '#E5E5E5', muted: '#EEEEEE', primary: '#111111', onPrimary: '#FFFFFF', blue: '#276EF1', onBlue: '#FFFFFF', success: '#167746', incomeBackground: '#111111', incomeText: '#FFFFFF', incomeCurrency: '#147746', mapWater: '#CCE1EC', mapLand: '#F1F0EC' };
const dark = { background: '#111214', surface: '#202124', elevated: '#292A2E', text: '#F5F5F5', secondary: '#B3B5BB', line: '#3A3B40', muted: '#303136', primary: '#F5F5F5', onPrimary: '#111111', blue: '#6C9EFF', onBlue: '#0C1D3A', success: '#62D99B', incomeBackground: '#262729', incomeText: '#F5F5F5', incomeCurrency: '#4DD789', mapWater: '#192D39', mapLand: '#24272B' };
export type Palette = typeof light;
export function usePalette(appearance: Appearance) {
  const system = useColorScheme();
  const isDark = appearance === 'dark' || (appearance === 'system' && system === 'dark');
  return { colors: isDark ? dark : light, isDark };
}
export function money(value: number, digits = 0) {
  return new Intl.NumberFormat('en-HK', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
}
export function gameTime(minutes: number, startTime = 300) {
  const clock = Math.floor(startTime + minutes);
  return `${String(Math.floor(clock / 60) % 24).padStart(2, '0')}:${String(clock % 60).padStart(2, '0')}`;
}
export function duration(minutes: number) {
  return `${Math.floor(Math.max(0, minutes) / 60)}:${String(Math.floor(Math.max(0, minutes) % 60)).padStart(2, '0')}`;
}

import { useEffect, useMemo, useState } from 'react';
import { AppState, NativeModules, Platform, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { estimateIOSScreenCorners, UNAVAILABLE_CORNERS as UNAVAILABLE, type ScreenCorners } from './screenCornerGeometry';
export { insetScreenCornerRadius } from './mapScale';
export type { ScreenCorners } from './screenCornerGeometry';
const radius = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;

/** Android uses actual window insets; iOS uses an explicitly marked safe-area estimate. */
export function useScreenCorners(): ScreenCorners {
  const { width, height, scale } = useWindowDimensions();
  const insets=useSafeAreaInsets();
  const ios=useMemo(()=>estimateIOSScreenCorners({width,height,insets,idiom:Platform.OS==='ios'&&!Platform.isPad&&!Platform.isTV?'phone':'other'}),[width,height,insets.top,insets.right,insets.bottom,insets.left]);
  const [corners, setCorners] = useState<ScreenCorners>(UNAVAILABLE);
  useEffect(() => {
    if (process.env.EXPO_OS !== 'android') return;
    const native = NativeModules.HarbourScreenCorners as { getMetrics?: () => Promise<Partial<ScreenCorners>> } | undefined;
    if (!native?.getMetrics) return;
    let cancelled = false, request = 0;
    const refresh = async () => {
      const id = ++request;
      try {
        const result = await native.getMetrics!();
        if (cancelled || id !== request) return;
        setCorners(result.supported && result.source === 'android-window-insets' ? {
          supported: true, source: result.source, accuracy:'measured',
          topLeft: radius(result.topLeft), topRight: radius(result.topRight),
          bottomLeft: radius(result.bottomLeft), bottomRight: radius(result.bottomRight),
        } : UNAVAILABLE);
      } catch { if (!cancelled && id === request) setCorners(UNAVAILABLE); }
    };
    void refresh();
    // The first JS mount can precede the window's initial insets dispatch.
    const retry = setTimeout(() => { void refresh(); }, 350);
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') void refresh(); });
    return () => { cancelled = true; clearTimeout(retry); subscription.remove(); };
  }, [width, height, scale]);
  return process.env.EXPO_OS==='ios'?ios:corners;
}

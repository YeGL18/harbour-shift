/** Map symbols stay recognizable at overview altitude without obscuring roads. */
export function vehicleMarkerScale(zoom: number): number {
  'worklet';
  const value = Number.isFinite(zoom) ? zoom : 14.8;
  if (value <= 11) return .64;
  if (value < 14.8) return .64 + (value - 11) / 3.8 * .26;
  if (value < 16) return .9 + (value - 14.8) / 1.2 * .1;
  return 1;
}

/** Queue spacing is real road distance: avoid full-size symbols covering many cars. */
export function queueVehicleScale(zoom: number, latitude: number): number {
  'worklet';
  const metresPerPoint = 78271.51696 * Math.cos(latitude * Math.PI / 180) / 2 ** zoom;
  return Math.max(.055, Math.min(.8, 6.5 / metresPerPoint / 68));
}

const radius = (value: number) => Number.isFinite(value) ? Math.max(0, value) : 0;

/**
 * Equal outer insets produce a concentric circle of radius R - inset. Unequal
 * insets use the smaller remaining radius; the normal card radius is the floor.
 * verticalInset is edge-to-window distance, including margins/safe area.
 */
export function insetScreenCornerRadius(screenRadius: number, horizontalInset: number, verticalInset: number, fallback = 22): number {
  return Math.max(radius(fallback), radius(screenRadius) - Math.max(radius(horizontalInset), radius(verticalInset)));
}

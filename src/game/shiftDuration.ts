import type {ShiftDurationMinutes} from './types';
type DurationInput = number | {shiftDurationMinutes?: number} | undefined;
/** Old saves/clients without an explicit half shift retain twelve hours. */
export function getShiftDurationMinutes(value?: DurationInput): ShiftDurationMinutes {
  const minutes=typeof value === 'number' ? value : value?.shiftDurationMinutes;
  return minutes===360?360:minutes===1440?1440:720;
}
export function getShiftOvertimeLimit(value?: DurationInput): 120 | 240 {
  return getShiftDurationMinutes(value) === 360 ? 120 : 240;
}
export function getShiftEndMinute(value?: DurationInput): number {
  return getShiftDurationMinutes(value) + getShiftOvertimeLimit(value);
}

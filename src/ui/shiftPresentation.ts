import { isRoomSpeed, ROOM_SPEEDS, type CompetitionMode, type RoomSpeed } from '../../shared/protocol';
export type ShiftDuration = 360 | 720 | 1440;
/** New preferences default to half; game/save compatibility is handled by the engine. */
export const newShiftDurationPreference = (value: unknown): ShiftDuration => value === 1440 ? 1440 : value === 720 ? 720 : 360;
export const newRoomSpeed = (value: unknown): RoomSpeed => isRoomSpeed(value) ? value : 60;
export const nextGameSpeed = (speed: RoomSpeed): RoomSpeed => ROOM_SPEEDS[(ROOM_SPEEDS.indexOf(speed) + 1) % ROOM_SPEEDS.length];
export const estimatedRealMinutes = (minutes: ShiftDuration, speed: number) => minutes / newRoomSpeed(speed);
export const shiftDurationLabel = (minutes: number) => minutes === 360 ? '半更 · 6 小時' : minutes === 1440 ? '特更 · 24 小時' : '全更 · 12 小時';
export const competitionModeLabel = (mode: CompetitionMode) => mode === 'team-net' ? '2v2 隊伍淨收入' : mode === 'lowest-net' ? '最低淨收入勝出' : '最高淨收入勝出';

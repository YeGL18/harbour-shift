import {isPremiumProTier, normalizeProPacks, proActivationBlock, PRO_ACTIVATION_MESSAGE, PRO_SHIFTS_PER_PACK, proShiftEarnsCreditUse, type PremiumProTier, type ProPack, type ProPass} from '../../shared/pro';

export interface SoloProLedger {
  version: 1;
  packs: ProPack[];
  completedShifts: Record<string, true>;
}

export const emptySoloProLedger = (): SoloProLedger => ({version: 1, packs: [], completedShifts: {}});

export function readSoloProLedger(input: unknown): SoloProLedger {
  if (!input || typeof input !== 'object') return emptySoloProLedger();
  const value = input as SoloProLedger;
  if (value.version !== 1 || !Array.isArray(value.packs)) return emptySoloProLedger();
  const packs = value.packs.filter(pack => pack && typeof pack.id === 'string'
    && isPremiumProTier(pack.tier) && pack.source === 'practice'
    && Number.isSafeInteger(pack.remaining) && pack.remaining >= 0 && pack.remaining <= PRO_SHIFTS_PER_PACK
    && Number.isSafeInteger(pack.createdAt) && pack.createdAt > 0);
  const completedShifts = Object.fromEntries(Object.entries(value.completedShifts || {})
    .filter(([id, used]) => used === true && id.startsWith('solo:') && id.length <= 160)) as Record<string, true>;
  return {version: 1, packs: normalizeProPacks(packs), completedShifts};
}

export function addSoloPracticePass(ledger: SoloProLedger, tier: PremiumProTier, id: string, now: number): SoloProLedger {
  if (ledger.packs.some(pack => pack.id === id)) return ledger;
  const blocked = proActivationBlock(tier, ledger.packs);
  if (blocked) throw new Error(PRO_ACTIVATION_MESSAGE[blocked]);
  return {...ledger, packs: [{id, tier, createdAt: now, remaining: PRO_SHIFTS_PER_PACK, source: 'practice'}]};
}

export function completeSoloProShift(ledger: SoloProLedger, shiftId: string, pass?: ProPass, reason?: string): SoloProLedger {
  if (!pass || !shiftId.startsWith('solo:') || shiftId.length > 160 || ledger.completedShifts[shiftId] || !proShiftEarnsCreditUse(reason)) return ledger;
  const packs = normalizeProPacks(ledger.packs);
  const pack = packs.find(entry => entry.id === pass.packId && entry.tier === pass.tier);
  // A restored/current shift can retain a replaced pack. Settle that shift once,
  // without debiting the replacement or allowing the old pack to return.
  return {...ledger, completedShifts: {...ledger.completedShifts, [shiftId]: true},
    packs: packs.map(entry => entry === pack ? {...entry, remaining: entry.remaining - 1} : entry)};
}

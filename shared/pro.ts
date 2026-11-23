export type ProTier = 'blue' | 'gold' | 'platinum' | 'diamond';
export const ADVANCED_RULES_VERSION = 1 as const;
export const ADVANCED_RULES_HEADER = 'X-Harbour-Advanced-Rules';
export type PremiumProTier = Exclude<ProTier, 'blue'>;

export const PRO_TIERS = ['blue', 'gold', 'platinum', 'diamond'] as const;
export const PRO_SHIFTS_PER_PACK = 7;
export const PRO_HKD_TARGET = {gold: 1, platinum: 2, diamond: 5} as const;
export const PRO_TIER_NAME = {blue: '普通級', gold: '金級', platinum: '白金級', diamond: '鑽石級'} as const;
export const PRO_TIER_ENGLISH_NAME = {blue: 'Blue', gold: 'Gold', platinum: 'Platinum', diamond: 'Diamond'} as const;
export const proTierBilingualName = (tier: ProTier): string => `${PRO_TIER_NAME[tier]} · ${PRO_TIER_ENGLISH_NAME[tier]}`;
export const PRO_API = {status: '/v1/drivers/pro', trial: '/v1/drivers/pro/trial'} as const;

export interface ProPack {
  id: string;
  tier: PremiumProTier;
  remaining: number;
  createdAt: number;
  source: 'practice' | 'trial' | 'apple' | 'google';
}

export interface ProPass {
  packId: string;
  tier: PremiumProTier;
}

export interface ProStatus {
  trialAvailable: boolean;
  packs: ProPack[];
}

export function isPremiumProTier(value: unknown): value is PremiumProTier {
  return value === 'gold' || value === 'platinum' || value === 'diamond';
}

export function currentProPass(packs: readonly ProPack[]): ProPass | undefined {
  const pack = activeProPack(packs);
  return pack && {packId: pack.id, tier: pack.tier};
}

/** Legacy packs use the same winner as 0.8; every other pack must be retired. */
export function activeProPack(packs: readonly ProPack[]): ProPack | undefined {
  return [...packs].filter(pack => pack.remaining > 0).sort((a, b) =>
    PRO_TIERS.indexOf(b.tier) - PRO_TIERS.indexOf(a.tier) || a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )[0];
}

export function normalizeProPacks(packs: readonly ProPack[]): ProPack[] {
  const selected = activeProPack(packs);
  return selected ? [selected] : [];
}

export function proActivationBlock(tier: PremiumProTier, packs: readonly ProPack[]): 'same-tier' | 'downgrade' | undefined {
  const active = activeProPack(packs);
  if (!active) return undefined;
  if (active.tier === tier) return 'same-tier';
  return PRO_TIERS.indexOf(tier) < PRO_TIERS.indexOf(active.tier) ? 'downgrade' : undefined;
}

export const PRO_ACTIVATION_MESSAGE = {
  'same-tier': '現有同級權益仍然有效，不能疊加更次。',
  downgrade: '現有較高級權益仍然有效，暫時不能降級。',
} as const;

export function proDestinationAllowance(tier: ProTier = 'blue'): number {
  return tier === 'blue' ? 1 : 2;
}

export function proRequestWeight(tier?: ProTier): number {
  return tier === 'platinum' || tier === 'diamond' ? 1.22 : 1;
}

export function proShiftEarnsCreditUse(reason?: string): boolean {
  return reason === 'handover' || reason === 'deadline' || reason === 'fuel-completed-late';
}


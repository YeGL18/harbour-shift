import {PRO_API, PRO_SHIFTS_PER_PACK, PRO_ACTIVATION_MESSAGE, isPremiumProTier, normalizeProPacks, proActivationBlock, type PremiumProTier, type ProPack, type ProPass, type ProStatus} from '../../shared/pro';
import {fail, keys, object} from '../validation';
import {DriverStore} from './drivers';
import type {D1Database, D1Statement} from './store';

export interface ProClaim extends ProPass {
  driverId: string;
  shiftKey: string;
  state: 'held' | 'consumed' | 'released';
}

type PackRow = {
  id: string; driver_id: string; tier: PremiumProTier; source: ProPack['source'];
  created_at: number; consumed: number; held: number;
};

export function missingProSchema(error: unknown): boolean {
  return error instanceof Error && /no such table: (?:main\.)?driver_pro_(?:packs|claims)\b/i.test(error.message);
}

export class ProStore {
  constructor(private db: D1Database, private now: () => number = Date.now) {}

  private async activePacks(ids: string[]): Promise<Map<string, {pack: ProPack; held: number}>> {
    const unique = [...new Set(ids)];
    if (!unique.length) return new Map();
    const rows = await this.db.prepare(`
      SELECT p.id,p.driver_id,p.tier,p.source,p.created_at,
        (SELECT count(*) FROM driver_pro_claims c WHERE c.pack_id=p.id AND c.state='consumed') AS consumed,
        (SELECT count(*) FROM driver_pro_claims c WHERE c.pack_id=p.id AND c.state='held' AND c.held_until>?) AS held
      FROM driver_pro_packs p WHERE p.revoked_at IS NULL AND p.driver_id IN (${unique.map(() => '?').join(',')})
    `).bind(this.now(),...unique).all<PackRow>();
    const result = new Map<string, {pack: ProPack; held: number}>(), retired: string[] = [];
    for (const id of unique) {
      const owned = (rows.results || []).filter(row => row.driver_id === id);
      const [pack] = normalizeProPacks(owned.map(row => ({id:row.id,tier:row.tier,source:row.source,createdAt:row.created_at,remaining:Math.max(0,PRO_SHIFTS_PER_PACK-row.consumed)})));
      if (pack) result.set(id,{pack,held:owned.find(row => row.id === pack.id)!.held});
      retired.push(...owned.filter(row => row.id !== pack?.id).map(row => row.id));
    }
    // Also safe against a pre-0007 database: a legacy lower pack cannot surface
    // after the winner is exhausted. Claims and frozen room tiers stay intact.
    for (let at=0;at<retired.length;at+=90) {
      const chunk=retired.slice(at,at+90);
      await this.db.prepare(`UPDATE driver_pro_packs SET revoked_at=? WHERE revoked_at IS NULL AND id IN (${chunk.map(() => '?').join(',')})`).bind(this.now(),...chunk).run();
    }
    return result;
  }

  async bestPasses(ids: string[]): Promise<Map<string, ProPass>> {
    if (!ids.length) return new Map();
    try {
      const result = new Map<string, ProPass>();
      for (const [id,{pack,held}] of await this.activePacks(ids)) if (pack.remaining > held) result.set(id,{packId:pack.id,tier:pack.tier});
      return result;
    } catch (error) {
      if (!missingProSchema(error)) throw error;
      return new Map();
    }
  }

  private async status(driverId: string, trialAvailable: boolean): Promise<ProStatus> {
    const active = (await this.activePacks([driverId])).get(driverId);
    return {trialAvailable,packs:active?[active.pack]:[]};
  }

  async handle(path: string, method: string, token: string, input: unknown, trialAvailable: boolean): Promise<ProStatus> {
    const {driverId} = await new DriverStore(this.db,this.now).me(token);
    try {
      if (path === PRO_API.status && method === 'GET') return await this.status(driverId,trialAvailable);
      if (path !== PRO_API.trial || method !== 'POST') fail('not_found','找不到此 API',404);
      if (!trialAvailable) fail('pro_trial_unavailable','線上 Pro 試玩暫未開放。',403);
      const value = object(input);
      keys(value,['tier','requestId']);
      if (!isPremiumProTier(value.tier) || typeof value.requestId !== 'string'
        || !/^[A-Za-z0-9_-]{8,80}$/.test(value.requestId)) fail('invalid_pro_purchase','Pro 試玩資料無效。',400);
      const transaction = `${driverId}:${value.requestId}`;
      const replay = await this.db.prepare("SELECT tier FROM driver_pro_packs WHERE source='trial' AND transaction_id=?").bind(transaction).first<{tier:PremiumProTier}>();
      if (replay) {
        if (replay.tier !== value.tier) fail('pro_intent_changed','此權益啟用請求已用於另一級別。',409);
        return await this.status(driverId,trialAvailable);
      }
      // New creation fails closed until its atomic DB guard is installed. Old
      // readers/claims remain compatible throughout additive migration rollout.
      const guard = await this.db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='trigger' AND name IN ('driver_pro_single_active_insert','driver_pro_replace_previous')").first<{n:number}>();
      if (guard?.n !== 2) fail('pro_unavailable','線上 Pro 暫未開放。',503);
      try {
        await this.db.prepare(`INSERT OR IGNORE INTO driver_pro_packs(id,driver_id,tier,source,transaction_id,created_at) VALUES(?,?,?,'trial',?,?)`)
          .bind(crypto.randomUUID(),driverId,value.tier,transaction,this.now()).run();
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes('harbour_pro_same_or_lower_active')) throw error;
        const status = await this.status(driverId,trialAvailable), blocked = proActivationBlock(value.tier,status.packs);
        if (blocked) fail(blocked === 'same-tier'?'pro_same_tier_active':'pro_downgrade_active',PRO_ACTIVATION_MESSAGE[blocked],409);
        fail('pro_pack_changed','Pro 更次已更新，請再試開更。',409);
      }
      const committed = await this.db.prepare("SELECT tier FROM driver_pro_packs WHERE source='trial' AND transaction_id=?").bind(transaction).first<{tier:PremiumProTier}>();
      if (committed?.tier !== value.tier) fail('pro_intent_changed','此權益啟用請求已用於另一級別。',409);
      return await this.status(driverId,trialAvailable);
    } catch (error) {
      if (!missingProSchema(error)) throw error;
      fail('pro_unavailable','線上 Pro 暫未開放。',503);
    }
  }

  claimStatements(code: string, generation: string, version: number, expiresAt: number, claims: ProClaim[]): D1Statement[] {
    const now = this.now();
    return claims.map(claim => this.db.prepare(`
      INSERT INTO driver_pro_claims(shift_key,pack_id,driver_id,room_code,held_until,acquired_at,state)
      SELECT ?,?,?,?,?,?,?
      WHERE EXISTS(SELECT 1 FROM rooms WHERE code=? AND generation=? AND version=?)
      ON CONFLICT(shift_key) DO UPDATE SET state=excluded.state,held_until=excluded.held_until
      WHERE driver_pro_claims.state='held'
        AND driver_pro_claims.pack_id=excluded.pack_id AND driver_pro_claims.driver_id=excluded.driver_id
    `).bind(claim.shiftKey,claim.packId,claim.driverId,code,expiresAt,now,claim.state,code,generation,version));
  }
}

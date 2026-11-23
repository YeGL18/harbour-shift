-- Append only: retain every original pack/claim and each room's frozen pass.
-- Retire exhausted packs and every legacy loser. Winner matches the old client:
-- highest remaining tier, then oldest created_at and binary id tie-break.
UPDATE driver_pro_packs AS p SET revoked_at=CAST(strftime('%s','now') AS INTEGER)*1000
WHERE p.revoked_at IS NULL AND (
  (SELECT count(*) FROM driver_pro_claims c WHERE c.pack_id=p.id AND c.state='consumed')>=7
  OR EXISTS(
    SELECT 1 FROM driver_pro_packs w WHERE w.driver_id=p.driver_id AND w.revoked_at IS NULL
    AND (SELECT count(*) FROM driver_pro_claims c WHERE c.pack_id=w.id AND c.state='consumed')<7
    AND (
      (CASE w.tier WHEN 'diamond' THEN 3 WHEN 'platinum' THEN 2 ELSE 1 END)>(CASE p.tier WHEN 'diamond' THEN 3 WHEN 'platinum' THEN 2 ELSE 1 END)
      OR (w.tier=p.tier AND (w.created_at<p.created_at OR (w.created_at=p.created_at AND w.id<p.id)))
    )
  )
);
--> statement-breakpoint
-- Existing transaction retries still reach UNIQUE(source,transaction_id), where
-- INSERT OR IGNORE is idempotent. New same/lower-tier purchases fail atomically.
CREATE TRIGGER driver_pro_single_active_insert BEFORE INSERT ON driver_pro_packs
WHEN NOT EXISTS(SELECT 1 FROM driver_pro_packs t WHERE t.source=NEW.source AND t.transaction_id=NEW.transaction_id)
AND EXISTS(
  SELECT 1 FROM driver_pro_packs p WHERE p.driver_id=NEW.driver_id AND p.revoked_at IS NULL
  AND (SELECT count(*) FROM driver_pro_claims c WHERE c.pack_id=p.id AND c.state='consumed')<7
  AND (CASE p.tier WHEN 'diamond' THEN 3 WHEN 'platinum' THEN 2 ELSE 1 END)>=(CASE NEW.tier WHEN 'diamond' THEN 3 WHEN 'platinum' THEN 2 ELSE 1 END)
)
BEGIN SELECT RAISE(ABORT,'harbour_pro_same_or_lower_active'); END;
--> statement-breakpoint
CREATE TRIGGER driver_pro_replace_previous AFTER INSERT ON driver_pro_packs
BEGIN
  UPDATE driver_pro_packs SET revoked_at=NEW.created_at
  WHERE driver_id=NEW.driver_id AND id<>NEW.id AND revoked_at IS NULL;
END;

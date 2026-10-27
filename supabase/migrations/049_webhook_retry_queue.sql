-- ============================================================
-- 049_webhook_retry_queue.sql — Durable outbound webhook retries
--
-- Failed deliveries are enqueued with exponential backoff. A cron
-- worker (AUTOMATION_CRON_SECRET) drains pending rows. REST Hook
-- subscriptions for Zapier/Make reuse webhook_endpoints; this table
-- only stores the retry queue.
--
-- Idempotent. Postgres 17 compatible.
-- ============================================================

CREATE TABLE IF NOT EXISTS webhook_delivery_queue (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  endpoint_id     uuid NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  event           text NOT NULL,
  payload         jsonb NOT NULL,
  attempt         integer NOT NULL DEFAULT 0,
  max_attempts    integer NOT NULL DEFAULT 8,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error      text,
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'delivered', 'dead')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS webhook_delivery_queue_pending_idx
  ON webhook_delivery_queue (status, next_attempt_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS webhook_delivery_queue_account_idx
  ON webhook_delivery_queue (account_id, created_at DESC);

ALTER TABLE webhook_delivery_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS webhook_delivery_queue_select ON webhook_delivery_queue;
CREATE POLICY webhook_delivery_queue_select ON webhook_delivery_queue FOR SELECT
  USING (is_account_member(account_id));

-- Mutations go through the service-role deliverer / cron; admins may
-- cancel pending rows from the dashboard.
DROP POLICY IF EXISTS webhook_delivery_queue_update ON webhook_delivery_queue;
CREATE POLICY webhook_delivery_queue_update ON webhook_delivery_queue FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS webhook_delivery_queue_delete ON webhook_delivery_queue;
CREATE POLICY webhook_delivery_queue_delete ON webhook_delivery_queue FOR DELETE
  USING (is_account_member(account_id, 'admin'));

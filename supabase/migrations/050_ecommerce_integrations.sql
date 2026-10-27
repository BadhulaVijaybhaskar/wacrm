-- ============================================================
-- 050_ecommerce_integrations.sql — Shopify / WooCommerce
--
-- Order event log, delayed notify queue (template sends with
-- consent check), and product catalog stub rows.
-- Idempotent. Postgres 17 compatible.
-- ============================================================

CREATE TABLE IF NOT EXISTS ecommerce_orders (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  provider     text NOT NULL CHECK (provider IN ('shopify', 'woocommerce')),
  external_id  text NOT NULL,
  event_type   text NOT NULL,
  status       text,
  phone_e164   text,
  email        text,
  currency     text,
  total        text,
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, provider, external_id, event_type)
);

CREATE INDEX IF NOT EXISTS ecommerce_orders_account_idx
  ON ecommerce_orders (account_id, created_at DESC);

ALTER TABLE ecommerce_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ecommerce_orders_select ON ecommerce_orders;
CREATE POLICY ecommerce_orders_select ON ecommerce_orders FOR SELECT
  USING (is_account_member(account_id));

CREATE TABLE IF NOT EXISTS ecommerce_notify_queue (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  provider        text NOT NULL,
  order_id        uuid REFERENCES ecommerce_orders(id) ON DELETE SET NULL,
  contact_id      uuid REFERENCES contacts(id) ON DELETE SET NULL,
  phone_e164      text,
  template_name   text,
  template_lang   text NOT NULL DEFAULT 'en',
  delay_seconds   integer NOT NULL DEFAULT 0,
  run_at          timestamptz NOT NULL DEFAULT now(),
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'sent', 'skipped', 'failed')),
  last_error      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ecommerce_notify_queue_due_idx
  ON ecommerce_notify_queue (status, run_at)
  WHERE status = 'pending';

ALTER TABLE ecommerce_notify_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ecommerce_notify_queue_select ON ecommerce_notify_queue;
CREATE POLICY ecommerce_notify_queue_select ON ecommerce_notify_queue FOR SELECT
  USING (is_account_member(account_id));

CREATE TABLE IF NOT EXISTS product_catalog_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  provider     text NOT NULL CHECK (provider IN ('shopify', 'woocommerce')),
  external_id  text NOT NULL,
  title        text NOT NULL,
  sku          text,
  price        text,
  currency     text,
  raw          jsonb NOT NULL DEFAULT '{}'::jsonb,
  synced_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, provider, external_id)
);

CREATE INDEX IF NOT EXISTS product_catalog_items_account_idx
  ON product_catalog_items (account_id, provider);

ALTER TABLE product_catalog_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS product_catalog_items_select ON product_catalog_items;
CREATE POLICY product_catalog_items_select ON product_catalog_items FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS product_catalog_items_write ON product_catalog_items;
CREATE POLICY product_catalog_items_write ON product_catalog_items FOR ALL
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

-- ============================================================
-- 057_intents.sql — Dialogflow-style intents + training phrases
-- Idempotent. Postgres 17 compatible.
-- ============================================================

CREATE TABLE IF NOT EXISTS intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name text NOT NULL,
  display_name text NOT NULL,
  description text,
  enabled boolean NOT NULL DEFAULT true,
  trigger_flow_id uuid REFERENCES flows(id) ON DELETE SET NULL,
  trigger_automation_id uuid REFERENCES automations(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, name)
);

CREATE TABLE IF NOT EXISTS intent_training_phrases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intent_id uuid NOT NULL REFERENCES intents(id) ON DELETE CASCADE,
  phrase text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS intent_training_phrases_intent_idx
  ON intent_training_phrases (intent_id);

CREATE TABLE IF NOT EXISTS intent_entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intent_id uuid NOT NULL REFERENCES intents(id) ON DELETE CASCADE,
  name text NOT NULL,
  entity_type text NOT NULL DEFAULT 'text',
  required boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (intent_id, name)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'intent_entities_type_check'
  ) THEN
    ALTER TABLE intent_entities
      ADD CONSTRAINT intent_entities_type_check
      CHECK (entity_type IN ('text', 'number', 'email', 'phone', 'date'));
  END IF;
END $$;

ALTER TABLE intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE intent_training_phrases ENABLE ROW LEVEL SECURITY;
ALTER TABLE intent_entities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS intents_select ON intents;
CREATE POLICY intents_select ON intents
  FOR SELECT USING (is_account_member(account_id));
DROP POLICY IF EXISTS intents_write ON intents;
CREATE POLICY intents_write ON intents
  FOR ALL USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS intent_phrases_select ON intent_training_phrases;
CREATE POLICY intent_phrases_select ON intent_training_phrases
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM intents i
      WHERE i.id = intent_id AND is_account_member(i.account_id)
    )
  );
DROP POLICY IF EXISTS intent_phrases_write ON intent_training_phrases;
CREATE POLICY intent_phrases_write ON intent_training_phrases
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM intents i
      WHERE i.id = intent_id AND is_account_member(i.account_id, 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM intents i
      WHERE i.id = intent_id AND is_account_member(i.account_id, 'admin')
    )
  );

DROP POLICY IF EXISTS intent_entities_select ON intent_entities;
CREATE POLICY intent_entities_select ON intent_entities
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM intents i
      WHERE i.id = intent_id AND is_account_member(i.account_id)
    )
  );
DROP POLICY IF EXISTS intent_entities_write ON intent_entities;
CREATE POLICY intent_entities_write ON intent_entities
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM intents i
      WHERE i.id = intent_id AND is_account_member(i.account_id, 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM intents i
      WHERE i.id = intent_id AND is_account_member(i.account_id, 'admin')
    )
  );

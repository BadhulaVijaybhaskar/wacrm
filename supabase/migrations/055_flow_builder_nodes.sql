-- ============================================================
-- 055_flow_builder_nodes.sql — delay + hand_to_ai node types
-- Idempotent. Postgres 17 compatible.
-- ============================================================

ALTER TABLE flow_nodes
  DROP CONSTRAINT IF EXISTS flow_nodes_node_type_check;

ALTER TABLE flow_nodes
  ADD CONSTRAINT flow_nodes_node_type_check
  CHECK (node_type IN (
    'start',
    'send_buttons',
    'send_list',
    'send_message',
    'send_media',
    'collect_input',
    'condition',
    'set_tag',
    'handoff',
    'http_fetch',
    'delay',
    'hand_to_ai',
    'end'
  ));

'use client';

/**
 * CHAT-23 screenshot surface — flow builder + test simulator (no DB).
 */

import { FlowSimulator } from '@/components/flows/flow-simulator';
import { FlowEditorProvider } from '@/components/flows/flow-editor-state';
import { NODE_META, nodeColors, type NodeType } from '@/components/flows/shared';
import {
  DEFAULT_FALLBACK_POLICY,
  type FlowRow,
  type FlowNodeRow,
} from '@/lib/flows/types';

const NOW = new Date().toISOString();

const DEMO_FLOW: FlowRow = {
  id: 'preview-flow',
  account_id: 'preview-account',
  user_id: 'preview-user',
  name: 'Welcome + qualify',
  description: 'CHAT-23 visual builder preview',
  status: 'draft',
  trigger_type: 'keyword',
  trigger_config: { keywords: ['hi', 'hello'] },
  entry_node_id: null,
  fallback_policy: DEFAULT_FALLBACK_POLICY,
  execution_count: 0,
  last_executed_at: null,
  created_at: NOW,
  updated_at: NOW,
};

function node(
  partial: Omit<FlowNodeRow, 'flow_id' | 'created_at'> & {
    flow_id?: string;
    created_at?: string;
  },
): FlowNodeRow {
  return {
    flow_id: DEMO_FLOW.id,
    created_at: NOW,
    ...partial,
  };
}

const DEMO_NODES: FlowNodeRow[] = [
  node({
    id: 'n1',
    node_key: 'start',
    node_type: 'start',
    config: { next_node_key: 'greet' },
    position_x: 80,
    position_y: 120,
  }),
  node({
    id: 'n2',
    node_key: 'greet',
    node_type: 'send_message',
    config: { text: 'Welcome! How can we help?', next_node_key: 'ask_need' },
    position_x: 280,
    position_y: 120,
  }),
  node({
    id: 'n3',
    node_key: 'ask_need',
    node_type: 'collect_input',
    config: {
      prompt_text: 'Tell us what you need',
      var_key: 'need',
      next_node_key: 'branch',
    },
    position_x: 480,
    position_y: 120,
  }),
  node({
    id: 'n4',
    node_key: 'branch',
    node_type: 'condition',
    config: {
      subject: 'var',
      subject_key: 'need',
      operator: 'contains',
      value: 'order',
      true_next: 'api',
      false_next: 'ai',
    },
    position_x: 680,
    position_y: 120,
  }),
  node({
    id: 'n5',
    node_key: 'api',
    node_type: 'http_fetch',
    config: {
      method: 'GET',
      url: 'https://example.com/orders',
      response_var: 'order',
      next_node_key: 'wait',
    },
    position_x: 880,
    position_y: 40,
  }),
  node({
    id: 'n6',
    node_key: 'wait',
    node_type: 'delay',
    config: { seconds: 30, next_node_key: 'agent' },
    position_x: 1080,
    position_y: 40,
  }),
  node({
    id: 'n7',
    node_key: 'agent',
    node_type: 'handoff',
    config: { note: 'Order path' },
    position_x: 1280,
    position_y: 40,
  }),
  node({
    id: 'n8',
    node_key: 'ai',
    node_type: 'hand_to_ai',
    config: { note: 'General help', next_node_key: '' },
    position_x: 880,
    position_y: 220,
  }),
];

const LEGEND = Object.keys(NODE_META) as NodeType[];

export default function FlowBuilderPreviewPage() {
  return (
    <main className="min-h-screen bg-[radial-gradient(ellipse_at_top,_#e8eef7,_#f7f4ef)] p-6 text-slate-900">
      <h1 className="font-serif text-3xl tracking-tight">Flow builder</h1>
      <p className="mt-1 max-w-2xl text-sm text-slate-600">
        CHAT-23 — visual nodes (message, buttons/list, question, condition, API,
        assign agent, hand to AI, delay, end) plus an in-editor test simulator.
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        {LEGEND.map((type) => (
          <span
            key={type}
            className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-slate-600"
          >
            <span
              className="h-2 w-2 rounded-full"
              style={{ background: nodeColors(type).solid }}
            />
            {NODE_META[type].slugSeed}
          </span>
        ))}
      </div>
      <FlowEditorProvider initialFlow={DEMO_FLOW} initialNodes={DEMO_NODES}>
        <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-slate-500 uppercase">
              Canvas nodes
            </h2>
            <ol className="space-y-2 text-sm">
              {DEMO_NODES.map((n) => (
                <li
                  key={n.id}
                  className="flex items-center gap-3 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2"
                >
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{
                      background: nodeColors(n.node_type as NodeType).solid,
                    }}
                  />
                  <span className="font-mono text-xs text-slate-500">
                    {n.node_key}
                  </span>
                  <span className="font-medium">
                    {NODE_META[n.node_type as NodeType]?.slugSeed ?? n.node_type}
                  </span>
                </li>
              ))}
            </ol>
          </div>
          <div className="min-h-[420px]">
            <FlowSimulator />
          </div>
        </div>
      </FlowEditorProvider>
    </main>
  );
}

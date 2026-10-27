'use client';

import { useMemo, useState } from 'react';
import { Play, RotateCcw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { simulateFlowStep } from '@/lib/flows/simulator';
import { useFlowEditor } from './flow-editor-state';

/**
 * In-editor flow test simulator (CHAT-23). Walks nodes purely in-memory
 * with stubbed API/delay/AI steps — no Meta calls.
 */
export function FlowSimulator() {
  const { state } = useFlowEditor();
  const nodes = state.nodes;
  const startKey = useMemo(() => {
    const start = nodes.find((n) => n.node_type === 'start');
    return start?.node_key ?? nodes[0]?.node_key ?? null;
  }, [nodes]);

  const [current, setCurrent] = useState<string | null>(startKey);
  const [vars, setVars] = useState<Record<string, unknown>>({});
  const [log, setLog] = useState<string[]>([]);
  const [input, setInput] = useState('');
  const [done, setDone] = useState(false);

  const reset = () => {
    setCurrent(startKey);
    setVars({});
    setLog([]);
    setInput('');
    setDone(false);
  };

  const step = () => {
    if (!current || done) return;
    const node = nodes.find((n) => n.node_key === current);
    if (!node) {
      setLog((l) => [...l, `Missing node ${current}`]);
      setDone(true);
      return;
    }
    const result = simulateFlowStep({
      node_type: node.node_type,
      config: node.config,
      vars,
      inputText:
        node.node_type === 'collect_input' ? input || 'sample reply' : undefined,
    });
    setVars(result.vars);
    setLog((l) => [...l, `${node.node_type}: ${result.log}`]);
    if (result.terminal || !result.next) {
      setDone(true);
      setCurrent(result.next);
      return;
    }
    setCurrent(result.next);
  };

  return (
    <div className="flex h-full flex-col gap-3 rounded-xl border border-border bg-card p-4 text-sm">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold">Test simulator</h3>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="outline" onClick={reset}>
            <RotateCcw className="size-3.5" />
            Reset
          </Button>
          <Button type="button" size="sm" disabled={done || !current} onClick={step}>
            <Play className="size-3.5" />
            Step
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Current node:{' '}
        <span className="font-mono">{current ?? '—'}</span>
        {done ? ' · finished' : ''}
      </p>
      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground">
          Input for question nodes
        </label>
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Customer reply…"
        />
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto rounded-md border border-border bg-muted/30 p-2 text-xs">
        {log.length === 0 ? (
          <p className="text-muted-foreground">Press Step to walk the flow.</p>
        ) : (
          log.map((line, i) => (
            <p key={`${i}-${line}`} className="font-mono">
              {line}
            </p>
          ))
        )}
      </div>
      <pre className="max-h-28 overflow-auto rounded-md bg-muted/40 p-2 text-[10px]">
        {JSON.stringify(vars, null, 2)}
      </pre>
    </div>
  );
}

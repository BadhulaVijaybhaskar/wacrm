/**
 * Pure in-memory flow step walker for the builder test simulator.
 * No DB, Meta, or network — safe to import from client components.
 */

export function simulateFlowStep(opts: {
  node_type: string;
  config: Record<string, unknown>;
  vars: Record<string, unknown>;
  inputText?: string;
}): {
  vars: Record<string, unknown>;
  next: string | null;
  log: string;
  terminal?: boolean;
} {
  const cfg = opts.config;
  const vars = { ...opts.vars };
  switch (opts.node_type) {
    case "start":
      return {
        vars,
        next: typeof cfg.next_node_key === "string" ? cfg.next_node_key : null,
        log: "Start",
      };
    case "send_message":
      return {
        vars,
        next: typeof cfg.next_node_key === "string" ? cfg.next_node_key : null,
        log: `Send: ${String(cfg.text ?? "")}`,
      };
    case "collect_input": {
      const key = typeof cfg.var_key === "string" ? cfg.var_key : "answer";
      if (opts.inputText !== undefined) vars[key] = opts.inputText;
      return {
        vars,
        next: typeof cfg.next_node_key === "string" ? cfg.next_node_key : null,
        log: `Collect → vars.${key}`,
      };
    }
    case "condition": {
      const subjectKey = String(cfg.subject_key ?? "");
      const actual = String(vars[subjectKey] ?? "");
      const expected = String(cfg.value ?? "");
      const op = String(cfg.operator ?? "equals");
      let ok = false;
      if (op === "equals") ok = actual === expected;
      else if (op === "contains") ok = actual.includes(expected);
      else if (op === "present") ok = actual.length > 0;
      else if (op === "absent") ok = actual.length === 0;
      return {
        vars,
        next: ok
          ? typeof cfg.true_next === "string"
            ? cfg.true_next
            : null
          : typeof cfg.false_next === "string"
            ? cfg.false_next
            : null,
        log: `Condition ${ok ? "true" : "false"}`,
      };
    }
    case "delay":
      return {
        vars,
        next: typeof cfg.next_node_key === "string" ? cfg.next_node_key : null,
        log: `Delay ${Number(cfg.seconds ?? 0)}s`,
      };
    case "http_fetch":
      if (typeof cfg.response_var === "string" && cfg.response_var) {
        vars[cfg.response_var] = '{"stub":true}';
      }
      return {
        vars,
        next: typeof cfg.next_node_key === "string" ? cfg.next_node_key : null,
        log: `API ${String(cfg.method ?? "GET")} ${String(cfg.url ?? "")}`,
      };
    case "hand_to_ai":
      return {
        vars,
        next:
          typeof cfg.next_node_key === "string" && cfg.next_node_key
            ? cfg.next_node_key
            : null,
        log: "Hand to AI employee",
        terminal: !cfg.next_node_key,
      };
    case "handoff":
      return { vars, next: null, log: "Handoff to agent", terminal: true };
    case "end":
      return { vars, next: null, log: "End", terminal: true };
    default:
      return {
        vars,
        next: typeof cfg.next_node_key === "string" ? cfg.next_node_key : null,
        log: opts.node_type,
      };
  }
}

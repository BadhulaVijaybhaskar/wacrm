/**
 * XSS-safe rendering helpers for inbound/outbound WhatsApp content
 * (CHAT-12). React already escapes text nodes, but interactive payloads,
 * captions, and link-preview fields can be copied into attributes or
 * third-party HTML sinks — always run untrusted strings through these
 * before display or persistence into HTML contexts.
 */

const ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escape HTML special characters in message text / captions. */
export function escapeHtml(input: string | null | undefined): string {
  if (!input) return '';
  return input.replace(/[&<>"']/g, (ch) => ESCAPE_MAP[ch] ?? ch);
}

/**
 * Strip control characters (except common whitespace). Use this for
 * React text-node rendering — React escapes HTML; we only need to drop
 * non-printable controls. Prefer `escapeHtml` when writing into an HTML
 * attribute or a `dangerouslySetInnerHTML` sink.
 */
export function stripControlChars(
  input: string | null | undefined,
): string {
  if (!input) return '';
  // Drop C0 controls except \t \n \r; also drop DEL.
  return input.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
}

/**
 * Strip controls + escape HTML. Use for any non-React HTML context
 * (captions copied into email, OG tags, attribute values).
 */
export function sanitizeMessageText(
  input: string | null | undefined,
): string {
  return escapeHtml(stripControlChars(input));
}

/** Sanitize a flat string map (e.g. interactive button titles). */
export function sanitizeStringRecord(
  record: Record<string, unknown> | null | undefined,
): Record<string, string> {
  if (!record) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === 'string') {
      out[sanitizeMessageText(key) || key] = sanitizeMessageText(value);
    }
  }
  return out;
}

/**
 * Recursively strip control chars from string leaves in an interactive
 * / link-preview payload destined for React text nodes. Does NOT HTML-
 * escape (React does). Use `sanitizeMessageText` leaf-by-leaf when the
 * sink is raw HTML.
 */
export function sanitizeInteractivePayload<T>(payload: T): T {
  if (payload == null) return payload;
  if (typeof payload === 'string') {
    return stripControlChars(payload) as T;
  }
  if (Array.isArray(payload)) {
    return payload.map((item) => sanitizeInteractivePayload(item)) as T;
  }
  if (typeof payload === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(
      payload as Record<string, unknown>,
    )) {
      out[key] = sanitizeInteractivePayload(value);
    }
    return out as T;
  }
  return payload;
}

/** HTML-escaped interactive payload for non-React sinks / tests. */
export function escapeInteractivePayloadHtml<T>(payload: T): T {
  if (payload == null) return payload;
  if (typeof payload === 'string') {
    return sanitizeMessageText(payload) as T;
  }
  if (Array.isArray(payload)) {
    return payload.map((item) => escapeInteractivePayloadHtml(item)) as T;
  }
  if (typeof payload === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(
      payload as Record<string, unknown>,
    )) {
      out[key] = escapeInteractivePayloadHtml(value);
    }
    return out as T;
  }
  return payload;
}

/**
 * Allow only http(s) URLs for link previews. Rejects javascript:,
 * data:, and protocol-relative tricks.
 */
export function sanitizeLinkPreviewUrl(
  url: string | null | undefined,
): string | null {
  if (!url?.trim()) return null;
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

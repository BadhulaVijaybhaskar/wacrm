// Only constant messages and a validated numeric Meta code may be persisted.
// Never use Error.message, Graph bodies, request URLs, tokens or headers here.
const safeMessages: Record<string, string> = {
  meta_request_failed: 'WhatsApp connection request failed.',
  pin_mismatch: 'Two-step verification PIN is incorrect. Turn off two-step verification for this number in WhatsApp Manager, then retry.',
  database_error: 'Connection state could not be saved.',
  configuration_error: 'Connection configuration is unavailable.',
  state_changed: 'Connection state changed. Retry the request.',
};

export function sanitizeLastError(errorCode: unknown, metaCode?: unknown): string {
  const message = typeof errorCode === 'string' && Object.hasOwn(safeMessages, errorCode)
    ? safeMessages[errorCode] : safeMessages.meta_request_failed;
  const prefix = typeof metaCode === 'number' && Number.isSafeInteger(metaCode) && metaCode >= 0 && metaCode <= 2147483647
    ? `Meta ${metaCode}` : 'WhatsApp';
  return `${prefix}: ${message}`.slice(0, 300);
}

/**
 * Derive the Settings → Astra Connect adapter status chip from the
 * per-account toggle plus server env (and tenant) — never claim "off"
 * when the toggle is on.
 */

export type AstraConnectAdapterStatus =
  | 'active'
  | 'waiting_server'
  | 'waiting_tenant'
  | 'inactive';

export function resolveAstraConnectAdapterStatus(args: {
  enabled: boolean;
  envConfigured: boolean;
  tenantId: string | null | undefined;
}): AstraConnectAdapterStatus {
  if (!args.enabled) return 'inactive';
  if (!args.envConfigured) return 'waiting_server';
  if (!args.tenantId?.trim()) return 'waiting_tenant';
  return 'active';
}

/** i18n key under Settings.astraConnect for the adapter status chip. */
export function astraConnectAdapterStatusMessageKey(
  status: AstraConnectAdapterStatus,
):
  | 'statusActive'
  | 'statusWaitingServer'
  | 'statusWaitingTenant'
  | 'statusInactive' {
  switch (status) {
    case 'active':
      return 'statusActive';
    case 'waiting_server':
      return 'statusWaitingServer';
    case 'waiting_tenant':
      return 'statusWaitingTenant';
    case 'inactive':
      return 'statusInactive';
  }
}

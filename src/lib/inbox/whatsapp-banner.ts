/**
 * Inbox "WhatsApp not connected" banner — dismiss persistence + CTA.
 *
 * Dismissal is per-user (localStorage key includes user id) so shared
 * browsers don't hide the banner for every account on the device.
 */

export const WHATSAPP_SETUP_HREF = '/settings?tab=whatsapp'

export function whatsappBannerDismissStorageKey(userId: string): string {
  const id = userId.trim()
  if (!id) return 'astra-chat:inbox:whatsapp-banner-dismissed'
  return `astra-chat:inbox:whatsapp-banner-dismissed:${id}`
}

export function readWhatsappBannerDismissed(
  storage: Pick<Storage, 'getItem'>,
  userId: string,
): boolean {
  try {
    return storage.getItem(whatsappBannerDismissStorageKey(userId)) === '1'
  } catch {
    return false
  }
}

export function writeWhatsappBannerDismissed(
  storage: Pick<Storage, 'setItem'>,
  userId: string,
): void {
  try {
    storage.setItem(whatsappBannerDismissStorageKey(userId), '1')
  } catch {
    // private mode / blocked storage
  }
}

export function clearWhatsappBannerDismissed(
  storage: Pick<Storage, 'removeItem'>,
  userId: string,
): void {
  try {
    storage.removeItem(whatsappBannerDismissStorageKey(userId))
  } catch {
    // ignore
  }
}

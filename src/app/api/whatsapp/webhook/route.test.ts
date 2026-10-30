import { createHmac } from 'node:crypto'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Shared, hoisted state the module mocks close over. Reset per test.
const h = vi.hoisted(() => ({
  realSignature: false,
  partnerWrites: [] as Record<string, unknown>[],
  embeddedRows: [] as Record<string, unknown>[],
  embeddedLookupError: false,
  ownerMissing: false,
  validSignature: true, legacyFound:true,rateLimited:false,gates:[] as string[],
  scopedMessageIds: [] as string[],
  scopedStatusFilters: [] as [string, unknown][],
  lookups: [] as [string, unknown][],
  runAutomationsForTrigger: vi.fn(),
  dispatchInboundToFlows: vi.fn(),
  dispatchInboundToAiReply: vi.fn(),
  dispatchInboundToAstraConnect: vi.fn(),
  loadAstraConnectAccountConfig: vi.fn(),
  isAstraConnectActive: vi.fn(),
  dispatchWebhookEvent: vi.fn(),
  state: {
    // Result the message upsert's .select() resolves to. A genuine insert
    // returns the row; a replayed delivery conflicts and returns [].
    messageUpsertResult: [{ id: 'msg-1' }] as { id: string }[],
    priorCustomerMsgCount: 0,
    /** Row `lookupInternalIdByMetaId` resolves for a `context.id`. */
    replyContextParent: null as { id: string } | null,
    conversation: { id: 'conv-1', unread_count: 0, account_id: 'acc-1' },
    upsertCalls: [] as { row: Record<string, unknown>; options: unknown }[],
    rpcCalls: [] as { name: string; args: Record<string, unknown> }[],
    afterCallbacks: [] as (() => Promise<void> | void)[],
    automationStarted: 0,
    automationCompleted: 0,
    /** whatsapp_config.mirror_inbound_media for the matched row (#466). */
    mirrorInboundMedia: true as boolean | undefined,
    /** Objects the inbound-media mirror pushed into chat-media. */
    storageUploads: [] as {
      bucket: string
      path: string
      options: { contentType?: string }
    }[],
    /** Error the next storage upload resolves with, if any. */
    storageUploadError: null as { message: string } | null,
    /** Row `findContactByWaUserId` resolves for a BSUID lookup (#519). */
    contactByWaUserId: null as Record<string, unknown> | null,
    /** Rows inserted into `contacts`. */
    contactInserts: [] as Record<string, unknown>[],
    /** Patches applied to an existing `contacts` row. */
    contactUpdates: [] as Record<string, unknown>[],
    /** Patches applied to `messages` by a status webhook (#535). */
    messageUpdates: [] as Record<string, unknown>[],
    /** Row the status webhook's broadcast_recipients lookup resolves. */
    broadcastRecipient: null as { id: string; status: string } | null,
    /** Patches applied to that broadcast_recipients row. */
    recipientUpdates: [] as Record<string, unknown>[],
  },
}))

vi.mock('next/server', () => ({
  after: (cb: () => Promise<void> | void) => {
    h.state.afterCallbacks.push(cb)
  },
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({ body, init }),
  },
}))

// Mock the shared service-client boundary, never require real credentials.
vi.mock('@/lib/supabase/admin', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return { createServiceClient: () => createClient('https://example.supabase.co', 'dummy-test') }
})

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    schema(schema: string) { expect(schema).toBe('wacrm'); return this },
    from(table: string) {
      switch (table) {
        case 'wa_connections':
          return {
            update: (patch: Record<string, unknown>) => {
              const q = { eq: () => q, lt: async () => { h.partnerWrites.push(patch); return {error:null}; } };
              return q;
            },
            select: () => ({ eq: (key: string, value: unknown) => {
            h.lookups.push([key, value]);
            return Promise.resolve({data:h.embeddedRows,error:h.embeddedLookupError ? {code:'test',message:'private-db-details pn-1 dummy-embedded-token'} : null})
          } }) }
        case 'profiles': {
          const q = {
            eq: (key: string, value: unknown) => { h.lookups.push([key,value]);return q },
            order: () => q, limit: () => q,
            maybeSingle: async () => ({data:h.ownerMissing ? null : {user_id:'embedded-owner'},error:null}),
          }
          return {select: () => q}
        }
        case 'whatsapp_config':
          return {
            select: () => ({
              eq: () =>
                Promise.resolve({
                  data: h.legacyFound ? [
                    {
                      account_id: 'acc-1',
                      user_id: 'user-1',
                      access_token: 'enc',
                      mirror_inbound_media: h.state.mirrorInboundMedia,
                    },
                  ] : [],
                  error: null,
                }),
            }),
          }
        case 'conversations':
          // findOrCreateConversation: select().eq().eq().order().limit()
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  order: () => ({
                    limit: () =>
                      Promise.resolve({
                        data: [h.state.conversation],
                        error: null,
                      }),
                  }),
                }),
              }),
            }),
          }
        case 'broadcast_recipients':
          // Two chains land here:
          //   flagBroadcastReplyIfAny: select().eq().eq().in().order().limit()
          //   handleStatusUpdate:      select().eq().maybeSingle(), then
          //                            update().eq()
          return {
            select: (columns: string) => {
              if (columns.includes('!inner') && columns.includes('status')) {
                const q = {
                  eq: (key: string, value: unknown) => { h.scopedStatusFilters.push([key,value]); return q },
                  maybeSingle: async () => ({data:null,error:null}),
                }
                return q;
              }
              return { eq: () => ({
                eq: () => ({
                  in: () => ({
                    order: () => ({
                      limit: () =>
                        Promise.resolve({ data: [], error: null }),
                    }),
                  }),
                }),
                maybeSingle: () =>
                  Promise.resolve({
                    data: h.state.broadcastRecipient,
                    error: null,
                  }),
              }),
            } },
            update: (patch: Record<string, unknown>) => {
              h.state.recipientUpdates.push(patch)
              return { eq: () => Promise.resolve({ error: null }) }
            },
          }
        case 'contacts':
          // Three chains land here, all from findOrCreateContact:
          //   findContactByWaUserId: select('*').eq().eq().maybeSingle()
          //   identity backfill:     update().eq().select().maybeSingle()
          //   create:                insert().select().single()
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: h.state.contactByWaUserId,
                      error: null,
                    }),
                }),
              }),
            }),
            update: (patch: Record<string, unknown>) => {
              h.state.contactUpdates.push(patch)
              return {
                eq: () => ({
                  select: () => ({
                    maybeSingle: () =>
                      Promise.resolve({ data: null, error: null }),
                  }),
                }),
              }
            },
            insert: (row: Record<string, unknown>) => {
              h.state.contactInserts.push(row)
              return {
                select: () => ({
                  single: () =>
                    Promise.resolve({
                      data: { id: 'contact-new', ...row },
                      error: null,
                    }),
                }),
              }
            },
          }
        case 'messages':
          return {
            // Two different chains land here, told apart by the count
            // option: the prior-message count (head request) and the
            // reply-context parent lookup.
            select: (_columns: string, options?: { head?: boolean }) => {
              if (_columns.includes('!inner')) {
                const q = {
                  eq: (key: string, value: unknown) => { h.scopedStatusFilters.push([key,value]); return q },
                  limit: () => q,
                  maybeSingle: async () => ({data:null,error:null}),
                  then: (resolve: (r: unknown) => unknown) => Promise.resolve({
                    data:h.scopedMessageIds.map(id => ({id})),error:null,
                  }).then(resolve),
                }
                return q;
              }
              return options?.head
                ? // priorCustomerMsgCount: select('id',{count,head}).eq().eq()
                  {
                    eq: () => ({
                      eq: () =>
                        Promise.resolve({
                          count: h.state.priorCustomerMsgCount,
                          error: null,
                        }),
                    }),
                  }
                : // lookupInternalIdByMetaId: select('id').eq().eq().maybeSingle()
                  // handleStatusUpdate fan-out: select().eq().limit().maybeSingle()
                  {
                    eq: () => ({
                      eq: () => ({
                        maybeSingle: () =>
                          Promise.resolve({
                            data: h.state.replyContextParent,
                            error: null,
                          }),
                      }),
                      limit: () => ({
                        maybeSingle: () =>
                          Promise.resolve({ data: null, error: null }),
                      }),
                    }),
                  };
            },
            // Status webhook mirror (#535): update(...).eq('message_id', ...)
            update: (patch: Record<string, unknown>) => {
              h.state.messageUpdates.push(patch)
              const q = {
                eq: (key: string, value: unknown) => { h.scopedStatusFilters.push([key,value]); return q },
                in: (key: string, value: unknown) => { h.scopedStatusFilters.push([key,value]); return q },
                then: (resolve: (r: unknown) => unknown) => Promise.resolve({error:null}).then(resolve),
              }
              return q
            },
            // Idempotent insert: upsert(...).select('id')
            upsert: (row: Record<string, unknown>, options: unknown) => {
              h.state.upsertCalls.push({ row, options })
              return {
                select: () =>
                  Promise.resolve({
                    data: h.state.messageUpsertResult,
                    error: null,
                  }),
              }
            },
          }
        default:
          throw new Error(`unexpected table: ${table}`)
      }
    },
    rpc: (name: string, args: Record<string, unknown>) => {
      h.state.rpcCalls.push({ name, args })
      return Promise.resolve({ data: null, error: null })
    },
    // Service-role Storage, used by the inbound-media mirror (#466).
    storage: {
      from(bucket: string) {
        return {
          upload: (
            path: string,
            _body: unknown,
            options: { contentType?: string },
          ) => {
            h.state.storageUploads.push({ bucket, path, options })
            return Promise.resolve({ error: h.state.storageUploadError })
          },
          getPublicUrl: (path: string) => ({
            data: { publicUrl: `https://cdn.test/${bucket}/${path}` },
          }),
        }
      },
    },
  }),
}))

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: () => 'plain-token',
  encrypt: (v: string) => v,
  isLegacyFormat: () => false,
}))
vi.mock('@/lib/whatsapp/meta-api', () => ({
  getMediaUrl: vi.fn(),
  downloadMedia: vi.fn(),
}))
vi.mock('@/lib/contacts/dedupe', () => ({
  findExistingContact: vi.fn(async () => ({
    id: 'contact-1',
    name: 'Ada',
    phone: '15551230000',
  })),
  isUniqueViolation: () => false,
}))

vi.mock('@/lib/whatsapp/webhook-signature', async importOriginal => {
  const real = await importOriginal<typeof import('@/lib/whatsapp/webhook-signature')>();
  return {
  verifyMetaWebhookSignature: (body: string, signature: string | null) => {
    h.gates.push('hmac');return h.realSignature ? real.verifyMetaWebhookSignature(body, signature) : h.validSignature;
  },
  isMetaWebhookPayloadFresh: () => true,
  };
})
vi.mock('@/lib/rate-limit',async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/rate-limit')>(),
  checkRateLimit: () => {h.gates.push('rate');return {success:!h.rateLimited,remaining:1,reset:Date.now()+60000,limit:100}},
}))
vi.mock('@/lib/whatsapp/template-webhook', () => ({
  isTemplateWebhookField: (field: string) =>
    field.startsWith('message_template_'),
  handleTemplateWebhookChange: vi.fn(),
}))
vi.mock('@/lib/automations/engine', () => ({
  runAutomationsForTrigger: h.runAutomationsForTrigger,
}))
vi.mock('@/lib/flows/engine', () => ({
  dispatchInboundToFlows: h.dispatchInboundToFlows,
}))
vi.mock('@/lib/ai/auto-reply', () => ({
  dispatchInboundToAiReply: h.dispatchInboundToAiReply,
}))
vi.mock('@/lib/astra-connect', () => ({
  dispatchInboundToAstraConnect: h.dispatchInboundToAstraConnect,
  loadAstraConnectAccountConfig: h.loadAstraConnectAccountConfig,
  isAstraConnectActive: h.isAstraConnectActive,
}))
vi.mock('@/lib/astra-billing', () => ({
  recordWhatsappUsage: vi.fn(async () => undefined),
}))
vi.mock('@/lib/webhooks/deliver', () => ({
  dispatchWebhookEvent: h.dispatchWebhookEvent,
}))

import { POST } from './route'
import { encryptToken } from '@/lib/whatsapp/embedded-signup/crypto'
import { resolveEmbeddedWebhookConnection } from '@/lib/whatsapp/embedded-signup/webhook-routing'
import { getMediaUrl, downloadMedia } from '@/lib/whatsapp/meta-api'
import { findExistingContact } from '@/lib/contacts/dedupe'
import { handleTemplateWebhookChange } from '@/lib/whatsapp/template-webhook'

const mockGetMediaUrl = vi.mocked(getMediaUrl)
const mockDownloadMedia = vi.mocked(downloadMedia)
const mockFindExistingContact = vi.mocked(findExistingContact)

const TEXT_MESSAGE = {
  id: 'wamid.TEST1',
  from: '15551230000',
  timestamp: '1700000000',
  type: 'text',
  text: { body: 'hello' },
}

const LEGACY_CONTACTS = [{ wa_id: '15551230000', profile: { name: 'Ada' } }]

function inboundRequest(
  message: Record<string, unknown> = TEXT_MESSAGE,
  contacts: Record<string, unknown>[] = LEGACY_CONTACTS,
) {
  const body = {
    entry: [
      {
        changes: [
          {
            field: 'messages',
            value: {
              metadata: { phone_number_id: 'pn-1' },
              contacts,
              messages: [message],
            },
          },
        ],
      },
    ],
  }
  return {
    text: async () => JSON.stringify(body),
    headers: { get: () => 'sha256=stub' },
  } as unknown as Request
}

async function runWebhook(
  message?: Record<string, unknown>,
  contacts?: Record<string, unknown>[],
) {
  const res = await POST(inboundRequest(message, contacts))
  // Drain the after() callback exactly as the runtime would.
  for (const cb of h.state.afterCallbacks) await cb()
  return res
}

/** A message-status webhook (sent / delivered / read / failed). */
async function runStatusWebhook(status: Record<string, unknown>) {
  const body = {
    entry: [
      {
        changes: [
          {
            field: 'messages',
            value: {
              metadata: { phone_number_id: 'pn-1' },
              statuses: [status],
            },
          },
        ],
      },
    ],
  }
  const res = await POST({
    text: async () => JSON.stringify(body),
    headers: { get: () => 'sha256=stub' },
  } as unknown as Request)
  for (const cb of h.state.afterCallbacks) await cb()
  return res
}

beforeEach(() => {
  vi.clearAllMocks()
  h.realSignature=false;h.partnerWrites=[];
  h.embeddedRows=[];h.embeddedLookupError=false;h.ownerMissing=false;h.lookups=[];h.validSignature=true;h.legacyFound=true;h.rateLimited=false;h.gates=[]
  h.scopedMessageIds=[];h.scopedStatusFilters=[]
  vi.stubEnv('WACRM_EMBEDDED_SIGNUP','0')
  h.state.messageUpsertResult = [{ id: 'msg-1' }]
  h.state.priorCustomerMsgCount = 0
  h.state.replyContextParent = null
  h.state.conversation = { id: 'conv-1', unread_count: 0, account_id: 'acc-1' }
  h.state.upsertCalls = []
  h.state.rpcCalls = []
  h.state.afterCallbacks = []
  h.state.automationStarted = 0
  h.state.automationCompleted = 0
  h.state.mirrorInboundMedia = true
  h.state.storageUploads = []
  h.state.storageUploadError = null
  h.state.contactByWaUserId = null
  h.state.contactInserts = []
  h.state.contactUpdates = []
  h.state.messageUpdates = []
  h.state.broadcastRecipient = null
  h.state.recipientUpdates = []
  mockFindExistingContact.mockResolvedValue({
    id: 'contact-1',
    name: 'Ada',
    phone: '15551230000',
  })
  mockGetMediaUrl.mockResolvedValue({
    url: 'https://lookaside.fbsbx.com/whatsapp/abc',
    mimeType: 'image/jpeg',
    fileSize: 2048,
  })
  mockDownloadMedia.mockResolvedValue({
    buffer: Buffer.alloc(2048),
    contentType: 'image/jpeg',
  })
  h.dispatchInboundToFlows.mockResolvedValue({ consumed: false })
  h.dispatchInboundToAiReply.mockResolvedValue(undefined)
  h.dispatchInboundToAstraConnect.mockResolvedValue(undefined)
  h.loadAstraConnectAccountConfig.mockResolvedValue(null)
  h.isAstraConnectActive.mockReturnValue(false)
  h.dispatchWebhookEvent.mockResolvedValue(undefined)
  h.runAutomationsForTrigger.mockImplementation(() => {
    h.state.automationStarted++
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        h.state.automationCompleted++
        resolve()
      }, 0)
    })
  })
})

describe('inbound webhook: idempotent insert (#367)', () => {
  it('a genuine first delivery persists once and fans out downstream', async () => {
    await runWebhook()

    // Inserted via upsert with the (conversation_id, message_id) conflict
    // target — not a bare insert.
    expect(h.state.upsertCalls).toHaveLength(1)
    expect(h.state.upsertCalls[0].options).toMatchObject({
      onConflict: 'conversation_id,message_id',
      ignoreDuplicates: true,
    })
    // Downstream side effects ran exactly once.
    expect(h.state.rpcCalls).toHaveLength(1)
    expect(h.dispatchInboundToFlows).toHaveBeenCalledTimes(1)
    expect(h.dispatchWebhookEvent).toHaveBeenCalledTimes(1)
  })

  it('a replayed delivery is a no-op: no unread bump, no fan-out', async () => {
    // Upsert hits the unique index and returns no row.
    h.state.messageUpsertResult = []

    await runWebhook()

    expect(h.state.upsertCalls).toHaveLength(1)
    // None of the downstream side effects fire on a replay.
    expect(h.state.rpcCalls).toHaveLength(0)
    expect(h.dispatchInboundToFlows).not.toHaveBeenCalled()
    expect(h.runAutomationsForTrigger).not.toHaveBeenCalled()
    expect(h.dispatchInboundToAiReply).not.toHaveBeenCalled()
    expect(h.dispatchWebhookEvent).not.toHaveBeenCalled()
  })
})

describe('inbound webhook: atomic unread bump (#369)', () => {
  it('increments unread through the DB-side RPC, not a read-modify-write', async () => {
    await runWebhook()

    expect(h.state.rpcCalls).toHaveLength(1)
    expect(h.state.rpcCalls[0]).toMatchObject({
      name: 'bump_conversation_on_inbound',
      args: { p_conversation_id: 'conv-1' },
    })
  })
})

describe('inbound webhook: template quick-reply buttons (#478)', () => {
  // A customer tapping a QUICK_REPLY button on a broadcast template.
  // `context.id` points at the template message we sent — which the
  // broadcast path never wrote to `messages`, so the parent lookup
  // legitimately misses and the reply is stored unquoted.
  const templateButtonTap = {
    id: 'wamid.BTN1',
    from: '15551230000',
    timestamp: '1700000000',
    type: 'button',
    button: { text: 'Yes, interested', payload: 'YES_INTERESTED' },
    context: { id: 'wamid.BROADCAST1' },
  }

  it('stores the tap as an interactive reply, not an unsupported message', async () => {
    await runWebhook(templateButtonTap)

    expect(h.state.upsertCalls).toHaveLength(1)
    expect(h.state.upsertCalls[0].row).toMatchObject({
      content_type: 'interactive',
      content_text: 'Yes, interested',
      interactive_reply_id: 'YES_INTERESTED',
      reply_to_message_id: null,
    })
  })

  it('routes the tap to flows and fires the interactive_reply trigger', async () => {
    await runWebhook(templateButtonTap)

    expect(h.dispatchInboundToFlows).toHaveBeenCalledWith(
      expect.objectContaining({
        message: {
          kind: 'interactive_reply',
          reply_id: 'YES_INTERESTED',
          reply_title: 'Yes, interested',
          meta_message_id: 'wamid.BTN1',
        },
      }),
    )
    const triggers = h.runAutomationsForTrigger.mock.calls.map(
      (call) => (call[0] as { triggerType: string }).triggerType,
    )
    expect(triggers).toContain('interactive_reply')
    // The AI auto-reply must stay out of it — a button tap is not a
    // free-text question.
    expect(h.dispatchInboundToAiReply).not.toHaveBeenCalled()
  })

  it('falls back to the label when the template button carries no payload', async () => {
    await runWebhook({
      ...templateButtonTap,
      button: { text: 'Track my order' },
    })

    expect(h.state.upsertCalls[0].row).toMatchObject({
      content_type: 'interactive',
      content_text: 'Track my order',
      interactive_reply_id: 'Track my order',
    })
  })
})

describe('inbound webhook: inbound media is mirrored (#466)', () => {
  const IMAGE_MESSAGE = {
    id: 'wamid.IMG1',
    from: '15551230000',
    timestamp: '1700000000',
    type: 'image',
    image: { id: '1234567890123456', mime_type: 'image/jpeg', caption: 'hi' },
  }

  it('stores a durable storage path instead of the expiring proxy path', async () => {
    await runWebhook(IMAGE_MESSAGE)

    expect(h.state.storageUploads).toHaveLength(1)
    const { storageBucket } = await import('@/lib/supabase/config')
    const bucket = storageBucket('chat-media')
    expect(h.state.storageUploads[0].bucket).toBe(bucket)
    expect(h.state.storageUploads[0].path).toBe(
      'account-acc-1/inbound/1234567890123456-image-1700000000.jpg',
    )
    expect(h.state.upsertCalls[0].row).toMatchObject({
      // Private buckets: persist the object path; UI/Meta mint signed URLs.
      media_url:
        'account-acc-1/inbound/1234567890123456-image-1700000000.jpg',
      // Meta's MIME type used to be discarded outright (`void mediaType`).
      media_type: 'image/jpeg',
    })
  })

  it('falls back to the proxy URL when the upload is refused', async () => {
    h.state.storageUploadError = { message: 'mime type not supported' }

    await runWebhook(IMAGE_MESSAGE)

    // The message still lands, and it still lands with a usable URL —
    // the mirror failing must never cost us the message.
    expect(h.state.upsertCalls).toHaveLength(1)
    expect(h.state.upsertCalls[0].row).toMatchObject({
      media_url: '/api/whatsapp/media/1234567890123456',
      media_type: 'image/jpeg',
    })
  })

  it('falls back to the proxy URL when the download from Meta throws', async () => {
    mockDownloadMedia.mockRejectedValueOnce(new Error('Media download failed: 404'))

    await runWebhook(IMAGE_MESSAGE)

    expect(h.state.upsertCalls[0].row).toMatchObject({
      media_url: '/api/whatsapp/media/1234567890123456',
    })
  })

  it('skips media larger than the bucket accepts, without downloading it', async () => {
    mockGetMediaUrl.mockResolvedValue({
      url: 'https://lookaside.fbsbx.com/whatsapp/big',
      mimeType: 'application/pdf',
      fileSize: 40 * 1024 * 1024,
    })

    await runWebhook({
      id: 'wamid.DOC1',
      from: '15551230000',
      timestamp: '1700000000',
      type: 'document',
      document: {
        id: '999',
        mime_type: 'application/pdf',
        filename: 'huge.pdf',
      },
    })

    expect(mockDownloadMedia).not.toHaveBeenCalled()
    expect(h.state.storageUploads).toHaveLength(0)
    expect(h.state.upsertCalls[0].row).toMatchObject({
      media_url: '/api/whatsapp/media/999',
      media_type: 'application/pdf',
    })
  })

  it("names the object after a document's own filename", async () => {
    mockGetMediaUrl.mockResolvedValue({
      url: 'https://lookaside.fbsbx.com/whatsapp/doc',
      mimeType: 'application/pdf',
      fileSize: 4096,
    })
    mockDownloadMedia.mockResolvedValue({
      buffer: Buffer.alloc(4096),
      contentType: 'application/pdf',
    })

    await runWebhook({
      id: 'wamid.DOC2',
      from: '15551230000',
      timestamp: '1700000000',
      type: 'document',
      document: {
        id: '1234567890123456',
        mime_type: 'application/pdf',
        filename: 'invoice.pdf',
        caption: 'have a look',
      },
    })

    expect(h.state.storageUploads[0].path).toBe(
      'account-acc-1/inbound/1234567890123456-invoice.pdf',
    )
  })

  it('does not mirror when the account has opted out', async () => {
    h.state.mirrorInboundMedia = false

    await runWebhook(IMAGE_MESSAGE)

    expect(mockDownloadMedia).not.toHaveBeenCalled()
    expect(h.state.storageUploads).toHaveLength(0)
    expect(h.state.upsertCalls[0].row).toMatchObject({
      media_url: '/api/whatsapp/media/1234567890123456',
      // Still recorded — the MIME type costs nothing and makes the
      // download name right even for proxied media.
      media_type: 'image/jpeg',
    })
  })

  it('mirrors when the column is absent, e.g. a row read before migration 039', async () => {
    h.state.mirrorInboundMedia = undefined

    await runWebhook(IMAGE_MESSAGE)

    expect(h.state.storageUploads).toHaveLength(1)
  })

  it('leaves text messages alone', async () => {
    await runWebhook()

    expect(mockGetMediaUrl).not.toHaveBeenCalled()
    expect(h.state.storageUploads).toHaveLength(0)
    expect(h.state.upsertCalls[0].row).toMatchObject({ media_type: null })
  })
})

describe('inbound webhook: after() awaits automations (#368)', () => {
  it('every triggered automation settles before the after() callback resolves', async () => {
    await runWebhook()

    // first_inbound_message + new_message_received + keyword_match.
    expect(h.state.automationStarted).toBe(3)
    // If the dispatches were fire-and-forget, completed would still be 0
    // here — the callback would have resolved before the timers fired.
    expect(h.state.automationCompleted).toBe(3)
  })
})

// ============================================================
// Business-scoped user IDs (issue #519)
//
// Meta stopped sending the phone number for a customer who has adopted
// a WhatsApp username: `messages[].from` and `contacts[].wa_id` are
// both absent, and only `from_user_id` / `user_id` identify them.
//
// Before the fix, `normalizePhone(undefined)` gave '', which
// `findExistingContact` refuses to look up, so every such delivery
// inserted a NEW contact — and migration 022's unique index is partial
// (`WHERE phone_normalized <> ''`) so nothing stopped it. One contact
// and one conversation per inbound message.
// ============================================================

const USERNAME_ONLY_MESSAGE = {
  id: 'wamid.BSUID1',
  from_user_id: 'US.13491208655302741918',
  from_parent_user_id: 'US.ENT.11815799212886844830',
  timestamp: '1700000000',
  type: 'text',
  text: { body: 'does it come in another color?' },
}

const USERNAME_ONLY_CONTACTS = [
  {
    profile: { name: 'Sheena Nelson', username: 'realsheenanelson' },
    user_id: 'US.13491208655302741918',
    parent_user_id: 'US.ENT.11815799212886844830',
  },
]

describe('inbound webhook: business-scoped user IDs (#519)', () => {
  it('creates ONE contact keyed on the BSUID when Meta sends no phone', async () => {
    // Nothing on file under either key yet.
    h.state.contactByWaUserId = null
    mockFindExistingContact.mockResolvedValue(null)

    await runWebhook(USERNAME_ONLY_MESSAGE, USERNAME_ONLY_CONTACTS)

    expect(h.state.contactInserts).toHaveLength(1)
    expect(h.state.contactInserts[0]).toMatchObject({
      account_id: 'acc-1',
      phone: '',
      wa_user_id: 'US.13491208655302741918',
      wa_parent_user_id: 'US.ENT.11815799212886844830',
      wa_username: 'realsheenanelson',
      name: 'Sheena Nelson',
    })
    // The message still lands in the thread.
    expect(h.state.upsertCalls).toHaveLength(1)
  })

  it('never looks the sender up by phone when there is no phone', async () => {
    h.state.contactByWaUserId = null
    mockFindExistingContact.mockResolvedValue(null)

    await runWebhook(USERNAME_ONLY_MESSAGE, USERNAME_ONLY_CONTACTS)

    // The old code called this with '' and got null every time, which
    // is exactly how the duplicate contacts got created.
    expect(mockFindExistingContact).not.toHaveBeenCalled()
  })

  it('reuses the existing contact on the SECOND message from the same BSUID', async () => {
    // The row the first message created.
    h.state.contactByWaUserId = {
      id: 'contact-bsuid',
      name: 'Sheena Nelson',
      phone: '',
      wa_user_id: 'US.13491208655302741918',
      wa_parent_user_id: 'US.ENT.11815799212886844830',
      wa_username: 'realsheenanelson',
    }
    mockFindExistingContact.mockResolvedValue(null)

    await runWebhook(
      { ...USERNAME_ONLY_MESSAGE, id: 'wamid.BSUID2' },
      USERNAME_ONLY_CONTACTS,
    )

    expect(h.state.contactInserts).toHaveLength(0)
    // Nothing about the identity changed, so no pointless UPDATE either.
    expect(h.state.contactUpdates).toHaveLength(0)
  })

  it('backfills the BSUID onto a contact we already knew by phone', async () => {
    // Transition payload: Meta sends both keys. We match on the phone
    // and stamp the BSUID so the next phone-less message still finds
    // this row instead of forking a new one.
    mockFindExistingContact.mockResolvedValue({
      id: 'contact-1',
      name: 'Pablo',
      phone: '16505551234',
    })

    await runWebhook(
      {
        id: 'wamid.BOTH',
        from: '16505551234',
        from_user_id: 'US.13491208655302741918',
        timestamp: '1700000000',
        type: 'text',
        text: { body: 'hi' },
      },
      [
        {
          profile: { name: 'Pablo', username: 'pablomorales' },
          wa_id: '16505551234',
          user_id: 'US.13491208655302741918',
        },
      ],
    )

    expect(h.state.contactInserts).toHaveLength(0)
    expect(h.state.contactUpdates).toHaveLength(1)
    expect(h.state.contactUpdates[0]).toMatchObject({
      wa_user_id: 'US.13491208655302741918',
      wa_username: 'pablomorales',
    })
    // The number we already had is left alone.
    expect(h.state.contactUpdates[0]).not.toHaveProperty('phone')
  })

  it('fills in the phone once Meta finally discloses it', async () => {
    h.state.contactByWaUserId = {
      id: 'contact-bsuid',
      name: 'Sheena Nelson',
      phone: '',
      wa_user_id: 'US.13491208655302741918',
      wa_username: 'realsheenanelson',
    }

    await runWebhook(
      {
        ...USERNAME_ONLY_MESSAGE,
        id: 'wamid.BSUID3',
        from: '16505551234',
      },
      USERNAME_ONLY_CONTACTS,
    )

    expect(h.state.contactUpdates).toHaveLength(1)
    expect(h.state.contactUpdates[0]).toMatchObject({ phone: '16505551234' })
  })

  it('drops a delivery that carries neither key rather than inventing a contact', async () => {
    mockFindExistingContact.mockResolvedValue(null)

    const res = await runWebhook(
      {
        id: 'wamid.ANON',
        timestamp: '1700000000',
        type: 'text',
        text: { body: 'who am i' },
      },
      [{ profile: { name: 'Nobody' } }],
    )

    expect(h.state.contactInserts).toHaveLength(0)
    expect(h.state.upsertCalls).toHaveLength(0)
    // Still a 200 — Meta must not be told to retry a payload we can
    // never process.
    expect(
      (res as unknown as { init?: { status?: number } }).init?.status,
    ).toBe(200)
  })

  it('leaves the legacy phone-only payload behaving exactly as before', async () => {
    await runWebhook()

    expect(mockFindExistingContact).toHaveBeenCalledWith(
      expect.anything(),
      'acc-1',
      '15551230000',
    )
    expect(h.state.contactInserts).toHaveLength(0)
    expect(h.state.contactUpdates).toHaveLength(0)
    expect(h.state.upsertCalls).toHaveLength(1)
  })
})

describe('inbound webhook: contact name backfill (#519 regression guard)', () => {
  it('never overwrites an edited name with the phone number', async () => {
    // Meta sends no profile name. The display fallback would resolve to
    // the phone number, and writing that back would replace whatever an
    // agent typed on the contact — on every single inbound message.
    mockFindExistingContact.mockResolvedValue({
      id: 'contact-1',
      name: 'Ada (VIP, calls Mondays)',
      phone: '15551230000',
    })

    await runWebhook(TEXT_MESSAGE, [{ wa_id: '15551230000', profile: {} }])

    expect(h.state.contactUpdates).toHaveLength(0)
  })

  it('does adopt a username when that is all Meta gives us', async () => {
    mockFindExistingContact.mockResolvedValue({
      id: 'contact-1',
      name: '15551230000',
      phone: '15551230000',
    })

    await runWebhook(TEXT_MESSAGE, [
      { wa_id: '15551230000', profile: { username: 'ada' } },
    ])

    expect(h.state.contactUpdates[0]).toMatchObject({ name: 'ada' })
  })
})

describe('template-lifecycle webhooks: WABA id is threaded to the handler (#534)', () => {
  it('passes entry.id as wabaId so an unknown template can be stubbed for the right account', async () => {
    const value = {
      event: 'APPROVED',
      message_template_id: '4242',
      message_template_name: 'created_in_meta',
      message_template_language: 'en_US',
    }
    const body = {
      entry: [
        {
          id: 'WABA-1',
          changes: [{ field: 'message_template_status_update', value }],
        },
      ],
    }
    const req = {
      text: async () => JSON.stringify(body),
      headers: { get: () => 'sha256=stub' },
    } as unknown as Request

    await POST(req)
    for (const cb of h.state.afterCallbacks) await cb()

    const mockHandle = vi.mocked(handleTemplateWebhookChange)
    expect(mockHandle).toHaveBeenCalledTimes(1)
    expect(mockHandle.mock.calls[0][0]).toEqual({
      field: 'message_template_status_update',
      value,
      wabaId: 'WABA-1',
    })
    // A template event must not fall through to the messaging branch.
    expect(h.state.upsertCalls).toHaveLength(0)
  })
})

describe('status webhook: failed statuses keep Meta\'s reason (#535)', () => {
  const FAILED_STATUS = {
    id: 'wamid.OUT1',
    status: 'failed',
    timestamp: '1700000100',
    recipient_id: '15551230000',
    errors: [
      {
        code: 131049,
        title: 'This message was not delivered to maintain healthy ecosystem engagement.',
        message: 'This message was not delivered to maintain healthy ecosystem engagement.',
        error_data: {
          details:
            'In order to maintain a healthy ecosystem engagement, the message failed to be delivered.',
        },
        href: 'https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes/',
      },
    ],
  }

  it('persists code, title and details on the messages row in the same update as status', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await runStatusWebhook(FAILED_STATUS)
    } finally {
      warn.mockRestore()
    }

    expect(h.state.messageUpdates).toHaveLength(1)
    expect(h.state.messageUpdates[0]).toEqual({
      status: 'failed',
      error_code: 131049,
      error_title: FAILED_STATUS.errors[0].title,
      error_details: FAILED_STATUS.errors[0].error_data.details,
    })
  })

  it('logs one warning line carrying the wamid, code and title', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await runStatusWebhook(FAILED_STATUS)
      expect(warn).toHaveBeenCalledTimes(1)
      const line = String(warn.mock.calls[0][0])
      expect(line).toContain('wamid.OUT1')
      expect(line).toContain('131049')
      expect(line).toContain(FAILED_STATUS.errors[0].title)
      expect(line).toContain(FAILED_STATUS.errors[0].error_data.details)
    } finally {
      warn.mockRestore()
    }
  })

  it('folds the reason into broadcast_recipients.error_message', async () => {
    h.state.broadcastRecipient = { id: 'rec-1', status: 'sent' }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await runStatusWebhook(FAILED_STATUS)
    } finally {
      warn.mockRestore()
    }

    expect(h.state.recipientUpdates).toHaveLength(1)
    expect(h.state.recipientUpdates[0].status).toBe('failed')
    const reason = String(h.state.recipientUpdates[0].error_message)
    expect(reason).toContain('131049')
    expect(reason).toContain(FAILED_STATUS.errors[0].title)
    expect(reason).toContain(FAILED_STATUS.errors[0].error_data.details)
  })

  it('a failed status with no errors array still flips status and stores no reason', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await runStatusWebhook({ ...FAILED_STATUS, errors: undefined })
    } finally {
      warn.mockRestore()
    }
    expect(warn).not.toHaveBeenCalled()
    expect(h.state.messageUpdates).toEqual([{ status: 'failed' }])
  })

  it('a plain delivered status updates only status — error columns untouched', async () => {
    h.state.broadcastRecipient = { id: 'rec-1', status: 'sent' }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await runStatusWebhook({
        id: 'wamid.OUT1',
        status: 'delivered',
        timestamp: '1700000100',
        recipient_id: '15551230000',
      })
    } finally {
      warn.mockRestore()
    }

    expect(warn).not.toHaveBeenCalled()
    expect(h.state.messageUpdates).toEqual([{ status: 'delivered' }])
    expect(h.state.recipientUpdates).toHaveLength(1)
    expect(h.state.recipientUpdates[0]).not.toHaveProperty('error_message')
    expect(h.state.recipientUpdates[0]).not.toHaveProperty('error_code')
  })
})


afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

describe('Embedded Signup webhook routing', () => {
  function useConnection(status = 'connected', accountId = 'embedded-account') {
    vi.stubEnv('WACRM_EMBEDDED_SIGNUP','1')
    vi.stubEnv('WACRM_TOKEN_ENC_KEY',Buffer.alloc(32,3).toString('base64'))
    h.embeddedRows=[{account_id:accountId,phone_number_id:'pn-1',status,token_ciphertext:encryptToken('dummy-embedded-token')}]
  }
  it.each(['embedded-account','second-account'])('routes phone_number_id to %s and its owner',async accountId => {
    useConnection('connected',accountId)
    mockFindExistingContact.mockResolvedValue(null)
    const r=await runWebhook()
    expect(r.init?.status).toBe(200)
    expect(h.lookups).toContainEqual(['phone_number_id','pn-1'])
    expect(h.lookups).toContainEqual(['account_id',accountId])
    expect(h.lookups).toContainEqual(['account_role','owner'])
    expect(mockFindExistingContact).toHaveBeenCalledWith(expect.anything(),accountId,'15551230000')
    expect(h.state.contactInserts[0]).toMatchObject({user_id:'embedded-owner',account_id:accountId})
  })
  it.each(['unknown','pending','disconnected','error'])('drops %s number with 200 without message or status mutations',async status => {
    useConnection(status)
    if(status==='unknown'){h.embeddedRows=[];h.legacyFound=false;}
    const r=await runWebhook()
    expect(r.init?.status).toBe(200)
    expect(h.state.upsertCalls).toEqual([]);expect(mockFindExistingContact).not.toHaveBeenCalled()
    await runStatusWebhook({id:'wamid.TEST1',status:'delivered',timestamp:'1700000000',recipient_id:'15551230000'})
    expect(h.state.messageUpdates).toEqual([]);expect(h.state.recipientUpdates).toEqual([])
  })
  it.each(['lookup','owner','ciphertext'])('fails closed on %s error',async kind => {
    useConnection()
    if(kind==='lookup')h.embeddedLookupError=true
    if(kind==='owner')h.ownerMissing=true
    if(kind==='ciphertext')h.embeddedRows[0].token_ciphertext='bad'
    await runWebhook();expect(h.state.upsertCalls).toEqual([])
  })
  it('logs only a constant diagnostic when the embedded mapping lookup DB error skips an event',async()=>{
    useConnection();h.embeddedLookupError=true;
    const warn=vi.spyOn(console,'warn').mockImplementation(()=>{});
    const r=await runWebhook();expect(r.init?.status).toBe(200);
    expect(warn.mock.calls).toEqual([['[webhook] embedded connection lookup failed; skipping event']]);
    const logs=JSON.stringify(warn.mock.calls);
    for(const value of ['private-db-details','pn-1','dummy-embedded-token','embedded-account'])expect(logs).not.toContain(value);
    expect(h.state.upsertCalls).toEqual([]);expect(mockFindExistingContact).not.toHaveBeenCalled();
  })
  it('scopes connected-number status updates to its own account, even when Meta ids collide',async () => {
    useConnection();h.scopedMessageIds=['only-owned-message']
    await runStatusWebhook({id:'wamid.COLLISION',status:'delivered',timestamp:'1700000000',recipient_id:'15551230000'})
    expect(h.state.messageUpdates).toEqual([{status:'delivered'}])
    expect(h.scopedStatusFilters).toContainEqual(['conversations.account_id','embedded-account'])
    expect(h.scopedStatusFilters).toContainEqual(['broadcasts.account_id','embedded-account'])
    expect(h.scopedStatusFilters).toContainEqual(['id',['only-owned-message']])
  })
  it('does not mutate another accounts status when no owned message matches',async () => {
    useConnection();h.scopedMessageIds=[]
    await runStatusWebhook({id:'wamid.OTHER',status:'delivered',timestamp:'1700000000',recipient_id:'15551230000'})
    expect(h.state.messageUpdates).toEqual([]);expect(h.state.recipientUpdates).toEqual([])
  })
  it('falls back to legacy config with flag on when no embedded row exists',async () => {
    useConnection();h.embeddedRows=[]
    const r=await runWebhook();expect(r.init?.status).toBe(200)
    expect(h.lookups).toContainEqual(['phone_number_id','pn-1'])
    expect(h.state.upsertCalls).toHaveLength(1)
    expect(mockFindExistingContact).toHaveBeenCalledWith(expect.anything(),'acc-1','15551230000')
  })
  it('distinguishes a missing connection from an inactive or unreadable one',async () => {
    useConnection();h.embeddedRows=[]
    expect(await resolveEmbeddedWebhookConnection('pn-1')).toEqual({status:'not_found'})
    useConnection('disconnected')
    expect(await resolveEmbeddedWebhookConnection('pn-1')).toEqual({status:'not_connected'})
    h.embeddedRows=[];h.embeddedLookupError=true
    expect(await resolveEmbeddedWebhookConnection('pn-1')).toEqual({status:'not_connected'})
  })
  it('runs the per-IP rate limiter before mandatory HMAC',async () => {
    await runWebhook();expect(h.gates.slice(0,2)).toEqual(['rate','hmac'])
  })
  it('rejects rate-limited traffic before reading the body or checking HMAC',async () => {
    h.rateLimited=true
    const request=inboundRequest();const text=vi.spyOn(request,'text')
    const r=await POST(request);expect(r.init?.status).toBe(429)
    expect(h.gates).toEqual(['rate']);expect(text).not.toHaveBeenCalled();expect(h.state.afterCallbacks).toEqual([])
  })
  it('persists the incoming ES number on normal inbox messages for same-number replies',async()=>{
    useConnection();await runWebhook();expect(h.state.upsertCalls[0].row).toMatchObject({interactive_payload:{_wacrm_phone_number_id:'pn-1'}});
  })
  it.each(['history','smb_message_echoes'])('imports %s without triggering automation or AI replies',async field=>{
    useConnection('pending');
    const message={id:'history-1',timestamp:'1700000000',type:'text',text:{body:'imported'},...(field==='smb_message_echoes'?{to:'15551230000'}:{from:'15551230000'})};
    const value={metadata:{phone_number_id:'pn-1'},...(field==='history'?{history:[{threads:[{id:'15551230000',messages:[message]}]}]}:{message_echoes:[message]})};
    const r=await POST({text:async()=>JSON.stringify({entry:[{id:'waba',changes:[{field,value}]}]}),headers:{get:()=> 'sha256=stub'}} as unknown as Request);
    for(const cb of h.state.afterCallbacks)await cb();
    expect(r.init?.status).toBe(200);
    expect(h.state.upsertCalls[0].row).toEqual([expect.objectContaining({message_id:'history-1',sender_type:field==='history'?'customer':'agent',interactive_payload:{_wacrm_phone_number_id:'pn-1'}})]);
    expect(h.dispatchInboundToFlows).not.toHaveBeenCalled();expect(h.dispatchInboundToAiReply).not.toHaveBeenCalled();expect(h.runAutomationsForTrigger).not.toHaveBeenCalled();
    expect(h.state.rpcCalls).toEqual([]);
  })
  it('ingests the documented contact state-sync payload under the resolved account',async()=>{
    useConnection('pending');
    const value={metadata:{phone_number_id:'pn-1'},state_sync:[{type:'contact',action:'add',contact:{phone_number:'15551230000',full_name:'Ada'}}]};
    await POST({text:async()=>JSON.stringify({entry:[{id:'waba',changes:[{field:'smb_app_state_sync',value}]}]}),headers:{get:()=> 'sha256=stub'}} as unknown as Request);
    for(const cb of h.state.afterCallbacks)await cb();
    expect(mockFindExistingContact).toHaveBeenCalledWith(expect.anything(),'embedded-account','15551230000');
    expect(h.state.upsertCalls).toEqual([]);expect(h.runAutomationsForTrigger).not.toHaveBeenCalled();
  })
  it('keeps legacy routing unchanged with flag off',async () => {
    await runWebhook()
    expect(h.lookups).toEqual([])
    expect(h.state.upsertCalls).toHaveLength(1)
    expect(mockFindExistingContact).toHaveBeenCalledWith(expect.anything(),'acc-1','15551230000')
  })
  it('requires HMAC before resolving any account or processing a message',async () => {
    useConnection();h.validSignature=false
    const r=await runWebhook()
    expect(r.init?.status).toBe(401);expect(h.lookups).toEqual([]);expect(h.state.afterCallbacks).toEqual([])
  })
})


describe('account_update webhook routing and signature gate',()=>{
  function request(signature: string | null) {
    return new Request('https://test.invalid/api/whatsapp/webhook', {
      method:'POST', headers: signature ? {'x-hub-signature-256':signature} : {},
      body:JSON.stringify({entry:[{id:'waba',time:1793354400,changes:[{
        field:'account_update',value:{event:'PARTNER_ADDED',waba_info:{waba_id:'waba'}}
      }]}]}),
    });
  }
  it.each([null,'sha256='+'0'.repeat(64)])('rejects signature %s before any DB access/writes or processing',async signature=>{
    vi.stubEnv('WACRM_EMBEDDED_SIGNUP','1');h.realSignature=true;
    const response=await POST(request(signature));
    expect(response.init?.status).toBe(401);
    expect(h.state.afterCallbacks).toEqual([]);expect(h.lookups).toEqual([]);
    expect(h.partnerWrites).toEqual([]);expect(h.state.upsertCalls).toEqual([]);
  });
  it('routes authenticated account_update to the partner handler before message routing',async()=>{
    vi.stubEnv('WACRM_EMBEDDED_SIGNUP','1');
    h.embeddedRows=[{id:'row',waba_id:'waba',status:'pending',updated_at:'2026-10-29T00:00:00Z'}];
    h.realSignature=true;vi.stubEnv('META_APP_SECRET','partner-test-secret');
    const unsigned=request(null);const body=await unsigned.text();
    const signature='sha256='+createHmac('sha256','partner-test-secret').update(body).digest('hex');
    const response=await POST(new Request(unsigned.url,{method:'POST',headers:{'x-hub-signature-256':signature},body}));
    for(const cb of h.state.afterCallbacks)await cb();
    expect(response.init?.status).toBe(200);expect(h.partnerWrites).toEqual([{status:'connected',last_error:null}]);
    expect(h.lookups).toEqual([['waba_id','waba']]);expect(h.state.upsertCalls).toEqual([]);
  });
  it('acks unknown WABA with no writes',async()=>{
    vi.stubEnv('WACRM_EMBEDDED_SIGNUP','1');
    const response=await POST(request('sha256=stub'));
    for(const cb of h.state.afterCallbacks)await cb();
    expect(response.init?.status).toBe(200);expect(h.partnerWrites).toEqual([]);
  });
  it('ignores account_update when the feature is disabled',async()=>{
    const response=await POST(request('sha256=stub'));
    for(const cb of h.state.afterCallbacks)await cb();
    expect(response.init?.status).toBe(200);expect(h.lookups).toEqual([]);expect(h.partnerWrites).toEqual([]);
  });
});

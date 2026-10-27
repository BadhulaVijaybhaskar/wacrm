/**
 * Zod schemas for Connect read/handoff API query + body params.
 * Validated before auth/DB so malformed input returns 400 even when
 * Supabase is unavailable (staging probe contract).
 */

import { z } from 'zod'

const LIMIT_MSG = 'limit must be an integer between 1 and 100'

/** Optional `limit` query: default 50, reject non-integers / out of range. */
export const connectLimitSchema = z
  .string()
  .optional()
  .transform((raw, ctx) => {
    if (raw == null || raw === '') return 50
    if (!/^\d+$/.test(raw)) {
      ctx.addIssue({ code: 'custom', message: LIMIT_MSG })
      return z.NEVER
    }
    const n = Number(raw)
    if (n < 1 || n > 100) {
      ctx.addIssue({ code: 'custom', message: LIMIT_MSG })
      return z.NEVER
    }
    return n
  })

function optionalTrimmed() {
  return z
    .string()
    .optional()
    .transform((v) => {
      if (v == null) return null
      const t = v.trim()
      return t.length > 0 ? t : null
    })
}

function optionalHandoff() {
  return z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (v == null || v === '') return null
      if (v === 'ai' || v === 'human') return v as 'ai' | 'human'
      ctx.addIssue({ code: 'custom', message: 'handoff must be ai or human' })
      return z.NEVER
    })
}

export const conversationsQuerySchema = z.object({
  tenant_id: z
    .string({ error: 'tenant_id is required' })
    .trim()
    .min(1, 'tenant_id is required'),
  employee_id: optionalTrimmed(),
  phone_number_id: optionalTrimmed(),
  handoff: optionalHandoff(),
  status: optionalTrimmed(),
  updated_since: optionalTrimmed(),
  cursor: optionalTrimmed(),
  limit: connectLimitSchema,
})

export const messagesQuerySchema = z.object({
  tenant_id: z
    .string({ error: 'tenant_id is required' })
    .trim()
    .min(1, 'tenant_id is required'),
  before: optionalTrimmed(),
  after: optionalTrimmed(),
  cursor: optionalTrimmed(),
  limit: connectLimitSchema,
})

export const takeoverBodySchema = z.object({
  tenant_id: z
    .string({ error: 'tenant_id is required' })
    .trim()
    .min(1, 'tenant_id is required'),
  by: z
    .string()
    .optional()
    .nullable()
    .transform((v) => (typeof v === 'string' ? v : null)),
  reason: z
    .string()
    .max(500, 'reason must be at most 500 characters')
    .optional()
    .nullable()
    .transform((v) => {
      if (v == null || typeof v !== 'string') return null
      const t = v.trim()
      return t.length > 0 ? t : null
    }),
})

export const handbackBodySchema = z.object({
  tenant_id: z
    .string({ error: 'tenant_id is required' })
    .trim()
    .min(1, 'tenant_id is required'),
  by: z
    .string()
    .optional()
    .nullable()
    .transform((v) => (typeof v === 'string' ? v : null)),
})

export type ConversationsQuery = z.infer<typeof conversationsQuerySchema>
export type MessagesQuery = z.infer<typeof messagesQuerySchema>
export type TakeoverBody = z.infer<typeof takeoverBodySchema>
export type HandbackBody = z.infer<typeof handbackBodySchema>

/** First zod issue message, or a generic fallback. */
export function zodErrorMessage(
  error: z.ZodError,
  fallback = 'Invalid request',
): string {
  return error.issues[0]?.message ?? fallback
}

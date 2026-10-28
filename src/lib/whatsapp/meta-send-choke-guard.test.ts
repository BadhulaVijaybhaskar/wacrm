/**
 * Guard: every Meta Cloud API content send must go through
 * postCloudApiMessages so the Connect channels.whatsapp gate cannot be
 * bypassed. Typing indicators also use that helper (with skipChannelGate).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(process.cwd(), 'src')
const META_MESSAGES_RE =
  /graph\.facebook\.com\/[^`"'\s]+\/messages|\/\$\{[^}]+\}\/messages|phoneNumberId\}\/messages/

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) {
      out.push(full)
    }
  }
  return out
}

describe('Meta /messages choke-point guard', () => {
  it('only meta-api.ts posts to the Cloud API messages endpoint', () => {
    const offenders: string[] = []
    for (const file of walk(ROOT)) {
      const rel = relative(process.cwd(), file)
      if (rel === 'src/lib/whatsapp/meta-api.ts') continue
      const src = readFileSync(file, 'utf8')
      // Strip comments so docs URLs don't trip the guard.
      const code = src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1')
      if (META_MESSAGES_RE.test(code)) {
        offenders.push(rel)
      }
      // Direct fetch to a messages URL built ad-hoc.
      if (
        /fetch\s*\(\s*[`'"].*\/messages/.test(code) ||
        /fetch\s*\(\s*`\$\{META_API_BASE\}/.test(code)
      ) {
        offenders.push(rel)
      }
    }
    expect(offenders, `direct Meta /messages callers: ${offenders.join(', ')}`).toEqual(
      [],
    )
  })

  it('meta-api content sends go through postCloudApiMessages', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/lib/whatsapp/meta-api.ts'),
      'utf8',
    )
    expect(src).toMatch(/export async function postCloudApiMessages/)
    expect(src).toMatch(/assertWhatsAppChannelEnabledForAccount/)

    // The only raw `/messages` URL construction lives inside the choke.
    const urlBuilds = [
      ...src.matchAll(/\$\{META_API_BASE\}\/\$\{[^}]+\}\/messages/g),
    ]
    expect(urlBuilds.length).toBe(1)

    for (const name of [
      'sendTextMessage',
      'sendMediaMessage',
      'sendTemplateMessage',
      'sendReactionMessage',
      'sendInteractiveButtons',
      'sendInteractiveList',
    ]) {
      const fnStart = src.indexOf(`export async function ${name}`)
      expect(fnStart, name).toBeGreaterThanOrEqual(0)
      const nextExport = src.indexOf('\nexport async function ', fnStart + 1)
      const body = src.slice(fnStart, nextExport === -1 ? undefined : nextExport)
      expect(body, name).toMatch(/postCloudApiMessages\s*\(/)
    }
  })

  it('outbound send paths pass accountId into Meta helpers', () => {
    const paths = [
      'src/lib/whatsapp/send-message.ts',
      'src/lib/whatsapp/broadcast-core.ts',
      'src/app/api/whatsapp/broadcast/route.ts',
      'src/lib/automations/meta-send.ts',
      'src/lib/flows/meta-send.ts',
      'src/app/api/whatsapp/react/route.ts',
    ] as const
    for (const rel of paths) {
      const src = readFileSync(join(process.cwd(), rel), 'utf8')
      expect(src, rel).toMatch(/accountId/)
    }
  })
})

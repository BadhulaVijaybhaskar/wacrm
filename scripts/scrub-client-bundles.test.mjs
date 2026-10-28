import { describe, expect, it } from 'vitest'
import {
  findBrandHits,
  maskAllowedBakedBrandValues,
} from './scrub-client-bundles.mjs'

describe('scrub allowlist — baked schema/prefix only', () => {
  it('allows exact quoted schema value "wacrm"', () => {
    const src = 'return{db:{schema:"wacrm"}}'
    expect(findBrandHits(src)).toEqual([])
    expect(maskAllowedBakedBrandValues(src)).toContain('__BAKED_DB_SCHEMA__')
  })

  it("allows exact quoted schema value 'wacrm'", () => {
    expect(findBrandHits("schema:'wacrm'")).toEqual([])
  })

  it('allows exact quoted bucket prefix "wacrm-"', () => {
    const src = 'const p="wacrm-";return p+"avatars"'
    expect(findBrandHits(src)).toEqual([])
    expect(maskAllowedBakedBrandValues(src)).toContain('__BAKED_STORAGE_PREFIX__')
  })

  it("allows exact quoted bucket prefix 'wacrm-'", () => {
    expect(findBrandHits("prefix='wacrm-'")).toEqual([])
  })

  it('allows minified template-literal bucket prefix `wacrm-${…}`', () => {
    const src = 'function(e){return`wacrm-${e}`}'
    expect(findBrandHits(src)).toEqual([])
  })

  it('still fails on unquoted wacrm brand tokens', () => {
    const hits = findBrandHits('Welcome to wacrm staging')
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0].match.toLowerCase()).toBe('wacrm')
  })

  it('still fails on hostname / product brand forms', () => {
    expect(findBrandHits('https://wacrm.tech/docs').length).toBeGreaterThan(0)
    expect(findBrandHits('crm template for whatsapp').length).toBeGreaterThan(0)
  })

  it('still fails when wacrm appears outside the exact quoted bake-ins', () => {
    // Concatenated bucket id as a single literal is not an allowlisted bake-in.
    expect(findBrandHits('bucket:"wacrm-avatars"').length).toBeGreaterThan(0)
    // Prose / realm string (quoted schema allowlist does not cover trailing words).
    expect(findBrandHits('auth_basic "wacrm staging"').length).toBeGreaterThan(0)
    // Unquoted identifier / path segment.
    expect(findBrandHits('from("wacrm.profiles")').length).toBeGreaterThan(0)
    // Brand word next to an allowed bake-in still fails.
    expect(
      findBrandHits('schema:"wacrm";/* powered by wacrm */').length,
    ).toBeGreaterThan(0)
  })

  it('allowlists only the quoted bake-in inside a mixed snippet', () => {
    // After masking "wacrm", no other brand token remains → pass.
    expect(findBrandHits('env.NEXT_PUBLIC_SUPABASE_DB_SCHEMA="wacrm"')).toEqual([])
  })

  it('masks prefix before schema so "wacrm-" is not partially eaten', () => {
    const masked = maskAllowedBakedBrandValues('"wacrm-"+x+"wacrm"')
    expect(masked).toBe('"__BAKED_STORAGE_PREFIX__"+x+"__BAKED_DB_SCHEMA__"')
  })
})

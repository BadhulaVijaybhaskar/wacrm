import { describe, expect, it } from 'vitest'
import {
  getSignupMode,
  isEmailAllowlisted,
  mayAutoCreateOwnerAccount,
  mayProvisionChatProfile,
  parseSignupAllowlist,
} from './signup-gate'

describe('getSignupMode', () => {
  it('defaults to open', () => {
    expect(getSignupMode({})).toBe('open')
    expect(getSignupMode({ WACRM_SIGNUP_MODE: 'OPEN' })).toBe('open')
  })

  it('accepts invite', () => {
    expect(getSignupMode({ WACRM_SIGNUP_MODE: 'invite' })).toBe('invite')
  })
})

describe('parseSignupAllowlist / isEmailAllowlisted', () => {
  it('matches exact emails and @domains', () => {
    const env = {
      WACRM_SIGNUP_ALLOWLIST: 'Ada@Acme.com, @partner.org, friends.co',
    }
    expect(isEmailAllowlisted('ada@acme.com', env)).toBe(true)
    expect(isEmailAllowlisted('bob@partner.org', env)).toBe(true)
    expect(isEmailAllowlisted('x@friends.co', env)).toBe(true)
    expect(isEmailAllowlisted('other@elsewhere.com', env)).toBe(false)
  })

  it('parses empty safely', () => {
    expect(parseSignupAllowlist('')).toEqual({
      emails: new Set(),
      domains: new Set(),
    })
  })
})

describe('mayProvisionChatProfile / mayAutoCreateOwnerAccount', () => {
  const inviteEnv = {
    WACRM_SIGNUP_MODE: 'invite',
    WACRM_SIGNUP_ALLOWLIST: 'ok@acme.com,@acme.com',
  }

  it('open mode always allows', () => {
    expect(
      mayAutoCreateOwnerAccount({ email: 'anyone@x.com', env: {} }).allowed,
    ).toBe(true)
  })

  it('invite mode blocks strangers from owner auto-create', () => {
    const r = mayAutoCreateOwnerAccount({
      email: 'stranger@x.com',
      env: inviteEnv,
    })
    expect(r.allowed).toBe(false)
    expect(r.reason).toBe('invite_only')
  })

  it('invite mode allows allowlisted owner create', () => {
    expect(
      mayAutoCreateOwnerAccount({
        email: 'ok@acme.com',
        env: inviteEnv,
      }).allowed,
    ).toBe(true)
  })

  it('invite token allows signup UI but not owner auto-create', () => {
    expect(
      mayProvisionChatProfile({
        email: 'stranger@x.com',
        hasInviteToken: true,
        env: inviteEnv,
      }).allowed,
    ).toBe(true)
    expect(
      mayAutoCreateOwnerAccount({
        email: 'stranger@x.com',
        env: inviteEnv,
      }).allowed,
    ).toBe(false)
  })
})

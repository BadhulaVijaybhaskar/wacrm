import { describe, expect, it } from 'vitest';
import {
  astraConnectAdapterStatusMessageKey,
  resolveAstraConnectAdapterStatus,
} from './adapter-status';

describe('resolveAstraConnectAdapterStatus', () => {
  it('is inactive when the toggle is off — even if env is ready', () => {
    expect(
      resolveAstraConnectAdapterStatus({
        enabled: false,
        envConfigured: true,
        tenantId: 't_1',
      }),
    ).toBe('inactive');
  });

  it('is waiting_server when toggle is on but server env is incomplete (item 4a UI)', () => {
    expect(
      resolveAstraConnectAdapterStatus({
        enabled: true,
        envConfigured: false,
        tenantId: 't_demo_seed',
      }),
    ).toBe('waiting_server');
    expect(
      astraConnectAdapterStatusMessageKey('waiting_server'),
    ).toBe('statusWaitingServer');
  });

  it('is waiting_tenant when toggle + env are ready but tenant id is blank', () => {
    expect(
      resolveAstraConnectAdapterStatus({
        enabled: true,
        envConfigured: true,
        tenantId: '  ',
      }),
    ).toBe('waiting_tenant');
  });

  it('is active only when toggle, env, and tenant are all set', () => {
    expect(
      resolveAstraConnectAdapterStatus({
        enabled: true,
        envConfigured: true,
        tenantId: 't_1',
      }),
    ).toBe('active');
  });
});

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SettingsLayout from '@/app/(dashboard)/settings/layout';
import { EmbeddedSignupCard } from './embedded-signup-card';
import { EmbeddedSignupProvider } from './embedded-signup-provider';

const h = vi.hoisted(() => ({ effects: [] as (() => unknown)[] }));
// Capture mount effects in the existing server-render test harness, then execute
// them explicitly: this checks the real card's fetch without a browser/SDK.
vi.mock('next/server', () => ({ connection: vi.fn(async () => {}) }));
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useEffect: (effect: () => unknown) => { h.effects.push(effect); },
}));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ canEditSettings: true, accountId: 'account' }) }));
afterEach(() => { h.effects = []; vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe('Embedded Signup feature flag', () => {
  it.each(['0','1',undefined])('passes the runtime server flag %s through the settings provider', async flag => {
    vi.stubEnv('WACRM_EMBEDDED_SIGNUP', flag);
    const result = await SettingsLayout({ children: 'settings' });
    expect(result.type).toBe(EmbeddedSignupProvider);
    expect(result.props.enabled).toBe(flag === '1');
    expect(result.props.children).toBe('settings');
  });
  it.each([false, true])('fetches connections only when enabled=%s', async enabled => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ connections: [] }) });
    vi.stubGlobal('fetch', fetch);
    renderToStaticMarkup(createElement(EmbeddedSignupProvider, { enabled }, createElement(EmbeddedSignupCard)));
    for (const effect of h.effects) effect();
    await Promise.resolve();
    expect(fetch).toHaveBeenCalledTimes(enabled ? 1 : 0);
    if (enabled) expect(fetch).toHaveBeenCalledWith('/api/whatsapp/embedded-signup/connections');
  });
});

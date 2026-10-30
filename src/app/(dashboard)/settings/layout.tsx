import { connection } from 'next/server';
import { EmbeddedSignupProvider } from '@/components/settings/embedded-signup-provider';

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  await connection();
  return <EmbeddedSignupProvider enabled={process.env.WACRM_EMBEDDED_SIGNUP === '1'}>{children}</EmbeddedSignupProvider>;
}

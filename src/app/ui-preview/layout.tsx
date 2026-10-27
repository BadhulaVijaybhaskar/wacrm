import { notFound } from 'next/navigation';

/**
 * Internal mock surfaces for screenshots / verification.
 * Never statically prerender — gate at request time so a prod deploy
 * cannot ship these pages even if UI_PREVIEW leaked into the build env.
 * Allowed in non-production always; in production only when UI_PREVIEW=1
 * (middleware also 404s).
 */
export const dynamic = 'force-dynamic';

export default function UiPreviewLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const allowed =
    process.env.NODE_ENV !== 'production' || process.env.UI_PREVIEW === '1';
  if (!allowed) notFound();
  return children;
}

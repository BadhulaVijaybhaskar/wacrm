import { notFound } from 'next/navigation';

/**
 * Internal mock surfaces for screenshots / verification.
 * Allowed in non-production always; in production only when UI_PREVIEW=1
 * (middleware also 404s — this is defense in depth so the segment never
 * renders in a normal prod deploy).
 */
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

import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import { Plus_Jakarta_Sans } from 'next/font/google';
import Script from 'next/script';
import './globals.css';
import { ThemeProvider } from '@/hooks/use-theme';
import { ThemedToaster } from '@/components/themed-toaster';
import { OG_IMAGE_PATH, resolveMetadataBase } from '@/lib/metadata-base';
import {
  DEFAULT_MODE,
  DEFAULT_THEME,
  LEGACY_MODE_STORAGE_KEY,
  LEGACY_STORAGE_KEY,
  MODE_STORAGE_KEY,
  MODES,
  STORAGE_KEY,
  THEME_IDS,
  THEMES,
} from '@/lib/themes';

const plusJakartaSans = Plus_Jakarta_Sans({
  variable: '--font-plus-jakarta',
  subsets: ['latin'],
  display: 'swap',
});

const APP_METADATA = {
  title: {
    default: 'Astra Chat',
    template: '%s — Astra Chat',
  },
  description: 'Astra Chat — messaging workspace for Astra Connect.',
  applicationName: 'Astra Chat',
  robots: {
    index: false,
    follow: false,
  },
  icons: {
    icon: [
      { url: '/favicon.ico' },
      { url: '/icons/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icons/favicon-16.png', sizes: '16x16', type: 'image/png' },
    ],
    shortcut: '/favicon.ico',
    apple: [
      {
        url: '/icons/apple-touch-icon.png',
        sizes: '180x180',
        type: 'image/png',
      },
    ],
  },
  openGraph: {
    title: 'Astra Chat',
    description: 'Astra Chat — messaging workspace for Astra Connect.',
    siteName: 'Astra Chat',
    type: 'website' as const,
    images: [{ url: OG_IMAGE_PATH, alt: 'Astra Chat' }],
  },
  twitter: {
    card: 'summary_large_image' as const,
    title: 'Astra Chat',
    description: 'Astra Chat — messaging workspace for Astra Connect.',
    images: [OG_IMAGE_PATH],
  },
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
} satisfies Metadata;

/**
 * metadataBase comes from NEXT_PUBLIC_SITE_URL. In development only we
 * fall back to the request host so local `next dev` OG previews stay
 * absolute without inventing a production origin from Host headers.
 */
export async function generateMetadata(): Promise<Metadata> {
  const headerStore =
    process.env.NODE_ENV === 'development' ? await headers() : null;
  return {
    ...APP_METADATA,
    metadataBase: resolveMetadataBase({
      headers: headerStore,
    }),
  };
}

export const viewport: Viewport = {
  themeColor: '#F3F6FA',
  colorScheme: 'light dark',
};

const THEME_ACCENTS = Object.fromEntries(
  THEMES.map(({ id, ac, ac2, acm, l, night }) => [
    id,
    { ac, ac2, acm, l, night },
  ])
);

// Runs before first paint. It accepts Connect's current keys, migrates
// earlier astra-chat.* values, and applies mode/accent without a flash.
const THEME_BOOT_SCRIPT = `
(function(){
  var d = document.documentElement;
  var DEFAULT_THEME = ${JSON.stringify(DEFAULT_THEME)};
  var DEFAULT_MODE = ${JSON.stringify(DEFAULT_MODE)};
  var THEMES = ${JSON.stringify(THEME_IDS)};
  var MODES = ${JSON.stringify(MODES)};
  var ACCENTS = ${JSON.stringify(THEME_ACCENTS)};
  var theme = DEFAULT_THEME;
  var mode = DEFAULT_MODE;

  function apply() {
    d.classList.toggle("dark", mode === "dark");
    d.dataset.mode = mode;
    if (theme === DEFAULT_THEME) {
      delete d.dataset.accent;
      ["--ac","--ac2","--acm","--ac-l","--night"].forEach(function(key) {
        d.style.removeProperty(key);
      });
      return;
    }
    var a = ACCENTS[theme];
    d.dataset.accent = theme;
    d.style.setProperty("--ac", a.ac);
    d.style.setProperty("--ac2", a.ac2);
    d.style.setProperty("--acm", a.acm);
    d.style.setProperty("--ac-l", a.l);
    d.style.setProperty("--night", a.night);
  }

  try {
    var record = {};
    try {
      record = JSON.parse(localStorage.getItem(${JSON.stringify(STORAGE_KEY)}) || "{}") || {};
    } catch (_jsonError) {}

    var legacyTheme = localStorage.getItem(${JSON.stringify(LEGACY_STORAGE_KEY)});
    var savedTheme = THEMES.indexOf(record.id) !== -1 ? record.id : legacyTheme;
    if (THEMES.indexOf(savedTheme) !== -1) theme = savedTheme;

    var connectMode = localStorage.getItem(${JSON.stringify(MODE_STORAGE_KEY)});
    var legacyMode = localStorage.getItem(${JSON.stringify(LEGACY_MODE_STORAGE_KEY)});
    if (MODES.indexOf(connectMode) !== -1) mode = connectMode;
    else if (typeof record.dark === "boolean") mode = record.dark ? "dark" : "light";
    else if (MODES.indexOf(legacyMode) !== -1) mode = legacyMode;
    else if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
      mode = "dark";
    }

    apply();
    localStorage.setItem(${JSON.stringify(MODE_STORAGE_KEY)}, mode);
    localStorage.setItem(${JSON.stringify(STORAGE_KEY)}, JSON.stringify({ id: theme, dark: mode === "dark" }));
    localStorage.setItem(${JSON.stringify(LEGACY_STORAGE_KEY)}, theme);
    localStorage.setItem(${JSON.stringify(LEGACY_MODE_STORAGE_KEY)}, mode);
  } catch (_e) {
    apply();
  }
})();
`;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html
      lang={locale}
      data-mode={DEFAULT_MODE}
      className={`${plusJakartaSans.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <Script
          id="theme-boot"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }}
        />
      </head>
      <body className="bg-background text-foreground min-h-full font-sans">
        <NextIntlClientProvider messages={messages} locale={locale}>
          <ThemeProvider>
            {children}
            <ThemedToaster />
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}

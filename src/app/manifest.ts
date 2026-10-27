import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Astra Chat',
    short_name: 'Astra Chat',
    description: 'Astra Chat — messaging workspace for Astra Connect.',
    start_url: '/dashboard',
    display: 'standalone',
    background_color: '#F3F6FA',
    theme_color: '#F3F6FA',
    icons: [
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
      },
    ],
  };
}

export const THEME_IDS = [
  'astra',
  'violet',
  'emerald',
  'sunset',
  'rose',
  'indigo',
  'slate',
] as const;

export type ThemeId = (typeof THEME_IDS)[number];

export const DEFAULT_THEME: ThemeId = 'astra';

/** Connect-compatible preference keys. */
export const STORAGE_KEY = 'astra-theme';
export const MODE_STORAGE_KEY = 'astra.v2.theme';

/** Legacy Chat keys are read once and mirrored during migration. */
export const LEGACY_STORAGE_KEY = 'astra-chat.theme';
export const LEGACY_MODE_STORAGE_KEY = 'astra-chat.mode';

export const MODES = ['light', 'dark'] as const;

export type Mode = (typeof MODES)[number];

export const DEFAULT_MODE: Mode = 'light';

export function isMode(value: unknown): value is Mode {
  return (
    typeof value === 'string' &&
    (MODES as ReadonlyArray<string>).includes(value)
  );
}

export interface ThemeMeta {
  id: ThemeId;
  name: string;
  tagline: string;
  swatch: string;
  ac: string;
  ac2: string;
  acm: string;
  l: string;
  night: string;
}

export const THEMES: ReadonlyArray<ThemeMeta> = [
  {
    id: 'astra',
    name: 'Astra Blue + Teal',
    tagline: 'The signature Astra Connect palette.',
    swatch: '#145CF6',
    ac: '#145CF6',
    ac2: '#09B5A4',
    acm: '#0E8BD6',
    l: '#7FA6FF',
    night: '#0A1426',
  },
  {
    id: 'violet',
    name: 'Violet',
    tagline: 'Expressive violet with a warm magenta finish.',
    swatch: '#7C3AED',
    ac: '#7C3AED',
    ac2: '#DB2777',
    acm: '#A855F7',
    l: '#C4B5FD',
    night: '#150B2E',
  },
  {
    id: 'emerald',
    name: 'Emerald',
    tagline: 'Fresh emerald balanced by a clear sky blue.',
    swatch: '#059669',
    ac: '#059669',
    ac2: '#0EA5E9',
    acm: '#10B981',
    l: '#6EE7B7',
    night: '#06201A',
  },
  {
    id: 'sunset',
    name: 'Sunset Orange',
    tagline: 'Warm orange and rose for an energetic workspace.',
    swatch: '#EA580C',
    ac: '#EA580C',
    ac2: '#E11D48',
    acm: '#F97316',
    l: '#FDBA74',
    night: '#241008',
  },
  {
    id: 'rose',
    name: 'Rose',
    tagline: 'Bold rose softened with a golden highlight.',
    swatch: '#E11D48',
    ac: '#E11D48',
    ac2: '#F59E0B',
    acm: '#F43F5E',
    l: '#FDA4AF',
    night: '#260A14',
  },
  {
    id: 'indigo',
    name: 'Indigo',
    tagline: 'Focused indigo with a crisp cyan edge.',
    swatch: '#4F46E5',
    ac: '#4F46E5',
    ac2: '#06B6D4',
    acm: '#6366F1',
    l: '#A5B4FC',
    night: '#0F0E2E',
  },
  {
    id: 'slate',
    name: 'Slate',
    tagline: 'A restrained slate palette with a teal accent.',
    swatch: '#334155',
    ac: '#334155',
    ac2: '#0D9488',
    acm: '#475569',
    l: '#CBD5E1',
    night: '#0B1220',
  },
];

export function isThemeId(value: unknown): value is ThemeId {
  return (
    typeof value === 'string' &&
    (THEME_IDS as ReadonlyArray<string>).includes(value)
  );
}

export function getThemeMeta(id: ThemeId): ThemeMeta {
  return THEMES.find((theme) => theme.id === id) ?? THEMES[0];
}

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createTranslator } from 'next-intl';

// Some catalogue strings are deliberately not ICU messages: template
// placeholders show the literal WhatsApp `{{1}}` syntax to the user, and
// a few setup steps carry raw HTML destined for dangerouslySetInnerHTML.
// next-intl's ICU parser rejects both.
//
// It rejects them *quietly*: `t()` reports INVALID_MESSAGE / FORMATTING_ERROR
// to onError and then renders the keypath itself, so the field shows
// "Settings.templates.bodyPlaceholder" instead of the placeholder. Nothing
// throws, no build fails, and dev looks the same as prod — which is how
// twelve of these shipped unnoticed.
//
// Such strings must be read with `t.raw()` (bypasses the parser) or
// `t.rich()` (tag handlers). This test fails when one is wired to plain
// `t()`. Reported by @Arifuzzamanjoy in #421.

const MESSAGES = join(process.cwd(), 'messages', 'en.json');
const SRC = join(process.cwd(), 'src');

/**
 * Leaf keypaths that must not be fed to plain `t()`.
 * Includes WhatsApp `{{n}}` / attribute-bearing HTML (always hostile for
 * our catalogue) plus anything next-intl still flags as INVALID_MESSAGE.
 */
function icuHostileKeys(): string[] {
  const catalogue = JSON.parse(readFileSync(MESSAGES, 'utf8'));
  const leaves: { key: string; value: string }[] = [];
  const walk = (node: unknown, path: string) => {
    if (node && typeof node === 'object' && !Array.isArray(node)) {
      for (const [k, v] of Object.entries(node)) walk(v, path ? `${path}.${k}` : k);
      return;
    }
    if (typeof node === 'string') leaves.push({ key: path, value: node });
  };
  walk(catalogue, '');

  return leaves
    .filter(({ key, value }) => {
      if (/\{\{/.test(value)) return true;
      if (/<[A-Za-z][\w-]*\s/.test(value)) return true;
      if (/^\s*\{\s*"/.test(value)) return true;
      let code = '';
      const t = createTranslator({
        locale: 'en',
        messages: catalogue,
        onError: (err) => {
          code = err.code;
        },
      });
      t(key as never);
      // INVALID_MESSAGE only — excludes FORMATTING_ERROR (missing values /
      // tag handlers on otherwise well-formed ICU).
      return code === 'INVALID_MESSAGE';
    })
    .map(({ key }) => key);
}

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return tsxFiles(full);
    return full.endsWith('.tsx') ? [full] : [];
  });
}

describe('ICU-hostile strings are not read with plain t()', () => {
  it('every {{…}} / raw-HTML message is consumed via t.raw() or t.rich()', () => {
    const hostile = icuHostileKeys();
    // Guard the guard: if this ever hits zero the walk or the parser probe
    // has broken, and the test would pass vacuously.
    expect(hostile.length).toBeGreaterThan(0);

    const sources = tsxFiles(SRC).map((path) => ({
      path,
      text: readFileSync(path, 'utf8'),
    }));

    const offenders: string[] = [];

    for (const key of hostile) {
      const namespace = key.slice(0, key.lastIndexOf('.'));
      const leaf = key.slice(key.lastIndexOf('.') + 1);

      for (const { path, text } of sources) {
        // Leaf names repeat across namespaces ('delete', 'desc', …), so only
        // consider a file that actually opens this key's namespace. The call
        // may use a trailing sub-path (useTranslations('Settings.templates')
        // + t('config.foo')), so match on any namespace prefix.
        const opensNamespace = [...text.matchAll(/useTranslations\(\s*['"]([^'"]+)['"]/g)].some(
          (m) => namespace === m[1] || namespace.startsWith(`${m[1]}.`),
        );
        if (!opensNamespace) continue;

        // A plain call: `t('leaf')` or `t("a.leaf")`, but not `.raw(` / `.rich(`.
        const plainCall = new RegExp(
          String.raw`(?<![.\w])t\(\s*['"](?:[\w.]+\.)?${leaf}['"]`,
        );
        if (plainCall.test(text)) {
          offenders.push(`${key} — plain t() in ${path.replace(process.cwd() + '/', '')}`);
        }
      }
    }

    expect(
      offenders.sort(),
      'these render as their own keypath at runtime; use t.raw() (or t.rich() with tag handlers)',
    ).toEqual([]);
  });
});

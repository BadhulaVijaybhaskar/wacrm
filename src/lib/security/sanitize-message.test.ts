import { describe, expect, it } from 'vitest';
import {
  escapeHtml,
  escapeInteractivePayloadHtml,
  sanitizeInteractivePayload,
  sanitizeLinkPreviewUrl,
  sanitizeMessageText,
  stripControlChars,
} from './sanitize-message';

describe('sanitizeMessageText / escapeHtml', () => {
  it('escapes script and HTML injection payloads', () => {
    const malicious = `<script>alert('xss')</script><img src=x onerror="alert(1)">`;
    expect(sanitizeMessageText(malicious)).toBe(
      '&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;&lt;img src=x onerror=&quot;alert(1)&quot;&gt;',
    );
    expect(escapeHtml(`a & b < c > d " e ' f`)).toBe(
      'a &amp; b &lt; c &gt; d &quot; e &#39; f',
    );
  });

  it('strips control characters from captions', () => {
    expect(stripControlChars('hi\u0000there\u0007')).toBe('hithere');
    expect(sanitizeMessageText('hi\u0000there\u0007')).toBe('hithere');
  });
});

describe('sanitizeInteractivePayload', () => {
  it('strips controls for React sinks and HTML-escapes for raw HTML sinks', () => {
    const payload = {
      kind: 'buttons',
      body: '<b>hi</b>\u0000',
      buttons: [{ id: '1', title: '<img onerror=alert(1)>' }],
    };
    expect(sanitizeInteractivePayload(payload)).toEqual({
      kind: 'buttons',
      body: '<b>hi</b>',
      buttons: [{ id: '1', title: '<img onerror=alert(1)>' }],
    });
    expect(escapeInteractivePayloadHtml(payload)).toEqual({
      kind: 'buttons',
      body: '&lt;b&gt;hi&lt;/b&gt;',
      buttons: [{ id: '1', title: '&lt;img onerror=alert(1)&gt;' }],
    });
  });
});

describe('sanitizeLinkPreviewUrl', () => {
  it('allows http(s) and rejects javascript/data', () => {
    expect(sanitizeLinkPreviewUrl('https://example.com/a')).toBe(
      'https://example.com/a',
    );
    expect(sanitizeLinkPreviewUrl('javascript:alert(1)')).toBeNull();
    expect(sanitizeLinkPreviewUrl('data:text/html,hi')).toBeNull();
    expect(sanitizeLinkPreviewUrl('not a url')).toBeNull();
  });
});

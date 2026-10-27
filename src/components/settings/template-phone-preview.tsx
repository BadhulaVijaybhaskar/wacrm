'use client';

import { ExternalLink, Phone, Reply } from 'lucide-react';

import { cn } from '@/lib/utils';
import { substituteTemplateVariables } from '@/lib/whatsapp/template-preview';
import type { TemplateButton } from '@/types';

export interface TemplatePhonePreviewProps {
  headerFormat: 'none' | 'text' | 'image' | 'video' | 'document';
  headerContent: string;
  headerMediaUrl: string;
  headerSample: string;
  bodyText: string;
  bodySamples: ReadonlyArray<string>;
  footerText: string;
  buttons: ReadonlyArray<TemplateButton>;
  className?: string;
  /** Optional label above the phone chrome. */
  label?: string;
}

function buttonIcon(type: TemplateButton['type']) {
  switch (type) {
    case 'URL':
      return <ExternalLink className="size-3.5 shrink-0" />;
    case 'PHONE_NUMBER':
      return <Phone className="size-3.5 shrink-0" />;
    default:
      return <Reply className="size-3.5 shrink-0" />;
  }
}

/**
 * Live WhatsApp-style phone preview for the template create/edit dialog.
 * Purely presentational — buttons are not interactive.
 */
export function TemplatePhonePreview({
  headerFormat,
  headerContent,
  headerMediaUrl,
  headerSample,
  bodyText,
  bodySamples,
  footerText,
  buttons,
  className,
  label = 'Preview',
}: TemplatePhonePreviewProps) {
  const headerText =
    headerFormat === 'text'
      ? substituteTemplateVariables(
          headerContent,
          headerSample ? [headerSample] : [],
        )
      : '';
  const body = substituteTemplateVariables(bodyText, bodySamples);
  const showMedia =
    (headerFormat === 'image' ||
      headerFormat === 'video' ||
      headerFormat === 'document') &&
    Boolean(headerMediaUrl);

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <p className="text-muted-foreground text-[11px] font-medium uppercase tracking-wide">
        {label}
      </p>
      <div className="mx-auto w-full max-w-[260px] rounded-[1.6rem] border border-border bg-[#0b141a] p-2 shadow-lg">
        <div className="mx-auto mb-2 h-1.5 w-16 rounded-full bg-white/15" />
        <div className="overflow-hidden rounded-2xl bg-[#0b141a]">
          <div className="bg-[#005c4b] px-3 py-2 text-[11px] font-medium text-white">
            Business account
          </div>
          <div className="min-h-[220px] space-y-2 bg-[#0b141a] p-3">
            <div className="ml-auto w-[92%] overflow-hidden rounded-lg rounded-tr-sm bg-[#005c4b] text-white shadow-sm">
              {showMedia ? (
                headerFormat === 'image' ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={headerMediaUrl}
                    alt=""
                    className="aspect-video w-full object-cover"
                  />
                ) : (
                  <div className="bg-black/30 px-3 py-6 text-center text-xs text-white/80">
                    {headerFormat === 'video' ? 'Video header' : 'Document header'}
                  </div>
                )
              ) : null}
              <div className="space-y-1 px-3 py-2">
                {headerText ? (
                  <p className="break-words text-sm font-semibold">{headerText}</p>
                ) : null}
                <p className="whitespace-pre-wrap break-words text-sm">
                  {body || (
                    <span className="text-white/50">Message body…</span>
                  )}
                </p>
                {footerText ? (
                  <p className="break-words text-[11px] text-white/60">
                    {footerText}
                  </p>
                ) : null}
                <p className="text-right text-[10px] text-white/45">12:00</p>
              </div>
              {buttons.length > 0 ? (
                <div className="flex flex-col border-t border-white/10">
                  {buttons.map((btn, i) => (
                    <div
                      key={`${btn.type}-${i}`}
                      className="flex items-center justify-center gap-1.5 border-t border-white/10 px-2 py-2 text-sm font-medium text-[#53bdeb] first:border-t-0"
                    >
                      {buttonIcon(btn.type)}
                      <span className="truncate">
                        {btn.text || `${btn.type} button`}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

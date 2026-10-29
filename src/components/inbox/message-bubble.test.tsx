import { describe, expect, it } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import type { Message } from '@/types'
import { MessageContent } from './message-bubble'

const t = ((key: string) => key) as unknown as Parameters<
  typeof MessageContent
>[0]['t']

function render(message: Partial<Message>, isAgent: boolean): string {
  const full = {
    id: 'm1',
    conversation_id: 'c1',
    content_type: 'interactive',
    content_text: 'Pizza',
    ...message,
  } as unknown as Message
  return renderToStaticMarkup(
    React.createElement(MessageContent, { message: full, t, isAgent }),
  )
}

describe('MessageContent interactive provenance', () => {
  it('renders the button-reply branch for a provenance-only customer payload', () => {
    const html = render(
      {
        sender_type: 'customer',
        interactive_payload: {
          _wacrm_phone_number_id: '999',
        },
      } as unknown as Partial<Message>,
      false,
    )
    expect(html).toContain('buttonReply')
    expect(html).toContain('Pizza')
    expect(html).not.toContain('_wacrm_')
  })

  it('renders the outbound preview without the internal key', () => {
    const html = render(
      {
        sender_type: 'agent',
        content_text: 'Choose',
        interactive_payload: {
          kind: 'buttons',
          body: 'Pick one please',
          buttons: [{ id: 'a', title: 'Alpha' }],
          _wacrm_phone_number_id: '999',
        },
      } as unknown as Partial<Message>,
      true,
    )
    expect(html).toContain('Pick one please')
    expect(html).toContain('Alpha')
    expect(html).not.toContain('_wacrm_')
    expect(html).not.toContain('999')
  })
})

'use client';

import { useState } from 'react';
import { PaymentLinkDialog } from '@/components/inbox/payment-link-dialog';
import { Button } from '@/components/ui/button';

export default function PaymentLinkPreviewPage() {
  const [open, setOpen] = useState(true);
  return (
    <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(ellipse_at_top,_#e8eef7,_#f7f4ef)] p-6">
      <div className="space-y-4 text-center">
        <h1 className="font-serif text-2xl">Payment link composer action</h1>
        <Button type="button" onClick={() => setOpen(true)}>
          Open dialog
        </Button>
      </div>
      <PaymentLinkDialog
        open={open}
        onOpenChange={setOpen}
        conversationId="conv_preview"
        onCreated={() => undefined}
      />
    </main>
  );
}

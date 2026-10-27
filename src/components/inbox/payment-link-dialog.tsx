'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export function PaymentLinkDialog({
  open,
  onOpenChange,
  conversationId,
  contactId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string;
  contactId?: string | null;
  onCreated: (url: string) => void;
}) {
  const [provider, setProvider] = useState<'razorpay' | 'stripe'>('razorpay');
  const [amount, setAmount] = useState('500');
  const [currency, setCurrency] = useState('INR');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  const create = async () => {
    const rupees = Number(amount);
    if (!Number.isFinite(rupees) || rupees <= 0) {
      toast.error('Enter a valid amount');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/account/payments/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          conversation_id: conversationId,
          contact_id: contactId ?? null,
          amount_cents: Math.round(rupees * 100),
          currency,
          description: description.trim() || undefined,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(
          typeof payload.error === 'string'
            ? payload.error
            : 'Could not create payment link',
        );
        return;
      }
      const url = payload.link?.url as string;
      toast.success(
        payload.link?.stub ? 'Stub payment link created' : 'Payment link created',
      );
      onCreated(url);
      onOpenChange(false);
    } catch {
      toast.error('Network error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create payment link</DialogTitle>
          <DialogDescription>
            Creates a Razorpay or Stripe link and sends it in this
            conversation. Connect the provider under Settings → Integrations
            first.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="space-y-1.5">
            <Label>Provider</Label>
            <Select
              value={provider}
              onValueChange={(v) => setProvider(v as 'razorpay' | 'stripe')}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="razorpay">Razorpay</SelectItem>
                <SelectItem value="stripe">Stripe</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="pay-amount">Amount</Label>
              <Input
                id="pay-amount"
                type="number"
                min="1"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pay-currency">Currency</Label>
              <Input
                id="pay-currency"
                value={currency}
                onChange={(e) => setCurrency(e.target.value.toUpperCase())}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pay-desc">Description</Label>
            <Input
              id="pay-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Invoice #1042"
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={busy} onClick={() => void create()}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Create &amp; send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

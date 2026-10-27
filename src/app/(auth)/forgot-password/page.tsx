'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/client';
import { buildPasswordResetRedirectTo } from '@/lib/auth/password-reset';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { CheckCircle, ArrowLeft } from 'lucide-react';

export default function ForgotPasswordPage() {
  const t = useTranslations('ForgotPasswordPage');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const supabase = createClient();

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: buildPasswordResetRedirectTo(window.location.origin),
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    setSuccess(true);
    setLoading(false);
  };

  if (success) {
    return (
      <div className="acl-wrap">
        <Card className="acl-card !block !gap-0 !py-0">
          <CardHeader className="items-center px-0 text-center">
            <div className="bg-primary/10 mb-2 flex h-12 w-12 items-center justify-center rounded-xl">
              <CheckCircle className="text-primary h-6 w-6" />
            </div>
            <CardTitle className="acl-title">{t('checkEmailTitle')}</CardTitle>
            <CardDescription className="acl-sub">
              {t.rich('checkEmailDesc', {
                email,
                strong: (chunks) => (
                  <span className="text-foreground">{chunks}</span>
                ),
              })}
            </CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            <Link href="/login">
              <Button className="acl-btn">{t('backToSignIn')}</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="acl-wrap">
      <Card className="acl-card !block !gap-0 !py-0">
        <CardHeader className="items-center px-0 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/astra-chat-lockup-275.png"
            alt="Astra Chat"
            width={275}
            height={65}
            className="acl-lockup mb-5"
          />
          <CardTitle className="acl-title">{t('title')}</CardTitle>
          <CardDescription className="acl-sub">{t('desc')}</CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          <form onSubmit={handleReset} className="acl-form">
            {error && (
              <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                {error}
              </div>
            )}

            <div className="acl-field">
              <Label htmlFor="email">{t('emailLabel')}</Label>
              <Input
                id="email"
                type="email"
                placeholder={t('emailPlaceholder')}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="acl-input"
              />
            </div>

            <Button type="submit" disabled={loading} className="acl-btn">
              {loading ? t('sending') : t('sendLink')}
            </Button>
          </form>

          <Link
            href="/login"
            className="text-muted-foreground hover:text-foreground mt-6 flex items-center justify-center gap-2 text-sm"
          >
            <ArrowLeft className="h-4 w-4" />
            {t('backToSignIn')}
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}

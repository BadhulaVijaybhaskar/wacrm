'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowLeft, CheckCircle, KeyRound } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import {
  MIN_RESET_PASSWORD_LENGTH,
  validateNewPassword,
} from '@/lib/auth/password-reset';
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

type SessionState = 'loading' | 'ready' | 'missing';

export default function ResetPasswordPage() {
  const t = useTranslations('ResetPasswordPage');
  const router = useRouter();
  const supabase = createClient();

  const [sessionState, setSessionState] = useState<SessionState>('loading');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (cancelled) return;
      if (sessionError || !data.session) {
        setSessionState('missing');
        return;
      }
      setSessionState('ready');
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase.auth]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const check = validateNewPassword(password, confirm);
    if (!check.ok) {
      setError(
        check.reason === 'too_short'
          ? t('passwordTooShort', { min: MIN_RESET_PASSWORD_LENGTH })
          : t('passwordMismatch'),
      );
      return;
    }

    setLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({
      password,
    });
    setLoading(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setSuccess(true);
    window.setTimeout(() => {
      router.replace('/login');
    }, 1500);
  };

  if (sessionState === 'loading') {
    return (
      <div className="acl-wrap">
        <Card className="acl-card !block !gap-0 !py-0">
          <CardHeader className="items-center px-0 text-center">
            <CardTitle className="acl-title">{t('checkingSession')}</CardTitle>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (sessionState === 'missing') {
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
            <CardTitle className="acl-title">{t('linkExpiredTitle')}</CardTitle>
            <CardDescription className="acl-sub">
              {t('linkExpiredDesc')}
            </CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            <Link href="/forgot-password">
              <Button className="acl-btn">{t('requestNewLink')}</Button>
            </Link>
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

  if (success) {
    return (
      <div className="acl-wrap">
        <Card className="acl-card !block !gap-0 !py-0">
          <CardHeader className="items-center px-0 text-center">
            <div className="bg-primary/10 mb-2 flex h-12 w-12 items-center justify-center rounded-xl">
              <CheckCircle className="text-primary h-6 w-6" />
            </div>
            <CardTitle className="acl-title">{t('successTitle')}</CardTitle>
            <CardDescription className="acl-sub">{t('successDesc')}</CardDescription>
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
          <div className="bg-primary/10 mb-2 flex h-12 w-12 items-center justify-center rounded-xl">
            <KeyRound className="text-primary h-6 w-6" />
          </div>
          <CardTitle className="acl-title">{t('title')}</CardTitle>
          <CardDescription className="acl-sub">
            {t('desc', { min: MIN_RESET_PASSWORD_LENGTH })}
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          <form onSubmit={handleSubmit} className="acl-form">
            {error && (
              <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                {error}
              </div>
            )}

            <div className="acl-field">
              <Label htmlFor="new-password">{t('passwordLabel')}</Label>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={MIN_RESET_PASSWORD_LENGTH}
                className="acl-input"
              />
            </div>

            <div className="acl-field">
              <Label htmlFor="confirm-password">{t('confirmLabel')}</Label>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                minLength={MIN_RESET_PASSWORD_LENGTH}
                className="acl-input"
              />
            </div>

            <Button type="submit" disabled={loading} className="acl-btn">
              {loading ? t('saving') : t('submit')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

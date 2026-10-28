'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/client';
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
import { CheckCircle } from 'lucide-react';
import { BrandLockup } from '@/components/brand/brand-lockup';

// `useSearchParams` opts the component out of static prerendering
// unless wrapped in Suspense — same pattern as /login.
export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <SignupPageInner />
    </Suspense>
  );
}

function SignupPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  // When the user lands here from `/join/<token>` we carry the
  // invite token in the query so it survives the signup → email
  // verification → redirect round-trip. `emailRedirectTo` below
  // points back at /join/<token> so the user lands on the redeem
  // step after verifying instead of being dropped on /dashboard.
  const inviteToken = searchParams.get('invite');
  const t = useTranslations('SignupPage');

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const supabase = createClient();

  useEffect(() => {
    let cancelled = false;
    ;(async () => {
      try {
        const qs = new URLSearchParams();
        if (inviteToken) qs.set('invite', inviteToken)
        const res = await fetch(`/api/auth/signup-access?${qs.toString()}`)
        if (!res.ok || cancelled) return
        const body = (await res.json()) as {
          mode?: string
          may_signup?: boolean
        }
        // Invite-only with no token → dedicated page (strangers should
        // not see an open signup form). Allowlisted checks happen on submit.
        if (
          body.mode === 'invite' &&
          !inviteToken &&
          body.may_signup === false
        ) {
          router.replace('/access-by-invitation')
        }
      } catch {
        // leave open UX if the gate endpoint is unreachable
      }
    })()
    return () => {
      cancelled = true
    }
  }, [inviteToken, router])

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError(t('passwordsMismatch'));
      return;
    }

    if (password.length < 6) {
      setError(t('passwordTooShort'));
      return;
    }

    setLoading(true);

    // Re-check gate with the typed email (allowlist) before creating
    // an Auth user — invite mode without token needs allowlist match.
    try {
      const qs = new URLSearchParams({ email });
      if (inviteToken) qs.set('invite', inviteToken);
      const accessRes = await fetch(`/api/auth/signup-access?${qs.toString()}`);
      if (accessRes.ok) {
        const access = (await accessRes.json()) as {
          mode?: string;
          may_signup?: boolean;
        };
        if (access.mode === 'invite' && access.may_signup === false) {
          setLoading(false);
          router.push('/access-by-invitation');
          return;
        }
      }
    } catch {
      // proceed; Auth signup itself is still gated at profile create time
    }

    // If we have an invite token, point Supabase's verification
    // email back at the join page so the user can accept after
    // verifying. Without a token, Supabase uses its default
    // redirect (the app root).
    const emailRedirectTo = inviteToken
      ? `${window.location.origin}/join/${encodeURIComponent(inviteToken)}`
      : undefined;

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
        },
        ...(emailRedirectTo ? { emailRedirectTo } : {}),
      },
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
        <Card className="acl-card !block !gap-0">
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
            <Link
              href={
                inviteToken
                  ? `/login?invite=${encodeURIComponent(inviteToken)}`
                  : '/login'
              }
            >
              <Button className="acl-btn">{t('backToSignIn')}</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="acl-wrap">
      <Card className="acl-card !block !gap-0">
        <CardHeader className="items-center px-0 text-center">
          <BrandLockup
            size={275}
            width={220}
            height={48}
            className="acl-lockup mx-auto"
          />
          <CardTitle className="acl-title">
            {inviteToken ? t('titleJoin') : t('title')}
          </CardTitle>
          <CardDescription className="acl-sub">
            {inviteToken ? t('descJoin') : t('desc')}
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          <form onSubmit={handleSignup} className="acl-form">
            {error && (
              <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                {error}
              </div>
            )}

            <div className="acl-field">
              <Label htmlFor="fullName">{t('fullNameLabel')}</Label>
              <Input
                id="fullName"
                type="text"
                placeholder={t('fullNamePlaceholder')}
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                className="acl-input"
              />
            </div>

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

            <div className="acl-field">
              <Label htmlFor="password">{t('passwordLabel')}</Label>
              <Input
                id="password"
                type="password"
                placeholder={t('passwordPlaceholder')}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="acl-input"
              />
            </div>

            <div className="acl-field">
              <Label htmlFor="confirmPassword">
                {t('confirmPasswordLabel')}
              </Label>
              <Input
                id="confirmPassword"
                type="password"
                placeholder={t('confirmPasswordPlaceholder')}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                className="acl-input"
              />
            </div>

            <Button type="submit" disabled={loading} className="acl-btn">
              {loading ? t('creating') : t('submit')}
            </Button>
          </form>

          <p className="acl-toggle">
            {t('haveAccount')}{' '}
            <Link
              href={
                inviteToken
                  ? `/login?invite=${encodeURIComponent(inviteToken)}`
                  : '/login'
              }
              className="text-primary hover:text-primary/80"
            >
              {t('signIn')}
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

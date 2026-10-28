'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { ShieldAlert } from 'lucide-react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { BrandLockup } from '@/components/brand/brand-lockup'

/**
 * Shown when WACRM_SIGNUP_MODE=invite and the user is not allowlisted
 * and has no invite link. Auth users may still exist (Supabase Auth is
 * open); Chat simply does not create a profile/account for them.
 */
export default function AccessByInvitationPage() {
  const t = useTranslations('AccessByInvitation')

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
          <div className="bg-primary/10 mb-2 flex h-12 w-12 items-center justify-center rounded-xl">
            <ShieldAlert className="text-primary h-6 w-6" />
          </div>
          <CardTitle className="acl-title">{t('title')}</CardTitle>
          <CardDescription className="acl-sub">{t('body')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 px-0">
          <Link href="/login">
            <Button className="acl-btn" variant="outline">
              {t('backToSignIn')}
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  )
}

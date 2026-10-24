'use client';
import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { account, switchBrand, signOut, type Account } from '@/lib/account';
import { send } from '@/lib/api';
import { Button } from '@/components/ui/button';
function Invitation() {
  const params = useSearchParams();
  const token = params.get('token') || '';
  const [me, setMe] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fetch('/api/auth/session', { cache: 'no-store' })
      .then((r) => r.json())
      .then(async (s) => {
        if (s.authenticated) setMe(await account());
      })
      .catch(() => setError('Session service unavailable'))
      .finally(() => setLoading(false));
  }, []);
  async function accept() {
    setError('');
    setBusy(true);
    try {
      const result = await send<{ tenantId: string }>('tenant/invitations/accept', { token });
      await switchBrand(result.tenantId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="account-page narrow">
      <a className="brand" href="/login">
        motor<span>os</span>
      </a>
      <span className="eyebrow">WORKSHOP INVITATION</span>
      <h1>Join your workshop.</h1>
      <p>
        Accept only an invitation you expected. The verified email on your account must match the
        recipient.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <p role="status">Checking your session…</p>
      ) : !token ? (
        <p className="error">This invitation link is incomplete.</p>
      ) : me ? (
        <>
          <p>
            Signed in as <strong>{me.user.email}</strong>.
          </p>
          <div className="chooser-actions">
            <Button onClick={accept} disabled={busy}>
              {busy ? 'Verifying invitation…' : 'Accept invitation'}
            </Button>
            <Button variant="outline" onClick={() => signOut().catch((e) => setError(e.message))}>
              Use another account
            </Button>
          </div>
        </>
      ) : (
        <Button asChild>
          <a
            href={
              '/api/auth/login?returnTo=' + encodeURIComponent('/invitations/accept?token=' + token)
            }
          >
            Sign in to review invitation
          </a>
        </Button>
      )}
    </main>
  );
}
export default function Page() {
  return (
    <Suspense fallback={<p>Loading invitation…</p>}>
      <Invitation />
    </Suspense>
  );
}

'use client';
import { Brand } from '@/components/brand';

import { useEffect, useState } from 'react';
import { account, signOut, type Account } from '@/lib/account';
import { send } from '@/lib/api';
import { Button } from '@/components/ui/button';
export default function Profile() {
  const [me, setMe] = useState<Account | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    account()
      .then(setMe)
      .catch((e) => setError(e.message));
  }, []);
  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    try {
      await send(
        'tenant/auth/profile',
        { displayName: f.get('displayName'), phone: f.get('phone') },
        'PATCH',
      );
      setNotice('Profile updated.');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <main className="account-page narrow">
      <a className="brand" href="/">
        <Brand />
      </a>
      <span className="eyebrow">YOUR ACCOUNT</span>
      <h1>Your profile.</h1>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {me && (
        <>
          <p>{me.user.email} · Verified by your identity provider</p>
          <form onSubmit={submit}>
            <label>
              Display name
              <input
                name="displayName"
                defaultValue={me.user.displayName}
                required
                maxLength={120}
              />
            </label>
            <label>
              Contact number
              <input name="phone" defaultValue={me.user.phone || ''} maxLength={32} />
            </label>
            {notice && (
              <p role="status" className="notice">
                {notice}
              </p>
            )}
            <Button type="submit">Save profile</Button>
          </form>
          {me.user.platformAdmin && <a href="/platform">Platform administration</a>}
          <div className="chooser-actions">
            <Button asChild variant="outline">
              <a href="/">Back to workspace</a>
            </Button>
            <Button variant="ghost" onClick={() => signOut().catch((e) => setError(e.message))}>
              Sign out
            </Button>
          </div>
        </>
      )}
    </main>
  );
}

'use client';
import { Brand } from '@/components/brand';

import { useEffect, useState } from 'react';
import { account, switchBrand, type Account } from '@/lib/account';
import { send } from '@/lib/api';
import { Button } from '@/components/ui/button';
export default function Onboarding() {
  const [me, setMe] = useState<Account | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    account()
      .then(setMe)
      .catch((e) => setError(e.message));
  }, []);
  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const f = new FormData(event.currentTarget);
    try {
      const result = await send<{ tenant: { id: string } }>('tenant/tenants', {
        name: f.get('name'),
        businessEmail: f.get('businessEmail'),
        businessPhone: f.get('businessPhone'),
        businessAddress: f.get('businessAddress'),
        country: f.get('country'),
        timezone: f.get('timezone'),
        currency: f.get('currency'),
        primaryBranch: {
          name: f.get('branchName'),
          branchCode: f.get('branchCode'),
          city: f.get('city'),
          address: f.get('businessAddress'),
          timezone: f.get('timezone'),
        },
      });
      await switchBrand(result.tenant.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="account-page narrow">
      <a className="brand" href="/">
        <Brand />
      </a>
      <span className="eyebrow">WORKSHOP ONBOARDING</span>
      <h1>Your workshop starts here.</h1>
      <p>Create your brand and primary branch together. You become its first Brand Owner.</p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {me ? (
        <form onSubmit={submit}>
          <label>
            Workshop brand
            <input name="name" required maxLength={120} />
          </label>
          <div className="form-grid">
            <label>
              Business email
              <input name="businessEmail" type="email" required defaultValue={me.user.email} />
            </label>
            <label>
              Business phone
              <input name="businessPhone" maxLength={32} />
            </label>
          </div>
          <label>
            Business address
            <textarea name="businessAddress" maxLength={1000} />
          </label>
          <div className="form-grid">
            <label>
              Country
              <input name="country" defaultValue="India" required />
            </label>
            <label>
              Currency
              <input name="currency" defaultValue="INR" required maxLength={3} />
            </label>
          </div>
          <label>
            Time zone
            <input name="timezone" defaultValue="Asia/Kolkata" required />
          </label>
          <div className="form-grid">
            <label>
              First branch name
              <input name="branchName" required maxLength={100} />
            </label>
            <label>
              Branch code
              <input
                name="branchCode"
                required
                pattern="[A-Za-z0-9][A-Za-z0-9_-]{1,19}"
                maxLength={20}
              />
            </label>
          </div>
          <label>
            City
            <input name="city" required maxLength={100} />
          </label>
          <Button type="submit" disabled={busy}>
            {busy ? 'Creating workshop…' : 'Create workshop'}
          </Button>
        </form>
      ) : (
        <p role="status">Loading your verified account…</p>
      )}
    </main>
  );
}

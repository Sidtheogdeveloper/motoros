'use client';
import { useState, useEffect } from 'react';
import { ArrowLeft } from 'lucide-react';
import { account, allowed, switchBrand, type Account } from '@/lib/account';
import { Context, Issue } from './registry/shared';
import { Directory } from './registry/directory';
import { Detail } from './registry/detail';
export function RegistryPage({
  kind,
  id,
  timeline = false,
}: {
  kind: 'customers' | 'vehicles';
  id?: string;
  timeline?: boolean;
}) {
  const [me, setMe] = useState<Account | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    account()
      .then(setMe)
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (!me) return;
    const timer = setInterval(
      () =>
        account()
          .then((next) => {
            if (
              JSON.stringify([me.activeTenant, me.context]) !==
              JSON.stringify([next.activeTenant, next.context])
            )
              window.location.reload();
          })
          .catch(() => {}),
      5000,
    );
    return () => clearInterval(timer);
  }, [me]);
  if (!me)
    return (
      <main className="account-page">
        <Issue error={error} loading={!error} />
      </main>
    );
  if (!me.context)
    return (
      <main className="account-page">
        <h1>Choose a workshop.</h1>
        <a href="/">Return to your workspaces</a>
      </main>
    );
  const can = (p: string) => allowed(me, p);
  if (!can(kind === 'customers' ? 'CUSTOMER_READ' : 'VEHICLE_READ'))
    return (
      <main className="account-page">
        <h1>Access denied.</h1>
        <p>This registry is unavailable for your current role.</p>
        <a href="/">Back to workspace</a>
      </main>
    );
  return (
    <Context.Provider value={me}>
      <main className="management-page registry-page">
        <header className="management-top">
          <a className="brand" href="/">
            motor<span>os</span>
          </a>
          <label className="brand-switch">
            Active brand
            <select
              aria-label="Active brand"
              value={me.activeTenant!}
              onChange={(e) => switchBrand(e.target.value).catch((e) => setError(e.message))}
            >
              {me.memberships
                .filter((m) => m.tenantStatus === 'ACTIVE')
                .map((m) => (
                  <option key={m.tenantId} value={m.tenantId}>
                    {m.name}
                  </option>
                ))}
            </select>
          </label>
        </header>
        <nav className="management-nav">
          <a href="/">
            <ArrowLeft size={14} />
            Workspace
          </a>
          {can('CUSTOMER_READ') && <a href="/customers">Customer directory</a>}
          <a href="/vehicles">Vehicle registry</a>
          <a href="/profile">Your profile</a>
        </nav>
        <Issue error={error} />
        {id ? <Detail kind={kind} id={id} timeline={timeline} /> : <Directory kind={kind} />}
      </main>
    </Context.Provider>
  );
}

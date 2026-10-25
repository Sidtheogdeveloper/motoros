'use client';
import { Brand } from '@/components/brand';

import { useEffect, useState } from 'react';
import type { Account } from '@/lib/account';
import { api } from '@/lib/api';
import { Context, Issue } from '../registry/shared';
import { useCommand } from '../operations/shared';
import { Button } from '../ui/button';
import { EstimateAmounts, type Estimate } from './billing';
type Link = { token: string; tenant: string; estimate: string };
function valid(x: Partial<Link> | null): x is Link {
  return (
    !!x &&
    /^[A-Za-z0-9_-]{43}$/.test(x.token || '') &&
    /^[a-f0-9-]{36}$/i.test(x.tenant || '') &&
    /^[a-f0-9-]{36}$/i.test(x.estimate || '')
  );
}
export function ApprovalPage() {
  const [link, setLink] = useState<Link | null>(null),
    [me, setMe] = useState<Account | null>(null),
    [signedOut, setSignedOut] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    let saved: Partial<Link> | null = {
      token: hash.get('token') || '',
      tenant: hash.get('tenant') || '',
      estimate: hash.get('estimate') || '',
    };
    if (!valid(saved))
      try {
        saved = JSON.parse(sessionStorage.getItem('motoros-approval') || 'null');
      } catch {
        saved = null;
      }
    if (valid(saved)) {
      setLink(saved);
      sessionStorage.setItem('motoros-approval', JSON.stringify(saved));
      window.history.replaceState(null, '', '/approval');
    } else setError('Open the approval link sent to your email.');
    const abort = new AbortController();
    fetch('/api/auth/me', { cache: 'no-store', signal: abort.signal })
      .then(async (r) => {
        if (r.status === 401) {
          setSignedOut(true);
          return;
        }
        if (!r.ok) throw new Error('Unable to verify your account');
        setMe(await r.json());
      })
      .catch((e) => {
        if (e.name !== 'AbortError') setError(e.message);
      });
    return () => abort.abort();
  }, []);
  async function select() {
    if (!link) return;
    setBusy(true);
    try {
      const r = await fetch('/api/context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: link.tenant }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.title || 'Workshop access denied');
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Selection denied');
      setBusy(false);
    }
  }
  return (
    <main className="management-page">
      <a className="brand" href="/">
        <Brand />
      </a>
      <h1>Review your repair estimate</h1>
      <p>
        Approval applies to the exact revision and repair scope below. Sign in using the verified
        customer account for the email that received this link.
      </p>
      <Issue error={error} loading={!error && !me && !signedOut} />
      {signedOut && (
        <a className="button" href="/api/auth/login?returnTo=%2Fapproval">
          Sign in to review
        </a>
      )}
      {link && me && me.activeTenant !== link.tenant && (
        <Button disabled={busy} onClick={select}>
          Select the workshop for this estimate
        </Button>
      )}
      {link && me && me.activeTenant === link.tenant && (
        <Context.Provider value={me}>
          <ApprovalDecision key={link.estimate} link={link} />
        </Context.Provider>
      )}
    </main>
  );
}
function ApprovalDecision({ link }: { link: Link }) {
  const [estimate, setEstimate] = useState<Estimate | null>(null),
    [error, setError] = useState(''),
    [note, setNote] = useState(''),
    [outcome, setOutcome] = useState(''),
    cmd = useCommand();
  useEffect(() => {
    const abort = new AbortController();
    api<Estimate>(`billing/estimates/${link.estimate}/approval-preview`, {
      method: 'POST',
      headers: { 'X-MotorOS-Expected-Tenant': link.tenant },
      body: JSON.stringify({ token: link.token }),
      signal: abort.signal,
    })
      .then(setEstimate)
      .catch((e) => {
        if (e.name !== 'AbortError') setError(e.message);
      });
    return () => abort.abort();
  }, [link]);
  return (
    <>
      <Issue error={error || cmd.error} loading={!estimate && !error} />
      {outcome ? (
        <p role="status">
          Your decision has been recorded: {outcome.toLowerCase()}. The workshop can now review it.
        </p>
      ) : (
        estimate && (
          <section className="panel operation-card">
            <h2>Revision {estimate.revision}</h2>
            <p>{estimate.note}</p>
            <EstimateAmounts estimate={estimate} />
            <h3>Included repair tasks</h3>
            {estimate.workOrderScope?.map((t) => (
              <p key={t.id}>{t.taskDescription}</p>
            ))}
            <label>
              Comments (optional)
              <textarea value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
            </label>
            <div className="button-row">
              {['APPROVED', 'REJECTED'].map((decision) => (
                <Button
                  key={decision}
                  variant={decision === 'APPROVED' ? 'default' : 'outline'}
                  disabled={cmd.busy}
                  onClick={() =>
                    cmd.run<{ status: string }>(
                      `billing/estimates/${link.estimate}/${decision === 'APPROVED' ? 'approve' : 'reject'}`,
                      { token: link.token, decision, note },
                      (r) => {
                        sessionStorage.removeItem('motoros-approval');
                        setOutcome(r.status);
                      },
                    )
                  }
                >
                  {decision === 'APPROVED' ? 'Approve this exact estimate' : 'Reject this estimate'}
                </Button>
              ))}
            </div>
            <p className="muted">
              Approval does not authorize work added to later revisions. You will receive another
              request if the scope changes.
            </p>
          </section>
        )
      )}
    </>
  );
}

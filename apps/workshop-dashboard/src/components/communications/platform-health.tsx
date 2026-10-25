'use client';
import { useEffect, useState } from 'react';
import { account, type Account } from '@/lib/account';
import { api, send } from '@/lib/api';
import { Button } from '../ui/button';
import { Paging } from '../commercial/shared';

type OutboxEvent = {
  eventId: string;
  eventType: string;
  status: string;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  nextAttemptAt: string;
  aggregateId: string;
};
type Failure = {
  id: string;
  eventId: string;
  tenantId: string;
  consumerName: string;
  category: string;
  attemptCount: number;
  status: string;
  createdAt: string;
};
type Health = {
  service: string;
  checkedAt: string;
  outbox: { status: string; count: number; oldest: string }[];
  queues: Record<string, Record<string, string>>;
  worker: { consuming: boolean; activeConsumerLoops: number };
};
export function PlatformHealth() {
  const [me, setMe] = useState<Account | null>(null),
    [service, setService] = useState('notification'),
    [health, setHealth] = useState<Health | null>(null),
    [failures, setFailures] = useState<{ content: Failure[]; totalPages: number } | null>(null),
    [page, setPage] = useState(0),
    [outbox, setOutbox] = useState<{
      content: OutboxEvent[];
      totalElements: number;
      totalPages: number;
    } | null>(null),
    [outboxPage, setOutboxPage] = useState(0),
    [outboxStatus, setOutboxStatus] = useState(''),
    [error, setError] = useState(''),
    [epoch, setEpoch] = useState(0),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    account()
      .then(setMe)
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (!me?.user.platformAdmin) return;
    const c = new AbortController();
    setHealth(null);
    setFailures(null);
    setOutbox(null);
    setError('');
    Promise.all([
      api<Health>(service + '/platform/messaging/health', { signal: c.signal }),
      api<{ content: Failure[]; totalPages: number }>(
        service + '/platform/messaging/failures?page=' + page,
        { signal: c.signal },
      ),
      api<{ content: OutboxEvent[]; totalElements: number; totalPages: number }>(
        `${service}/platform/messaging/outbox?page=${outboxPage}&status=${outboxStatus}`,
        { signal: c.signal },
      ),
    ])
      .then(([h, f, o]) => {
        if (!c.signal.aborted) {
          setHealth(h);
          setFailures(f);
          setOutbox(o);
        }
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, [me, service, page, epoch, outboxPage, outboxStatus]);
  async function act(id: string, action: string, kind = 'failures') {
    const reason = window.prompt('Audit reason (at least 10 characters)');
    if (!reason) return;
    if (reason.trim().length < 10) {
      setError('Record a longer audit reason.');
      return;
    }
    setBusy(true);
    try {
      await send(service + '/platform/messaging/' + kind + '/' + id + '/' + action, { reason });
      setEpoch((e) => e + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action denied');
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="management-page operations-page">
      <a className="brand" href="/">
        motoros
      </a>
      <h1>Event operations</h1>
      {error && <p role="alert">{error}</p>}
      {!me && !error && <p role="status">Checking platform authority…</p>}
      {me && !me.user.platformAdmin && <h2>Access denied</h2>}
      {me?.user.platformAdmin && (
        <>
          <p>
            Platform administrator diagnostics. Replays retain source validation and inbox
            protection.
          </p>
          <label>
            Service
            <select
              aria-label="Service"
              value={service}
              onChange={(e) => {
                setService(e.target.value);
                setPage(0);
                setOutboxPage(0);
              }}
            >
              {[
                'tenant',
                'customer',
                'workorder',
                'booking',
                'inventory',
                'billing',
                'notification',
                'analytics',
              ].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <Button variant="outline" onClick={() => setEpoch((e) => e + 1)}>
            Refresh event health
          </Button>
          {!health && !error && <p role="status">Loading service health…</p>}
          {health && (
            <>
              <section className="operation-card">
                <h2>Outbox</h2>
                <p>Checked {new Date(health.checkedAt).toLocaleString()}</p>
                {health.outbox.map((o) => (
                  <p key={o.status}>
                    {o.status}: {o.count} · oldest {new Date(o.oldest).toLocaleString()}
                  </p>
                ))}
                <p>
                  Consumer {health.worker.consuming ? 'running' : 'paused'} ·{' '}
                  {health.worker.activeConsumerLoops} active loops
                </p>
              </section>
              <section className="operation-card">
                <h2>Subscription queues</h2>
                {Object.entries(health.queues).map(([name, attrs]) => (
                  <p key={name}>
                    {name}:{' '}
                    {Object.entries(attrs)
                      .map(([k, v]) => k + ' ' + v)
                      .join(' · ')}
                  </p>
                ))}
              </section>
            </>
          )}
          <section className="operation-card">
            <h2>Outbox events</h2>
            <label>
              Outbox status
              <select
                aria-label="Outbox status"
                value={outboxStatus}
                onChange={(e) => {
                  setOutboxStatus(e.target.value);
                  setOutboxPage(0);
                }}
              >
                <option value="">All statuses</option>
                {[
                  'PENDING',
                  'CLAIMED',
                  'PUBLISHED',
                  'TERMINAL',
                  'LEGACY_REQUIRES_RECONCILIATION',
                ].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            {outbox?.content.map((e) => (
              <article key={e.eventId}>
                <h3>{e.eventType}</h3>
                <p>
                  {e.status} · {e.attempts} attempts · {e.lastError || 'No recorded error'}
                </p>
                <p>
                  Event {e.eventId} · {new Date(e.createdAt).toLocaleString()}
                </p>
                {e.status === 'TERMINAL' && (
                  <Button disabled={busy} onClick={() => act(e.eventId, 'retry', 'outbox')}>
                    Retry outbox event
                  </Button>
                )}
              </article>
            ))}
            <Paging page={outboxPage} setPage={setOutboxPage} data={outbox} />
          </section>
          <section className="operation-card">
            <h2>Failed events</h2>
            {failures?.content.map((f) => (
              <article key={f.id}>
                <h3>{f.category}</h3>
                <p>
                  {f.consumerName} · {f.attemptCount} attempts · {f.status}
                </p>
                <p>
                  Event {f.eventId || 'invalid contract'} · {new Date(f.createdAt).toLocaleString()}
                </p>
                <Button disabled={busy} onClick={() => act(f.id, 'redrive')}>
                  Redrive event
                </Button>
                <Button variant="outline" disabled={busy} onClick={() => act(f.id, 'resolve')}>
                  Mark resolved
                </Button>
              </article>
            ))}
            {failures?.content.length === 0 && <p>No recorded failures.</p>}
            <Button disabled={!page} variant="outline" onClick={() => setPage(page - 1)}>
              Previous
            </Button>
            <span>Page {page + 1}</span>
            <Button
              disabled={!failures || page + 1 >= failures.totalPages}
              variant="outline"
              onClick={() => setPage(page + 1)}
            >
              Next
            </Button>
          </section>
        </>
      )}
    </main>
  );
}

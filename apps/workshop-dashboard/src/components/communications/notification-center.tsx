'use client';
import { useState } from 'react';
import { useAccount, useData, Issue } from '../registry/shared';
import { allowed } from '@/lib/account';
import { send, statusLabel } from '@/lib/api';
import { Button } from '../ui/button';
import { Paging } from '../commercial/shared';
import type { Page } from '../operations/shared';

type Notice = {
  id: string;
  customerId: string;
  channel: string;
  templateKey: string;
  language: string;
  status: string;
  attemptCount: number;
  providerStatus: string;
  lastError: string;
  createdAt: string;
  sentAt: string;
  version: number;
  relatedResourceId: string;
};
type Schedule = {
  id: string;
  customerId: string;
  templateKey: string;
  dueAt: string;
  status: string;
  version: number;
};
type Template = {
  templateKey: string;
  language: string;
  subject: string;
  body: string;
  optional: boolean;
};
type Preferences = {
  emailEnabled: boolean;
  smsEnabled: boolean;
  whatsappEnabled: boolean;
  operationalEnabled: boolean;
  promotionalEnabled: boolean;
  preferredLanguage: string;
  version: number;
};
export function NotificationCenter({ branch }: { branch: string }) {
  const me = useAccount(),
    [tab, setTab] = useState('history'),
    [status, setStatus] = useState(''),
    [page, setPage] = useState(0),
    [selected, setSelected] = useState<Notice | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const history = useData<Page<Notice>>(
    tab === 'history'
      ? `notification/notifications?branchId=${branch}&status=${status}&page=${page}`
      : null,
  );
  const schedules = useData<Page<Schedule>>(
    tab === 'reminders'
      ? `notification/notifications/schedules?branchId=${branch}&page=${page}`
      : null,
  );
  const templates = useData<Template[]>(
    tab === 'templates' ? 'notification/notifications/templates' : null,
  );
  const attempts = useData<{ attemptNumber: number; category: string; createdAt: string }[]>(
    selected ? `notification/notifications/${selected.id}/attempts` : null,
  );
  async function act(id: string, version: number, action: string, schedule = false) {
    const reason = window.prompt('Record a reason (at least 10 characters)');
    if (!reason) return;
    if (reason.trim().length < 10) {
      setError('A reason of at least 10 characters is required.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await send(
        `notification/notifications/${schedule ? 'schedules/' : ''}${id}/${action}`,
        { version, reason },
        'POST',
        me.activeTenant!,
      );
      history.reload();
      schedules.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <nav className="management-nav" aria-label="Communication views">
        {['history', 'reminders', 'templates', 'preferences'].map((t) => (
          <Button
            key={t}
            variant={tab === t ? 'default' : 'outline'}
            onClick={() => {
              setTab(t);
              setPage(0);
              setSelected(null);
            }}
          >
            {t}
          </Button>
        ))}
      </nav>
      <p>
        Messages show provider acceptance, not proof of delivery or reading. SMS and WhatsApp use
        development captures in local mode.
      </p>
      <Issue
        error={error || history.error || schedules.error || templates.error}
        loading={history.loading || schedules.loading || templates.loading}
      />
      {tab === 'history' && (
        <>
          <label>
            Delivery status
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(0);
              }}
            >
              <option value="">All statuses</option>
              {['PENDING', 'APPROVED', 'QUEUED', 'SENDING', 'SENT', 'FAILED', 'CANCELLED'].map(
                (s) => (
                  <option key={s}>{s}</option>
                ),
              )}
            </select>
          </label>
          <Button variant="outline" onClick={history.reload}>
            Refresh communications
          </Button>
          <div className="operations-list">
            {history.data?.content.map((n) => (
              <article className="operation-card" key={n.id}>
                <h2>{statusLabel(n.templateKey.replaceAll('-', '_'))}</h2>
                <p>
                  {n.channel} · {n.language} · <strong>{statusLabel(n.status)}</strong>
                </p>
                <p>
                  {new Date(n.createdAt).toLocaleString()} · {n.attemptCount} attempts
                </p>
                <p>{n.providerStatus || n.lastError || 'Awaiting processing'}</p>
                <p>Customer reference: {n.customerId}</p>
                <Button variant="outline" onClick={() => setSelected(n)}>
                  Delivery attempts
                </Button>
                {allowed(me, 'NOTIFICATION_MANAGE') && (
                  <>
                    {n.status === 'FAILED' && (
                      <Button disabled={busy} onClick={() => act(n.id, n.version, 'retry')}>
                        Retry notification
                      </Button>
                    )}
                    {['PENDING', 'APPROVED', 'QUEUED', 'FAILED'].includes(n.status) && (
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() => act(n.id, n.version, 'cancel')}
                      >
                        Cancel notification
                      </Button>
                    )}
                  </>
                )}
              </article>
            ))}
          </div>
          {history.data?.content.length === 0 && <p>No matching communications.</p>}
          <Paging page={page} setPage={setPage} data={history.data} />
          {selected && (
            <section className="operation-card">
              <h2>Delivery attempts</h2>
              <Issue error={attempts.error} loading={attempts.loading} />
              {attempts.data?.map((a) => (
                <p key={a.attemptNumber}>
                  Attempt {a.attemptNumber}: {a.category} · {new Date(a.createdAt).toLocaleString()}
                </p>
              ))}
              <Button variant="outline" onClick={() => setSelected(null)}>
                Close attempts
              </Button>
            </section>
          )}
        </>
      )}
      {tab === 'reminders' && (
        <>
          <Button variant="outline" onClick={schedules.reload}>
            Refresh reminders
          </Button>
          {schedules.data?.content.map((s) => (
            <article className="operation-card" key={s.id}>
              <h2>{s.templateKey.replaceAll('-', ' ')}</h2>
              <p>
                {new Date(s.dueAt).toLocaleString()} · {statusLabel(s.status)}
              </p>
              <p>Customer reference: {s.customerId}</p>
              {s.status === 'SCHEDULED' && allowed(me, 'NOTIFICATION_MANAGE') && (
                <Button
                  disabled={busy}
                  variant="outline"
                  onClick={() => act(s.id, s.version, 'cancel', true)}
                >
                  Cancel reminder
                </Button>
              )}
            </article>
          ))}
          <Paging page={page} setPage={setPage} data={schedules.data} />
        </>
      )}
      {tab === 'templates' &&
        templates.data?.map((t) => (
          <article className="operation-card" key={t.templateKey + t.language}>
            <h2>{t.subject}</h2>
            <p>
              {t.language === 'ta' ? 'Tamil' : 'English'} ·{' '}
              {t.optional ? 'Optional, consent required' : 'Operational'}
            </p>
            <p>{t.body}</p>
          </article>
        ))}
      {tab === 'preferences' && <PreferenceEditor />}
    </>
  );
}
function PreferenceEditor() {
  const me = useAccount(),
    [q, setQ] = useState(''),
    [page, setPage] = useState(0),
    [customer, setCustomer] = useState('');
  const customers = useData<Page<{ id: string; name: string }>>(
    `customer/customers?q=${encodeURIComponent(q)}&page=${page}`,
  );
  return (
    <section className="operation-card">
      <h2>Customer communication preferences</h2>
      <label>
        Find customer
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(0);
          }}
        />
      </label>
      <Issue error={customers.error} loading={customers.loading} />
      <label>
        Customer
        <select
          aria-label="Customer"
          value={customer}
          onChange={(e) => setCustomer(e.target.value)}
        >
          <option value="">Select customer</option>
          {customers.data?.content.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <Paging page={page} setPage={setPage} data={customers.data} />
      {customer && (
        <PreferenceForm
          key={customer}
          customer={customer}
          writable={allowed(me, 'COMMUNICATION_PREFERENCES_WRITE')}
        />
      )}
    </section>
  );
}
function PreferenceForm({ customer, writable }: { customer: string; writable: boolean }) {
  const me = useAccount(),
    data = useData<Preferences>('customer/communication-preferences/' + customer),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(false);
  return (
    <>
      <Issue error={error || data.error} loading={data.loading} />
      {data.data && (
        <form
          key={data.data.version}
          className="management-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            setBusy(true);
            setError('');
            setSaved(false);
            try {
              const value = Object.fromEntries(
                [
                  'emailEnabled',
                  'smsEnabled',
                  'whatsappEnabled',
                  'operationalEnabled',
                  'promotionalEnabled',
                ].map((k) => [k, f.get(k) === 'on']),
              );
              await send(
                'customer/communication-preferences/' + customer,
                {
                  ...value,
                  preferredLanguage: f.get('preferredLanguage'),
                  consentNote: f.get('consentNote'),
                  version: data.data!.version,
                },
                'PUT',
                me.activeTenant!,
              );
              setSaved(true);
              data.reload();
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Preferences failed');
            } finally {
              setBusy(false);
            }
          }}
        >
          {(
            [
              'emailEnabled',
              'smsEnabled',
              'whatsappEnabled',
              'operationalEnabled',
              'promotionalEnabled',
            ] as const
          ).map((k) => (
            <label key={k}>
              <input type="checkbox" name={k} defaultChecked={data.data![k]} disabled={!writable} />
              {
                {
                  emailEnabled: 'Email',
                  smsEnabled: 'SMS',
                  whatsappEnabled: 'WhatsApp',
                  operationalEnabled: 'Operational messages',
                  promotionalEnabled: 'Optional follow-ups',
                }[k]
              }
            </label>
          ))}
          <label>
            Preferred language
            <select
              aria-label="Preferred language"
              name="preferredLanguage"
              defaultValue={data.data.preferredLanguage}
              disabled={!writable}
            >
              <option value="en">English</option>
              <option value="ta">Tamil</option>
            </select>
          </label>
          <label>
            Consent record / reason
            <textarea
              name="consentNote"
              required
              minLength={10}
              maxLength={500}
              disabled={!writable}
            />
          </label>
          {writable && (
            <Button disabled={busy} type="submit">
              Save preferences
            </Button>
          )}
        </form>
      )}
      {saved && <p role="status">Communication preferences saved.</p>}
    </>
  );
}

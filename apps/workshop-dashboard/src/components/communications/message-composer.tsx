'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '../ui/button';
import { Issue, useData } from '../registry/shared';
import type { Page } from '../operations/shared';

const purposes = [
  ['APPOINTMENT_CONFIRMATION', 'Appointment confirmation', 'appointment'],
  ['APPOINTMENT_REMINDER', 'Appointment reminder', 'appointment'],
  ['APPOINTMENT_RESCHEDULE', 'Appointment reschedule', 'appointment'],
  ['VEHICLE_CHECKED_IN', 'Vehicle checked in', 'job'],
  ['INSPECTION_COMPLETED', 'Inspection completion', 'job'],
  ['ESTIMATE_APPROVAL', 'Estimate approval request', 'estimate'],
  ['ESTIMATE_EXPLANATION', 'Approved estimate explanation', 'estimate'],
  ['REPAIR_PROGRESS', 'Repair progress update', 'job'],
  ['READY_FOR_COLLECTION', 'Vehicle ready for collection', 'job'],
  ['INVOICE_AVAILABLE', 'Invoice available', 'invoice'],
  ['PAYMENT_CONFIRMATION', 'Payment confirmation', 'payment'],
  ['SERVICE_FOLLOW_UP', 'Service completion follow-up', 'job'],
  ['MAINTENANCE_REMINDER', 'Maintenance reminder', 'job'],
] as const;

const tones = ['PROFESSIONAL', 'FRIENDLY', 'CONCISE'] as const;
const factLabels: Record<string, string> = {
  customerName: 'Customer',
  vehicleRegistration: 'Vehicle registration',
  sourceStatus: 'Source status',
  appointmentTime: 'Appointment time',
  appointmentZone: 'Time zone',
  amount: 'Recorded amount',
  currency: 'Currency',
  invoiceNumber: 'Invoice number',
  estimateRevision: 'Estimate revision',
};

type Tone = (typeof tones)[number];
type Language = 'en' | 'ta';
type Source = {
  id: string;
  customerId?: string;
  vehicleId?: string;
  customerName?: string;
  registration?: string;
  jobCardNumber?: string;
  invoiceNumber?: string;
  status?: string;
  appointmentStatus?: string;
  requestedStartTime?: string;
  revision?: number;
};
type Payment = { id: string; recordType: string; currency: string; amount: string };
type Draft = {
  messageDraftId: string;
  customerReference: string;
  vehicleReference: string;
  purpose: string;
  channel: string;
  language: Language;
  tone: Tone;
  version: number;
  status: 'DRAFT' | 'APPROVED' | 'QUEUED';
  deliveryStatus?: string;
  deliveryError?: string;
  includeDetails: boolean;
  subject: string;
  body: string;
  verifiedFacts: Record<string, string>;
  warnings: string[];
};

function label(row: Source) {
  const title =
    row.jobCardNumber ||
    row.invoiceNumber ||
    row.registration ||
    (row.revision ? 'Estimate revision ' + row.revision : row.id);
  return [
    title,
    row.customerName,
    row.appointmentStatus || row.status,
    row.requestedStartTime ? new Date(row.requestedStartTime).toLocaleString() : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

function LanguageSelect({ value, update }: { value: Language; update: (value: Language) => void }) {
  return (
    <label>
      Language
      <select
        aria-label="Language"
        value={value}
        onChange={(event) => update(event.target.value as Language)}
      >
        <option value="en">English</option>
        <option value="ta">தமிழ் · Tamil</option>
      </select>
    </label>
  );
}

export function MessageComposer({ tenant, branch }: { tenant: string; branch: string }) {
  const [purpose, setPurpose] = useState<string>(purposes[0][0]);
  const [sourceId, setSourceId] = useState('');
  const [paymentId, setPaymentId] = useState('');
  const [recordPage, setRecordPage] = useState(0);
  const [channel, setChannel] = useState('EMAIL');
  const [language, setLanguage] = useState<Language>('en');
  const [tone, setTone] = useState<Tone | 'AUTO'>('AUTO');
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [historyPage, setHistoryPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editLanguage, setEditLanguage] = useState<Language>('en');
  const [editTone, setEditTone] = useState<Tone>('PROFESSIONAL');
  const [includeDetails, setIncludeDetails] = useState(true);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const kind = purposes.find(([id]) => id === purpose)?.[2] ?? 'appointment';
  const endpoint = {
    appointment: 'booking/appointments',
    job: 'workorder/work-orders',
    estimate: 'billing/estimates',
    invoice: 'billing/invoices',
    payment: 'billing/invoices',
  }[kind];
  const records = useData<Page<Source>>(
    endpoint + '?branchId=' + branch + '&size=25&page=' + recordPage,
  );
  const payments = useData<Payment[]>(
    kind === 'payment' && sourceId ? 'billing/invoices/' + sourceId + '/payments' : null,
  );
  const source = records.data?.content.find((row) => row.id === sourceId);
  const resourceId = kind === 'payment' ? paymentId : sourceId;
  const customer = useData<{ name: string }>(
    source?.customerId ? 'customer/customers/' + source.customerId : null,
  );
  const dirty =
    !!draft &&
    (editTone !== draft.tone ||
      editLanguage !== draft.language ||
      includeDetails !== draft.includeDetails);

  async function request<T>(
    path: string,
    method = 'GET',
    body?: object,
    signal?: AbortSignal,
  ): Promise<T> {
    const response = await fetch('/api/ai/communications/' + path, {
      method,
      signal,
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'X-MotorOS-Expected-Tenant': tenant },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json();
    if (response.status === 401) window.location.assign('/session-expired');
    if (!response.ok)
      throw new Error(data.title || 'The communication request could not be completed.');
    return data;
  }

  function selectDraft(value: Draft) {
    setDraft(value);
    setEditLanguage(value.language);
    setEditTone(value.tone);
    setIncludeDetails(value.includeDetails);
    setChecked(false);
  }

  async function refreshHistory(page: number, signal?: AbortSignal) {
    try {
      const data = await request<{ drafts: Draft[]; hasMore: boolean }>(
        'drafts?branchId=' + branch + '&page=' + page,
        'GET',
        undefined,
        signal,
      );
      if (signal?.aborted) return;
      setDrafts(data.drafts);
      setHasMore(data.hasMore);
      setHistoryError('');
      setDraft((current) => {
        const updated = data.drafts.find((row) => row.messageDraftId === current?.messageDraftId);
        return current?.status === 'QUEUED' && updated ? updated : current;
      });
    } catch (error) {
      if (!signal?.aborted)
        setHistoryError(error instanceof Error ? error.message : 'Draft history is unavailable.');
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    void refreshHistory(historyPage, controller.signal);
    return () => controller.abort();
    // Requests are keyed by the active tenant, branch and page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant, branch, historyPage]);

  async function run(action: () => Promise<Draft>) {
    setBusy(true);
    setError('');
    try {
      selectDraft(await action());
      void refreshHistory(historyPage);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'The request failed.');
    } finally {
      setBusy(false);
    }
  }

  function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!source?.customerId || !source.vehicleId || !resourceId) return;
    void run(() =>
      request<Draft>('draft', 'POST', {
        branchId: branch,
        customerId: source.customerId,
        vehicleId: source.vehicleId,
        resourceId,
        purpose,
        channel,
        language,
        tone,
        includeDetails: true,
      }),
    );
  }

  function change(action: 'edit' | 'approve' | 'send') {
    if (!draft) return;
    const path = 'drafts/' + draft.messageDraftId;
    if (action === 'edit') {
      void run(() =>
        request<Draft>(path, 'PATCH', {
          version: draft.version,
          language: editLanguage,
          tone: editTone,
          includeDetails,
        }),
      );
    } else {
      void run(() =>
        request<Draft>(path + '/' + action, 'POST', { version: draft.version, confirmed: checked }),
      );
    }
  }

  return (
    <section className="panel operation-card stack" aria-label="AI message composer">
      <h2>AI message composer</h2>
      <p>
        Choose a workshop record to verify the customer, vehicle and message details before
        approval.
      </p>
      <div className="composer-layout">
        <div className="composer-input">
          <form className="stack" onSubmit={generate}>
            <label>
              Message type
              <select
                value={purpose}
                onChange={(event) => {
                  setPurpose(event.target.value);
                  setSourceId('');
                  setPaymentId('');
                  setRecordPage(0);
                  if (event.target.value === 'ESTIMATE_APPROVAL') setChannel('EMAIL');
                }}
              >
                {purposes.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <Issue
              error={records.error || payments.error}
              loading={records.loading || payments.loading}
            />
            <label>
              Source record
              <select
                value={sourceId}
                required
                onChange={(event) => {
                  setSourceId(event.target.value);
                  setPaymentId('');
                }}
              >
                <option value="">Select a record in this branch</option>
                {records.data?.content.map((row) => (
                  <option key={row.id} value={row.id}>
                    {label(row)}
                  </option>
                ))}
              </select>
            </label>
            {(recordPage > 0 || (records.data?.totalPages ?? 0) > 1) && (
              <div className="button-row">
                <Button
                  type="button"
                  variant="outline"
                  disabled={recordPage === 0}
                  onClick={() => {
                    setRecordPage(recordPage - 1);
                    setSourceId('');
                  }}
                >
                  Previous records
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={recordPage + 1 >= (records.data?.totalPages ?? 0)}
                  onClick={() => {
                    setRecordPage(recordPage + 1);
                    setSourceId('');
                  }}
                >
                  More records
                </Button>
              </div>
            )}
            {kind === 'payment' && sourceId && (
              <label>
                Recorded payment
                <select
                  value={paymentId}
                  required
                  onChange={(event) => setPaymentId(event.target.value)}
                >
                  <option value="">Select a payment</option>
                  {payments.data
                    ?.filter((row) => row.recordType === 'PAYMENT')
                    .map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.currency} {row.amount} · {row.id.slice(0, 8)}
                      </option>
                    ))}
                </select>
              </label>
            )}
            {source && (
              <p>
                Linked customer:{' '}
                {customer.data?.name || source.customerName || 'Verified at generation'}.
              </p>
            )}
            <div className="button-row">
              <label>
                Channel
                <select
                  value={channel}
                  onChange={(event) => setChannel(event.target.value)}
                  disabled={purpose === 'ESTIMATE_APPROVAL'}
                >
                  <option value="EMAIL">Email</option>
                  <option value="SMS">SMS</option>
                  <option value="WHATSAPP">WhatsApp</option>
                </select>
              </label>
              <LanguageSelect value={language} update={setLanguage} />
              <label>
                Tone
                <select
                  value={tone}
                  onChange={(event) => setTone(event.target.value as Tone | 'AUTO')}
                >
                  <option value="AUTO">Suggest tone</option>
                  {tones.map((item) => (
                    <option key={item} value={item}>
                      {item.toLowerCase()}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <Button disabled={busy || !resourceId || !source?.customerId || !source.vehicleId}>
              Generate message draft
            </Button>
          </form>
          {busy && <p role="status">Checking the message and its source…</p>}
          {error && <p role="alert">{error}</p>}
        </div>
        {draft ? (
          <section className="composer-preview stack" aria-label="Message preview">
            <h3>Message preview</h3>
            <p role="status">
              {draft.deliveryStatus || draft.status} · {draft.channel}
            </p>
            {draft.deliveryError && <p role="alert">Delivery issue: {draft.deliveryError}</p>}
            <div className="notice" lang={draft.language}>
              <strong>{draft.subject}</strong>
              <p style={{ whiteSpace: 'pre-wrap' }}>{draft.body}</p>
            </div>
            <details>
              <summary>Verified facts</summary>
              <ul>
                {Object.entries(draft.verifiedFacts).map(([key, value]) => (
                  <li key={key}>
                    {factLabels[key] || key}: {value}
                  </li>
                ))}
              </ul>
            </details>
            {draft.warnings.map((warning) => (
              <p key={warning} className="muted">
                {warning}
              </p>
            ))}
            {draft.status === 'QUEUED' ? (
              <Button variant="outline" onClick={() => void refreshHistory(historyPage)}>
                Refresh delivery status
              </Button>
            ) : (
              <>
                <div className="button-row">
                  <LanguageSelect value={editLanguage} update={setEditLanguage} />
                  <label>
                    Message tone
                    <select
                      value={editTone}
                      onChange={(event) => setEditTone(event.target.value as Tone)}
                    >
                      {tones.map((item) => (
                        <option key={item} value={item}>
                          {item.toLowerCase()}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label>
                  <input
                    type="checkbox"
                    checked={includeDetails}
                    onChange={(event) => setIncludeDetails(event.target.checked)}
                  />{' '}
                  Include verified dates, registration and amounts when available
                </label>
                <Button variant="outline" disabled={busy || !dirty} onClick={() => change('edit')}>
                  Save message edits
                </Button>
                <label>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={dirty || busy}
                    onChange={(event) => setChecked(event.target.checked)}
                  />
                  {draft.status === 'DRAFT'
                    ? 'I reviewed this exact message'
                    : 'Send this approved message to the verified recipient'}
                </label>
                {draft.status === 'DRAFT' ? (
                  <Button disabled={busy || dirty || !checked} onClick={() => change('approve')}>
                    Approve draft
                  </Button>
                ) : (
                  <Button disabled={busy || dirty || !checked} onClick={() => change('send')}>
                    Send approved message
                  </Button>
                )}
              </>
            )}
          </section>
        ) : (
          <section className="composer-preview composer-empty">
            <h3>Message preview</h3>
            <p>
              Select a source record and generate a draft to review the message and verified facts
              here.
            </p>
          </section>
        )}
      </div>
      <details>
        <summary>My recent drafts and delivery status</summary>
        {historyError && <p role="alert">{historyError}</p>}
        {drafts.length === 0 && !historyError && <p>No recent drafts in this branch.</p>}
        {drafts.map((row) => (
          <p key={row.messageDraftId}>
            <Button variant="outline" disabled={busy} onClick={() => selectDraft(row)}>
              {row.subject}
            </Button>{' '}
            {row.channel} · {row.deliveryStatus || row.status}
          </p>
        ))}
        <div className="button-row">
          {historyPage > 0 && (
            <Button variant="outline" onClick={() => setHistoryPage(historyPage - 1)}>
              Previous drafts
            </Button>
          )}
          {hasMore && (
            <Button variant="outline" onClick={() => setHistoryPage(historyPage + 1)}>
              More drafts
            </Button>
          )}
        </div>
      </details>
    </section>
  );
}

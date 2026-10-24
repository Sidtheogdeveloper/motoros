'use client';
import { useState } from 'react';
import { allowed } from '@/lib/account';
import { api, send } from '@/lib/api';
import { useAccount, useData, Issue } from '../registry/shared';
import { ActionForm, Badge, Field, date, useCommand, type Page } from '../operations/shared';
import { Button } from '../ui/button';
import { DecimalField } from './inventory';
import { Amount, JobPicker, Paging, PartPicker } from './shared';
export type EstimateItem = {
  id: string;
  itemType: string;
  partId: string | null;
  description: string;
  quantity: string;
  unitPrice: string;
  discountPercent: string;
  discountAmount: string;
  taxAmount: string;
  total: string;
};
export type Estimate = {
  id: string;
  branchId: string;
  workOrderId: string;
  seriesId: string;
  revision: number;
  status: string;
  currency: string;
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  total: string;
  expiresAt: string;
  note: string;
  version: number;
  items: EstimateItem[];
  versions: { id: string; revision: number; status: string }[];
  workOrderScope: { id: string; taskDescription: string }[];
};
type Settings = {
  branchId: string;
  currency: string;
  laborHourlyRate: string;
  taxRate: string;
  legalName: string;
  address: string;
  taxLabel: string;
  registrationReference: string;
  paymentRequiredBeforeDelivery: boolean;
  version: number;
};
export type Invoice = {
  id: string;
  branchId: string;
  workOrderId: string;
  estimateId: string;
  invoiceNumber: string;
  status: string;
  currency: string;
  total: string;
  outstanding: string;
  paid: string;
  refundDue: string;
  paymentStatus: string;
  version: number;
  snapshot: {
    customer: { name: string };
    vehicle: { registration: string };
    workshop: { legalName: string };
    items: EstimateItem[];
  };
  payments: Payment[];
  adjustments: { id: string; amount: string; reason: string }[];
};
type Payment = {
  id: string;
  amount: string;
  method: string;
  externalReference: string;
  recordType: string;
  reconciliationStatus: string;
  version: number;
  createdAt: string;
  note: string;
};
export function Estimates({ branch }: { branch: string }) {
  const me = useAccount(),
    [page, setPage] = useState(0),
    [status, setStatus] = useState(''),
    [create, setCreate] = useState(false),
    [config, setConfig] = useState(false);
  const data = useData<Page<Estimate>>(
      `billing/estimates?branchId=${branch}&status=${status}&page=${page}`,
    ),
    settings = useData<Settings>(`billing/billing/settings?branchId=${branch}`);
  return (
    <>
      <div className="panel-heading">
        <label>
          Estimate status
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(0);
            }}
          >
            <option value="">All versions</option>
            {[
              'DRAFT',
              'PENDING_CUSTOMER_APPROVAL',
              'APPROVED',
              'REJECTED',
              'SUPERSEDED',
              'CANCELLED',
            ].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <div className="button-row">
          {allowed(me, 'ESTIMATE_CREATE') && (
            <Button onClick={() => setCreate(true)}>New estimate</Button>
          )}
          {allowed(me, 'BRANCH_UPDATE') && allowed(me, 'INVOICE_WRITE') && (
            <Button variant="outline" onClick={() => setConfig(true)}>
              Branch pricing and tax
            </Button>
          )}
        </div>
      </div>
      <Issue error={data.error} loading={data.loading} />
      {settings.error && (
        <p className="notice">Branch pricing must be configured before creating estimates.</p>
      )}
      <div className="commercial-grid">
        {data.data?.content.map((e) => (
          <article className="operation-card" key={e.id}>
            <Badge value={e.status} />
            <h2>Estimate · Revision {e.revision}</h2>
            <p>
              <Amount value={e.total} currency={e.currency} />
            </p>
            <p>{e.note}</p>
            <a href={'/estimates/' + e.id}>Open estimate</a>
          </article>
        ))}
      </div>
      {data.data?.content.length === 0 && <p>No matching estimates.</p>}
      <Paging page={page} setPage={setPage} data={data.data} />
      {create && (
        <EstimateForm
          branch={branch}
          onClose={() => setCreate(false)}
          saved={(e) => window.location.assign('/estimates/' + e.id)}
        />
      )}
      {config && (
        <ActionForm
          title="Branch commercial settings"
          onClose={() => setConfig(false)}
          submit={async (f, key) => {
            await send(
              'billing/billing/settings',
              {
                branchId: branch,
                currency: f.get('currency'),
                laborHourlyRate: f.get('laborHourlyRate'),
                taxRate: f.get('taxRate'),
                legalName: f.get('legalName'),
                address: f.get('address'),
                taxLabel: f.get('taxLabel'),
                registrationReference: f.get('registrationReference'),
                paymentRequiredBeforeDelivery: f.get('paymentRequiredBeforeDelivery') === 'on',
                version: settings.data?.version || 0,
              },
              'PUT',
              me.activeTenant!,
              key,
            );
            setConfig(false);
            settings.reload();
          }}
        >
          <label>
            Currency
            <select name="currency" defaultValue={settings.data?.currency || 'INR'}>
              {['INR', 'USD', 'EUR', 'GBP'].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <DecimalField
            name="laborHourlyRate"
            label="Hourly labor rate"
            value={settings.data?.laborHourlyRate}
          />
          <DecimalField
            name="taxRate"
            label="Configured tax percent"
            value={settings.data?.taxRate}
            step="0.0001"
          />
          <Field
            name="legalName"
            label="Workshop legal name"
            value={settings.data?.legalName}
            max={200}
          />
          <Field
            name="address"
            label="Workshop address"
            value={settings.data?.address}
            max={1000}
          />
          <Field
            name="taxLabel"
            label="Tax label"
            value={settings.data?.taxLabel || 'Configured tax'}
            max={100}
          />
          <Field
            name="registrationReference"
            label="Registration reference, when applicable"
            value={settings.data?.registrationReference}
            max={100}
            required={false}
          />
          <label>
            <input
              name="paymentRequiredBeforeDelivery"
              type="checkbox"
              defaultChecked={settings.data?.paymentRequiredBeforeDelivery ?? true}
            />{' '}
            Require payment before delivery
          </label>
          <p className="notice">
            Workshop configuration requires independent accounting review. MotorOS does not certify
            GST or other tax compliance.
          </p>
        </ActionForm>
      )}
    </>
  );
}
type DraftLine = {
  key: string;
  itemType: string;
  partId: string;
  description: string;
  quantity: string;
  unitPrice: string;
  discountPercent: string;
};
function EstimateForm({
  branch,
  estimate,
  onClose,
  saved,
}: {
  branch: string;
  estimate?: Estimate;
  onClose: () => void;
  saved: (e: Estimate) => void;
}) {
  const me = useAccount();
  const [lines, setLines] = useState<DraftLine[]>(() =>
    estimate
      ? estimate.items.map((i) => ({ ...i, key: crypto.randomUUID(), partId: i.partId || '' }))
      : [
          {
            key: crypto.randomUUID(),
            itemType: 'PART',
            partId: '',
            description: '',
            quantity: '1',
            unitPrice: '0.00',
            discountPercent: '0',
          },
        ],
  );
  function change(key: string, field: keyof DraftLine, value: string) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, [field]: value } : l)));
  }
  return (
    <ActionForm
      title={estimate ? 'Edit estimate draft' : 'Create estimate draft'}
      onClose={onClose}
      submit={async (f, key) => {
        const result = await send<Estimate>(
          `billing/estimates${estimate ? '/' + estimate.id : ''}`,
          {
            branchId: branch,
            workOrderId: estimate?.workOrderId || f.get('workOrderId'),
            expiresAt: new Date(String(f.get('expiresAt'))).toISOString(),
            note: f.get('note'),
            version: estimate?.version,
            items: lines.map(({ key: _, ...l }) => ({
              ...l,
              partId: l.itemType === 'PART' ? l.partId : null,
            })),
          },
          estimate ? 'PATCH' : 'POST',
          me.activeTenant!,
          key,
        );
        saved(result);
      }}
    >
      {!estimate && <JobPicker branch={branch} />}
      <p className="muted">
        Part prices come from the catalog and labor prices from branch settings. All authoritative
        totals are calculated by Billing when saved.
      </p>
      {lines.map((l, i) => (
        <fieldset key={l.key}>
          <legend>Estimate line {i + 1}</legend>
          <label>
            Line type
            <select value={l.itemType} onChange={(e) => change(l.key, 'itemType', e.target.value)}>
              {['PART', 'LABOR', 'INSPECTION', 'SERVICE', 'MISC'].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          {l.itemType === 'PART' && (
            <PartPicker value={l.partId} onChange={(id) => change(l.key, 'partId', id)} />
          )}
          <label>
            Description
            <input
              required
              maxLength={500}
              value={l.description}
              onChange={(e) => change(l.key, 'description', e.target.value)}
            />
          </label>
          <label>
            Quantity {l.itemType === 'LABOR' ? '(hours)' : ''}
            <input
              type="number"
              min="0.001"
              step="0.001"
              required
              value={l.quantity}
              onChange={(e) => change(l.key, 'quantity', e.target.value)}
            />
          </label>
          {!['PART', 'LABOR'].includes(l.itemType) && (
            <label>
              Unit price
              <input
                type="number"
                min="0"
                step="0.01"
                required
                value={l.unitPrice}
                onChange={(e) => change(l.key, 'unitPrice', e.target.value)}
              />
            </label>
          )}
          <label>
            Discount percent
            <input
              type="number"
              min="0"
              max="100"
              step="0.0001"
              value={l.discountPercent}
              onChange={(e) => change(l.key, 'discountPercent', e.target.value)}
              required
            />
          </label>
          {lines.length > 1 && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => setLines(lines.filter((x) => x.key !== l.key))}
            >
              Remove line {i + 1}
            </Button>
          )}
        </fieldset>
      ))}
      <Button
        type="button"
        variant="outline"
        disabled={lines.length >= 20}
        onClick={() =>
          setLines([
            ...lines,
            {
              key: crypto.randomUUID(),
              itemType: 'LABOR',
              partId: '',
              description: '',
              quantity: '1',
              unitPrice: '0.00',
              discountPercent: '0',
            },
          ])
        }
      >
        Add estimate line
      </Button>
      <Field
        name="expiresAt"
        label="Approval expires at (your local time)"
        type="datetime-local"
        value={localDate(estimate?.expiresAt || new Date(Date.now() + 7 * 86400000).toISOString())}
      />
      <Field name="note" label="Scope and revision notes" value={estimate?.note || ''} />
    </ActionForm>
  );
}
function localDate(s: string) {
  const d = new Date(s);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
export function EstimateDetail({ id }: { id: string }) {
  const me = useAccount(),
    data = useData<Estimate>('billing/estimates/' + id),
    [edit, setEdit] = useState(false),
    [action, setAction] = useState(''),
    cmd = useCommand();
  const e = data.data;
  return (
    <>
      <Issue error={data.error || cmd.error} loading={data.loading} />
      {e && (
        <>
          <section className="panel operation-card">
            <Badge value={e.status} />
            <h2>Estimate revision {e.revision}</h2>
            <p>{e.note}</p>
            <p>Approval expires {date(e.expiresAt)}</p>
            <a href={'/jobs/' + e.workOrderId}>Open job card</a>
            <EstimateAmounts estimate={e} />
            {allowed(me, 'ESTIMATE_CREATE') && (
              <div className="button-row">
                {e.status === 'DRAFT' && (
                  <>
                    <Button onClick={() => setEdit(true)}>Edit draft</Button>
                    <Button variant="outline" onClick={() => setAction('submit')}>
                      Send to customer for approval
                    </Button>
                  </>
                )}
                {['APPROVED', 'REJECTED', 'EXPIRED', 'PENDING_CUSTOMER_APPROVAL'].includes(
                  e.status,
                ) && (
                  <Button variant="outline" onClick={() => setAction('revise')}>
                    Create revised estimate
                  </Button>
                )}
                {['DRAFT', 'PENDING_CUSTOMER_APPROVAL'].includes(e.status) && (
                  <Button variant="ghost" onClick={() => setAction('cancel')}>
                    Cancel estimate
                  </Button>
                )}
              </div>
            )}
            <p className="muted">
              Customer decisions apply to this exact version. Customer approval does not come from a
              staff approval button.
            </p>
          </section>
          <section className="panel operation-card">
            <h2>Revision history</h2>
            {e.versions.map((v) => (
              <p key={v.id}>
                <a href={'/estimates/' + v.id}>Revision {v.revision}</a> · {v.status}
              </p>
            ))}
            {e.workOrderScope?.length > 0 && (
              <>
                <h3>Repair tasks in this version</h3>
                {e.workOrderScope.map((t) => (
                  <p key={t.id}>{t.taskDescription}</p>
                ))}
              </>
            )}
          </section>
          {edit && (
            <EstimateForm
              branch={e.branchId}
              estimate={e}
              onClose={() => setEdit(false)}
              saved={() => {
                setEdit(false);
                data.reload();
              }}
            />
          )}
          {action && (
            <ActionForm
              title={
                action === 'submit'
                  ? 'Send exact version to customer'
                  : action === 'revise'
                    ? 'Start a new estimate revision'
                    : 'Cancel estimate'
              }
              onClose={() => setAction('')}
              submit={async (f, key) => {
                const next = await send<Estimate>(
                  `billing/estimates/${id}/${action}`,
                  { version: e.version, note: f.get('note') },
                  'POST',
                  me.activeTenant!,
                  key,
                );
                setAction('');
                if (action === 'revise') window.location.assign('/estimates/' + next.id);
                else data.reload();
              }}
            >
              <Field name="note" label="Reason / scope explanation" max={1000} />
              {action === 'submit' && (
                <p>
                  The approval link will be delivered privately to the customer's recorded email.
                  The recipient must sign in with a verified customer account.
                </p>
              )}
              {action === 'revise' && (
                <p>
                  The previous version becomes superseded. Repair work pauses until the revised
                  scope is approved and verified on the job card.
                </p>
              )}
            </ActionForm>
          )}
        </>
      )}
    </>
  );
}
export function EstimateAmounts({ estimate: e }: { estimate: Estimate }) {
  return (
    <>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Work / part</th>
              <th>Quantity</th>
              <th>Unit price</th>
              <th>Discount</th>
              <th>Tax</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {e.items.map((i) => (
              <tr key={i.id}>
                <td>
                  {i.description}
                  <br />
                  <small>{i.itemType}</small>
                </td>
                <td>{i.quantity}</td>
                <td>{i.unitPrice}</td>
                <td>{i.discountAmount}</td>
                <td>{i.taxAmount}</td>
                <td>{i.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        Subtotal <Amount value={e.subtotal} currency={e.currency} /> · Discount{' '}
        <Amount value={e.discountTotal} currency={e.currency} /> · Tax{' '}
        <Amount value={e.taxTotal} currency={e.currency} />
      </p>
      <h3>
        Total <Amount value={e.total} currency={e.currency} />
      </h3>
    </>
  );
}
export function Invoices({ branch }: { branch: string }) {
  const [page, setPage] = useState(0),
    [status, setStatus] = useState(''),
    [outstandingOnly, setOutstandingOnly] = useState(false);
  const data = useData<Page<Invoice>>(
    `billing/invoices?branchId=${branch}&status=${status}&outstandingOnly=${outstandingOnly}&page=${page}`,
  );
  return (
    <>
      <p>
        Invoices are created from the approved estimate on the job card after repair completion.
      </p>
      <label>
        Invoice status
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(0);
          }}
        >
          <option value="">All invoices</option>
          <option>DRAFT</option>
          <option>ISSUED</option>
        </select>
      </label>
      <Issue error={data.error} loading={data.loading} />
      <div className="commercial-grid">
        {data.data?.content.map((i) => (
          <article className="operation-card" key={i.id}>
            <Badge value={i.status} />
            <h2>{i.invoiceNumber || 'Draft invoice'}</h2>
            <p>
              {i.snapshot.customer.name} · {i.snapshot.vehicle.registration}
            </p>
            <p>
              <Amount value={i.total} currency={i.currency} />
            </p>
            <p>
              Outstanding <Amount value={i.outstanding} currency={i.currency} />
            </p>
            <a href={'/invoices/' + i.id}>Open invoice and payments</a>
          </article>
        ))}
      </div>
      {data.data?.content.length === 0 && <p>No matching invoices.</p>}
      <Paging page={page} setPage={setPage} data={data.data} />
    </>
  );
}
export function InvoiceDetail({ id }: { id: string }) {
  const me = useAccount(),
    data = useData<Invoice>('billing/invoices/' + id),
    [action, setAction] = useState(''),
    [payment, setPayment] = useState<Payment | null>(null),
    [pdfError, setPdfError] = useState(''),
    [pdfBusy, setPdfBusy] = useState(false);
  const inv = data.data;
  async function download() {
    setPdfBusy(true);
    setPdfError('');
    try {
      const pdf = await api<{ url: string }>('billing/invoices/' + id + '/pdf', {
        headers: { 'X-MotorOS-Expected-Tenant': me.activeTenant! },
      });
      window.location.assign(pdf.url);
    } catch (e) {
      setPdfError(e instanceof Error ? e.message : 'PDF unavailable');
    } finally {
      setPdfBusy(false);
    }
  }
  return (
    <>
      <Issue error={data.error || pdfError} loading={data.loading} />
      {inv && (
        <>
          <section className="panel operation-card">
            <Badge value={inv.status} />
            <h2>{inv.invoiceNumber || 'Draft invoice'}</h2>
            <p>{inv.snapshot.workshop.legalName}</p>
            <p>
              {inv.snapshot.customer.name} · {inv.snapshot.vehicle.registration}
            </p>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Quantity</th>
                    <th>Tax</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {inv.snapshot.items.map((i) => (
                    <tr key={i.id}>
                      <td>{i.description}</td>
                      <td>{i.quantity}</td>
                      <td>{i.taxAmount}</td>
                      <td>{i.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <h3>
              Total <Amount value={inv.total} currency={inv.currency} />
            </h3>
            <p>
              Paid <Amount value={inv.paid} currency={inv.currency} /> · Outstanding{' '}
              <Amount value={inv.outstanding} currency={inv.currency} />
            </p>
            <Badge value={inv.paymentStatus} />
            {Number(inv.refundDue) > 0 && (
              <p className="notice">
                Customer refund due: <Amount value={inv.refundDue} currency={inv.currency} />
              </p>
            )}
            <div className="button-row">
              {inv.status === 'DRAFT' && allowed(me, 'INVOICE_WRITE') && (
                <Button onClick={() => setAction('issue')}>Issue immutable invoice</Button>
              )}
              {inv.status === 'ISSUED' && (
                <>
                  <Button variant="outline" onClick={download} disabled={pdfBusy}>
                    {pdfBusy ? 'Preparing PDF…' : 'Download private PDF'}
                  </Button>
                  {allowed(me, 'PAYMENT_RECORD') && Number(inv.outstanding) > 0 && (
                    <Button onClick={() => setAction('payment')}>Record payment</Button>
                  )}
                  {allowed(me, 'PAYMENT_REFUND') && (
                    <Button variant="outline" onClick={() => setAction('credit')}>
                      Record credit adjustment
                    </Button>
                  )}
                </>
              )}
            </div>
            <p className="muted">
              Issued documents retain their original snapshot. Subsequent credits and payments
              remain separate records.
            </p>
            <a href={'/jobs/' + inv.workOrderId}>Open job card</a>
          </section>
          <section className="panel operation-card">
            <h2>Payments and reconciliation</h2>
            <p className="notice">
              UPI, card and bank entries are manually recorded. They are not verified gateway
              transactions. Never enter card numbers or security codes.
            </p>
            {inv.payments.map((p) => (
              <article className="commercial-payment" key={p.id}>
                <Badge value={p.recordType} />
                <Badge value={p.reconciliationStatus} />
                <p>
                  <Amount value={p.amount} currency={inv.currency} /> · {p.method} ·{' '}
                  {date(p.createdAt)}
                </p>
                <p>Reference: {p.externalReference}</p>
                <p>{p.note}</p>
                <div className="button-row">
                  {p.reconciliationStatus === 'UNRECONCILED' &&
                    allowed(me, 'PAYMENT_RECONCILE') && (
                      <Button
                        variant="outline"
                        onClick={() => {
                          setPayment(p);
                          setAction('reconcile');
                        }}
                      >
                        Reconcile with separate reviewer
                      </Button>
                    )}
                  {p.recordType === 'PAYMENT' && allowed(me, 'PAYMENT_REFUND') && (
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setPayment(p);
                        setAction('refund');
                      }}
                    >
                      Record refund
                    </Button>
                  )}
                </div>
              </article>
            ))}
            {inv.payments.length === 0 && <p>No payments recorded.</p>}
            <h3>Credits</h3>
            {inv.adjustments.map((c) => (
              <p key={c.id}>
                <Amount value={c.amount} currency={inv.currency} /> · {c.reason}
              </p>
            ))}
          </section>
          {action && (
            <ActionForm
              title={
                {
                  issue: 'Issue invoice',
                  payment: 'Record manual payment',
                  reconcile: 'Reconcile payment',
                  refund: 'Record refund',
                  credit: 'Credit adjustment',
                }[action] || action
              }
              onClose={() => setAction('')}
              submit={async (f, key) => {
                let path = '',
                  body: unknown;
                if (action === 'issue') {
                  path = `billing/invoices/${id}/issue`;
                  body = { version: inv.version, note: f.get('note') };
                } else if (action === 'payment') {
                  path = 'billing/payments';
                  body = {
                    invoiceId: id,
                    amount: f.get('amount'),
                    method: f.get('method'),
                    externalReference: f.get('externalReference'),
                    note: f.get('note'),
                  };
                } else if (action === 'reconcile') {
                  path = `billing/payments/${payment!.id}/reconcile`;
                  body = { version: payment!.version, note: f.get('note') };
                } else if (action === 'refund') {
                  path = 'billing/payments/refunds';
                  body = {
                    paymentId: payment!.id,
                    amount: f.get('amount'),
                    externalReference: f.get('externalReference'),
                    reason: f.get('note'),
                  };
                } else {
                  path = `billing/invoices/${id}/adjustments`;
                  body = { amount: f.get('amount'), reason: f.get('note') };
                }
                await send(path, body, 'POST', me.activeTenant!, key);
                setAction('');
                data.reload();
              }}
            >
              {['payment', 'refund', 'credit'].includes(action) && (
                <DecimalField name="amount" label={'Amount (' + inv.currency + ')'} />
              )}{' '}
              {action === 'payment' && (
                <label>
                  Payment method
                  <select name="method">
                    {['CASH', 'UPI', 'CARD', 'BANK', 'OTHER'].map((m) => (
                      <option key={m}>{m}</option>
                    ))}
                  </select>
                </label>
              )}
              {['payment', 'refund'].includes(action) && (
                <Field
                  name="externalReference"
                  label="Unique receipt / transaction reference (8–100 letters, digits or hyphens)"
                  max={100}
                />
              )}
              <Field name="note" label="Reason / reconciliation evidence" max={1000} />
              {action === 'issue' && (
                <p>Issuing assigns a permanent branch invoice number and freezes this document.</p>
              )}
            </ActionForm>
          )}
        </>
      )}
    </>
  );
}

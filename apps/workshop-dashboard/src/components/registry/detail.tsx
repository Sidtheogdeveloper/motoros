'use client';
import { useState, type FormEvent } from 'react';
import { allowed } from '@/lib/account';
import { send } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  useAccount,
  useData,
  Issue,
  Pager,
  FormDialog,
  BranchSelect,
  type Row,
  type Page,
  type Branch,
} from './shared';
import { RecordEditor } from './directory';
import { Timeline } from './timeline';
import { DocumentPanel } from './documents';
export function Detail({
  kind,
  id,
  timeline,
}: {
  kind: 'customers' | 'vehicles';
  id: string;
  timeline: boolean;
}) {
  const me = useAccount(),
    customer = kind === 'customers',
    can = (p: string) => allowed(me, p);
  const record = useData<Row>(`customer/${kind}/${id}`),
    branches = useData<Branch[]>('tenant/branches?size=100');
  const [tab, setTab] = useState(timeline ? 'Service timeline' : 'Overview'),
    [editing, setEditing] = useState(false);
  const row = record.data;
  const tabs = customer
    ? ['Overview', ...(can('DOCUMENT_READ') ? ['Documents'] : [])]
    : [
        'Overview',
        ...(can('VEHICLE_OWNERSHIP_READ') ? ['Ownership'] : []),
        'Odometer',
        ...(can('DOCUMENT_READ') ? ['Documents'] : []),
        ...(can('VEHICLE_HISTORY_READ') ? ['Service timeline'] : []),
      ];
  return (
    <>
      <section className="management-heading">
        <div>
          <span className="eyebrow">{customer ? 'CUSTOMER PROFILE' : 'VEHICLE DETAIL'}</span>
          <h1>{row ? (customer ? row.name : row.registration) : 'Registry profile.'}</h1>
          <p>
            {customer
              ? [row?.city, row?.country].filter(Boolean).join(' · ')
              : [row?.make, row?.model, row?.year].filter(Boolean).join(' · ')}
          </p>
        </div>
        {row && can(customer ? 'CUSTOMER_WRITE' : 'VEHICLE_WRITE') && (
          <Button variant="outline" onClick={() => setEditing(true)}>
            Edit {customer ? 'customer' : 'vehicle'}
          </Button>
        )}
      </section>
      <Issue error={record.error || branches.error} loading={record.loading} />
      {row && (
        <>
          <nav className="registry-tabs" aria-label="Profile sections">
            {tabs.map((t) => (
              <Button key={t} variant={tab === t ? 'default' : 'ghost'} onClick={() => setTab(t)}>
                {t}
              </Button>
            ))}
          </nav>
          {tab === 'Overview' && (
            <>
              {customer ? (
                <CustomerOverview row={row} />
              ) : (
                <section className="panel registry-summary">
                  <h2>Vehicle identity</h2>
                  <dl>
                    <dt>Registration</dt>
                    <dd>{row.registration}</dd>
                    <dt>VIN</dt>
                    <dd>{row.vin || 'Not recorded'}</dd>
                    <dt>Fuel / color</dt>
                    <dd>
                      {[row.fuelType, row.color].filter(Boolean).join(' · ') || 'Not recorded'}
                    </dd>
                    <dt>Status</dt>
                    <dd>{row.status}</dd>
                    {row.customerId && can('CUSTOMER_READ') && (
                      <>
                        <dt>Current owner</dt>
                        <dd>
                          <a href={'/customers/' + row.customerId}>Open customer profile</a>
                        </dd>
                      </>
                    )}
                  </dl>
                  {row.identifierConflict && (
                    <p role="alert" className="error">
                      A pre-existing identifier collision needs operator review. No records have
                      been merged.
                    </p>
                  )}
                  <a href={'/vehicles/' + id + '/timeline'}>Open cross-branch service timeline →</a>
                </section>
              )}
            </>
          )}
          {tab === 'Ownership' && (
            <Ownership row={row} branches={branches.data || []} onSaved={record.reload} />
          )}{' '}
          {tab === 'Odometer' && <Readings id={id} branches={branches.data || []} />}{' '}
          {tab === 'Documents' && (
            <DocumentPanel kind={kind} id={id} branches={branches.data || []} />
          )}{' '}
          {tab === 'Service timeline' && <Timeline id={id} branches={branches.data || []} />}
        </>
      )}
      {editing && row && (
        <FormDialog
          title={'Edit ' + (customer ? 'customer' : 'vehicle')}
          onClose={() => setEditing(false)}
        >
          <RecordEditor
            kind={kind}
            row={row}
            onSaved={() => {
              setEditing(false);
              record.reload();
            }}
          />
        </FormDialog>
      )}
    </>
  );
}
function CustomerOverview({ row }: { row: Row }) {
  const me = useAccount(),
    contacts = useData<Row[]>('customer/customers/' + row.id + '/contacts');
  const [page, setPage] = useState(0),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const vehicles = useData<Page>(`customer/vehicles?customerId=${row.id}&page=${page}&size=20`);
  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await send(
        'customer/customers/' + row.id + '/contacts',
        Object.fromEntries(new FormData(e.currentTarget)),
        'POST',
        me.activeTenant!,
      );
      contacts.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(c: Row) {
    if (!window.confirm('Deactivate this contact? Its history is retained.')) return;
    try {
      await send(
        `customer/customers/${row.id}/contacts/${c.id}/deactivate`,
        { version: c.version },
        'POST',
        me.activeTenant!,
      );
      contacts.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <>
      <section className="panel registry-summary">
        <h2>Contact & profile</h2>
        <dl>
          <dt>Email</dt>
          <dd>{row.email || 'Not recorded'}</dd>
          <dt>Phone</dt>
          <dd>{row.phone || 'Not recorded'}</dd>
          <dt>Address</dt>
          <dd>{row.address || 'Not recorded'}</dd>
          <dt>Status</dt>
          <dd>{row.status}</dd>
        </dl>
        <Issue error={contacts.error || error} loading={contacts.loading} />
        {contacts.data?.map((c) => (
          <div className="registry-line" key={c.id}>
            <span>
              {c.label} · {c.value}
            </span>
            {allowed(me, 'CUSTOMER_WRITE') && (
              <Button variant="ghost" onClick={() => remove(c)}>
                Deactivate contact
              </Button>
            )}
          </div>
        ))}
        {allowed(me, 'CUSTOMER_WRITE') && (
          <form onSubmit={add} className="registry-inline-form">
            <h3>Add contact</h3>
            <div className="form-grid">
              <label>
                Contact type
                <select name="kind">
                  <option>EMAIL</option>
                  <option>PHONE</option>
                </select>
              </label>
              <label>
                Contact label
                <input name="label" required maxLength={60} />
              </label>
            </div>
            <label>
              Contact value
              <input name="value" required maxLength={254} />
            </label>
            <label>
              Shared contact review reason
              <input name="duplicateReason" maxLength={500} />
            </label>
            <Button disabled={busy}>Add contact</Button>
          </form>
        )}
      </section>
      <section className="panel registry-summary">
        <h2>Currently owned vehicles</h2>
        <Issue error={vehicles.error} loading={vehicles.loading} />
        {vehicles.data?.content.map((v) => (
          <div className="registry-line" key={v.id}>
            <a href={'/vehicles/' + v.id}>{v.registration}</a>
            <span>
              {v.make} {v.model}
            </span>
          </div>
        ))}
        {vehicles.data && !vehicles.data.content.length && <p>No current vehicles registered.</p>}
        <Pager page={page} setPage={setPage} result={vehicles.data} />
      </section>
    </>
  );
}
function Ownership({
  row,
  branches,
  onSaved,
}: {
  row: Row;
  branches: Branch[];
  onSaved: () => void;
}) {
  const me = useAccount(),
    [page, setPage] = useState(0),
    [search, setSearch] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const history = useData<Page>(`customer/vehicles/${row.id}/ownership?page=${page}&size=20`),
    owners = useData<Page>(
      allowed(me, 'VEHICLE_OWNERSHIP_WRITE')
        ? `customer/customers?q=${encodeURIComponent(search)}&size=20`
        : null,
    );
  async function transfer(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (
      !window.confirm(
        'Transfer ownership? The previous relationship and service history will be retained.',
      )
    )
      return;
    const f = Object.fromEntries(new FormData(e.currentTarget));
    setBusy(true);
    setError('');
    try {
      await send(
        `customer/vehicles/${row.id}/ownership`,
        { ...f, version: row.version },
        'POST',
        me.activeTenant!,
      );
      history.reload();
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel registry-summary">
      <h2>Ownership history</h2>
      <p>Transfers retain previous owners. Service records stay attached to the vehicle.</p>
      <Issue error={history.error || owners.error || error} loading={history.loading} />
      {history.data?.content.map((h) => (
        <div className="registry-line" key={h.id}>
          <div>
            <strong>{h.customerName}</strong>
            <p>
              {new Date(h.startedAt!).toLocaleDateString()} →{' '}
              {h.endedAt ? new Date(h.endedAt).toLocaleDateString() : 'Current owner'}
            </p>
            <small>{h.reason}</small>
          </div>
          <a href={'/customers/' + h.customerId}>Customer profile</a>
        </div>
      ))}
      <Pager page={page} setPage={setPage} result={history.data} />
      {allowed(me, 'VEHICLE_OWNERSHIP_WRITE') && (
        <form onSubmit={transfer} className="registry-inline-form">
          <h3>Transfer ownership</h3>
          <label>
            Find next owner
            <input value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          <label>
            Next owner
            <select aria-label="Next owner" name="customerId" required>
              <option value="">Select next owner</option>
              {owners.data?.content
                .filter((c) => c.id !== row.customerId)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </label>
          <BranchSelect branches={branches} />
          <label>
            Transfer reason
            <textarea name="reason" required minLength={10} maxLength={500} />
          </label>
          <Button disabled={busy}>Transfer ownership</Button>
        </form>
      )}
    </section>
  );
}
function Readings({ id, branches }: { id: string; branches: Branch[] }) {
  const me = useAccount(),
    [page, setPage] = useState(0),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const data = useData<Page>(`customer/vehicles/${id}/odometer?page=${page}&size=20`);
  async function record(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget));
    setBusy(true);
    try {
      await send(
        `customer/vehicles/${id}/odometer`,
        { ...f, kilometers: Number(f.kilometers) },
        'POST',
        me.activeTenant!,
      );
      setError('');
      data.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel registry-summary">
      <h2>Odometer log</h2>
      <Issue error={data.error || error} loading={data.loading} />
      {data.data?.content.map((v) => (
        <div className="registry-line" key={v.id}>
          <strong>{v.kilometers?.toLocaleString()} km</strong>
          <span>{new Date(v.recordedAt!).toLocaleString()}</span>
        </div>
      ))}
      {data.data && !data.data.content.length && <p>No readings yet.</p>}
      <Pager page={page} setPage={setPage} result={data.data} />
      {allowed(me, 'VEHICLE_ODOMETER_WRITE') && (
        <form onSubmit={record} className="registry-inline-form">
          <label>
            Odometer kilometers
            <input name="kilometers" type="number" min={0} max={9999999} required />
          </label>
          <BranchSelect branches={branches} />
          <label>
            Reading note
            <input name="note" maxLength={500} />
          </label>
          <Button disabled={busy}>Record odometer</Button>
        </form>
      )}
    </section>
  );
}

'use client';
import { useState, type FormEvent } from 'react';
import { Plus, Search, Car, Users, RefreshCw } from 'lucide-react';
import { allowed } from '@/lib/account';
import { api, send } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  useAccount,
  useData,
  Issue,
  Pager,
  FormDialog,
  type Row,
  type Page,
  type Branch,
} from './shared';
export function Directory({ kind }: { kind: 'customers' | 'vehicles' }) {
  const me = useAccount(),
    customer = kind === 'customers',
    canWrite = allowed(me, customer ? 'CUSTOMER_WRITE' : 'VEHICLE_WRITE');
  const [q, setQ] = useState(''),
    [status, setStatus] = useState(''),
    [page, setPage] = useState(0),
    [creating, setCreating] = useState(false);
  const result = useData<Page>(
    `customer/${kind}?page=${page}&size=20&q=${encodeURIComponent(q)}&status=${status}`,
  );
  return (
    <>
      <section className="management-heading">
        <div>
          <span className="eyebrow">UNIFIED BRAND REGISTRY</span>
          <h1>{customer ? 'Customer directory.' : 'Vehicle registry.'}</h1>
          <p>
            {customer
              ? 'People, contacts and the vehicles they own.'
              : 'One vehicle record. Service context across your brand.'}
          </p>
        </div>
        {canWrite && (
          <Button onClick={() => setCreating(true)}>
            <Plus size={16} />
            {customer ? 'New customer' : 'Register vehicle'}
          </Button>
        )}
      </section>
      <section className="panel">
        <div className="panel-heading registry-filters">
          <label className="search-field">
            <Search size={16} />
            <input
              aria-label={customer ? 'Search customers' : 'Search vehicles'}
              placeholder={customer ? 'Name, email or phone' : 'Registration, VIN, make or model'}
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(0);
              }}
            />
          </label>
          <label>
            Status
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(0);
              }}
            >
              <option value="">All statuses</option>
              <option>ACTIVE</option>
              <option>INACTIVE</option>
            </select>
          </label>
          <Button variant="ghost" onClick={result.reload}>
            <RefreshCw size={15} />
            Refresh
          </Button>
        </div>
        <Issue error={result.error} loading={result.loading} />
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{customer ? 'Customer' : 'Vehicle'}</th>
                <th>{customer ? 'Contact' : 'Make / model'}</th>
                <th>{customer ? 'Location' : 'VIN'}</th>
                <th>Status</th>
                <th>Profile</th>
              </tr>
            </thead>
            <tbody>
              {result.data?.content.map((row) => (
                <tr key={row.id}>
                  <td>
                    <strong>{customer ? row.name : row.registration}</strong>
                    {row.identifierConflict && (
                      <small className="error">Legacy identifier conflict — review required</small>
                    )}
                  </td>
                  <td>
                    {customer ? (
                      <>
                        {row.email || 'No email'}
                        <small className="cell-subline">{row.phone || 'No phone'}</small>
                      </>
                    ) : (
                      row.make + ' ' + row.model
                    )}
                  </td>
                  <td>
                    {customer
                      ? [row.city, row.country].filter(Boolean).join(', ')
                      : row.vin || 'Not recorded'}
                  </td>
                  <td>
                    <span className="tag">{row.status}</span>
                  </td>
                  <td>
                    <a href={`/${kind}/${row.id}`}>Open profile →</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {result.data && !result.data.content.length && (
          <div className="empty-state">
            {customer ? <Users /> : <Car />}
            <h3>No matching {kind}</h3>
            <p>Adjust filters or add a record to this brand.</p>
          </div>
        )}
        <Pager page={page} setPage={setPage} result={result.data} />
      </section>
      {creating && (
        <FormDialog
          title={customer ? 'New customer' : 'Register vehicle'}
          onClose={() => setCreating(false)}
        >
          <RecordEditor
            kind={kind}
            onSaved={(row) => window.location.assign(`/${kind}/${row.id}`)}
          />
        </FormDialog>
      )}
    </>
  );
}
export function RecordEditor({
  kind,
  row,
  onSaved,
}: {
  kind: 'customers' | 'vehicles';
  row?: Row;
  onSaved: (row: Row) => void;
}) {
  const me = useAccount(),
    customer = kind === 'customers';
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [matches, setMatches] = useState<Row[]>([]),
    [ownerSearch, setOwnerSearch] = useState('');
  const owners = useData<Page>(
    !customer ? `customer/customers?q=${encodeURIComponent(ownerSearch)}&size=20` : null,
  );
  const branches = useData<Branch[]>(!customer ? 'tenant/branches?size=100' : null);
  async function duplicates(form: HTMLFormElement) {
    const f = new FormData(form);
    setMatches(
      await api<Row[]>(
        `customer/customers/duplicates?email=${encodeURIComponent(String(f.get('email') || ''))}&phone=${encodeURIComponent(String(f.get('phone') || ''))}&country=${encodeURIComponent(String(f.get('country') || 'India'))}`,
        { headers: { 'X-MotorOS-Expected-Tenant': me.activeTenant! } },
      ),
    );
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget));
    if (
      row &&
      row.status !== 'INACTIVE' &&
      f.status === 'INACTIVE' &&
      !window.confirm(
        'Deactivate this record? History remains available; new vehicle intake is restricted.',
      )
    )
      return;
    setBusy(true);
    setError('');
    try {
      const body = customer
        ? { ...f, version: row?.version }
        : {
            ...f,
            customerId: row?.customerId || f.customerId,
            year: f.year ? Number(f.year) : null,
            version: row?.version,
          };
      const result = await send<Row>(
        `customer/${kind}${row ? '/' + row.id : ''}`,
        body,
        row ? 'PATCH' : 'POST',
        me.activeTenant!,
      );
      onSaved(result);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit}>
      <Issue error={error || owners.error || branches.error} />
      {customer ? (
        <>
          <label>
            Customer name
            <input name="name" required maxLength={120} defaultValue={row?.name} />
          </label>
          <div className="form-grid">
            <label>
              Email
              <input name="email" type="email" maxLength={254} defaultValue={row?.email || ''} />
            </label>
            <label>
              Phone
              <input name="phone" maxLength={32} defaultValue={row?.phone || ''} />
            </label>
          </div>
          <label>
            Address
            <textarea name="address" maxLength={1000} defaultValue={row?.address || ''} />
          </label>
          <div className="form-grid">
            <label>
              City
              <input name="city" maxLength={100} defaultValue={row?.city || ''} />
            </label>
            <label>
              Country
              <input
                name="country"
                required
                maxLength={80}
                defaultValue={row?.country || 'India'}
              />
            </label>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={(e) => duplicates(e.currentTarget.form!).catch((e) => setError(e.message))}
          >
            Check duplicate contacts
          </Button>
          {matches.length > 0 && (
            <div className="notice" role="status">
              <strong>Possible matches — review before creating a separate person</strong>
              {matches.map((m) => (
                <p key={m.id}>
                  <a href={'/customers/' + m.id}>{m.name}</a> · {m.email || m.phone}
                </p>
              ))}
            </div>
          )}
          <label>
            Separate-record review reason (only when contacts are shared)
            <textarea
              name="duplicateReason"
              maxLength={500}
              placeholder="Explain why this is a separate person; no automatic merge"
            />
          </label>
        </>
      ) : (
        <>
          {!row && (
            <>
              <label>
                Find current owner
                <input
                  value={ownerSearch}
                  onChange={(e) => setOwnerSearch(e.target.value)}
                  placeholder="Search name, phone or email"
                />
              </label>
              <label>
                Current owner
                <select aria-label="Current owner" name="customerId" required>
                  <option value="">Select a customer</option>
                  {owners.data?.content.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} · {c.email || c.phone || 'No contact'}
                    </option>
                  ))}
                </select>
              </label>
              <p>
                <a href="/customers">Create the customer first if no match is found.</a>
              </p>
            </>
          )}
          <div className="form-grid">
            <label>
              Registration
              <input name="registration" required maxLength={32} defaultValue={row?.registration} />
            </label>
            <label>
              VIN
              <input
                name="vin"
                pattern="[A-HJ-NPR-Za-hj-npr-z0-9]{17}"
                maxLength={17}
                defaultValue={row?.vin || ''}
              />
            </label>
            <label>
              Make
              <input name="make" required maxLength={80} defaultValue={row?.make} />
            </label>
            <label>
              Model
              <input name="model" required maxLength={80} defaultValue={row?.model} />
            </label>
            <label>
              Model year
              <input
                name="year"
                type="number"
                min={1900}
                max={new Date().getFullYear() + 1}
                defaultValue={row?.year || ''}
              />
            </label>
            <label>
              Fuel type
              <select name="fuelType" defaultValue={row?.fuelType || ''}>
                <option value="">Not recorded</option>
                {['PETROL', 'DIESEL', 'ELECTRIC', 'HYBRID', 'CNG', 'OTHER'].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            <label>
              Color
              <input name="color" maxLength={60} defaultValue={row?.color || ''} />
            </label>
            <label>
              Registration branch
              <select
                name="branchId"
                required
                defaultValue={branches.data?.find((b) => b.status === 'ACTIVE')?.id}
              >
                {branches.data
                  ?.filter((b) => b.status === 'ACTIVE')
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
              </select>
            </label>
          </div>
        </>
      )}
      <label>
        Status
        <select name="status" defaultValue={row?.status || 'ACTIVE'}>
          <option>ACTIVE</option>
          <option>INACTIVE</option>
        </select>
      </label>
      <Button type="submit" disabled={busy}>
        {busy ? 'Saving…' : customer ? 'Save customer' : 'Save vehicle'}
      </Button>
    </form>
  );
}

'use client';
import { useDeferredValue, useState } from 'react';
import { allowed } from '@/lib/account';
import { send } from '@/lib/api';
import { useAccount, useData, Issue } from '../registry/shared';
import { ActionForm, Field, type Page } from '../operations/shared';
import { Button } from '../ui/button';
import { Paging } from './shared';
type Supplier = { id: string; name: string; contact: string; active: boolean };
export function Suppliers() {
  const me = useAccount(),
    [q, setQ] = useState(''),
    [page, setPage] = useState(0),
    [create, setCreate] = useState(false),
    search = useDeferredValue(q),
    data = useData<Page<Supplier>>(
      `inventory/suppliers?q=${encodeURIComponent(search)}&page=${page}`,
    );
  return (
    <section>
      <div className="panel-heading">
        <h2>Suppliers</h2>
        {allowed(me, 'INVENTORY_WRITE') && (
          <Button onClick={() => setCreate(true)}>New supplier</Button>
        )}
      </div>
      <label>
        Search suppliers
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(0);
          }}
        />
      </label>
      <Issue error={data.error} loading={data.loading} />
      <div className="commercial-grid">
        {data.data?.content.map((s) => (
          <article className="operation-card" key={s.id}>
            <h3>{s.name}</h3>
            <p>{s.contact || 'Contact not recorded'}</p>
          </article>
        ))}
      </div>
      <Paging page={page} setPage={setPage} data={data.data} />
      {create && (
        <ActionForm
          title="Create supplier"
          onClose={() => setCreate(false)}
          submit={async (f, key) => {
            await send(
              'inventory/suppliers',
              { name: f.get('name'), contact: f.get('contact') },
              'POST',
              me.activeTenant!,
              key,
            );
            setCreate(false);
            data.reload();
          }}
        >
          <Field name="name" label="Supplier name" max={200} />
          <Field name="contact" label="Supplier contact details" max={300} required={false} />
        </ActionForm>
      )}
    </section>
  );
}
export function SupplierPicker({ value }: { value?: string }) {
  const [q, setQ] = useState(''),
    [page, setPage] = useState(0),
    search = useDeferredValue(q),
    data = useData<Page<Supplier>>(
      `inventory/suppliers?q=${encodeURIComponent(search)}&page=${page}`,
    );
  return (
    <fieldset>
      <legend>Supplier (optional)</legend>
      <label>
        Find supplier
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(0);
          }}
        />
      </label>
      <Issue error={data.error} loading={data.loading} />
      <label>
        Supplier
        <select name="supplierId" defaultValue={value || ''}>
          <option value="">No supplier reference</option>
          {value && !data.data?.content.some((s) => s.id === value) && (
            <option value={value}>Current supplier ({value})</option>
          )}
          {data.data?.content.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <Paging page={page} setPage={setPage} data={data.data} />
    </fieldset>
  );
}

'use client';
import { useDeferredValue, useState } from 'react';
import { allowed } from '@/lib/account';
import { send } from '@/lib/api';
import { useAccount, useData, Issue } from '../registry/shared';
import { ActionForm, Badge, Field, date, useCommand, type Page } from '../operations/shared';
import { Button } from '../ui/button';
import { PartPicker, JobPicker, Paging, Amount, type Part } from './shared';
import { Suppliers, SupplierPicker } from './suppliers';
type Stock = {
  partId: string;
  sku: string;
  name: string;
  onHand: string;
  reserved: string;
  available: string;
  reorderLevel: string;
  version: number;
};
type Movement = {
  id: string;
  partId: string;
  movementType: string;
  onHandDelta: string;
  reservedDelta: string;
  reason: string;
  createdAt: string;
  referenceId: string;
};
type Reservation = {
  id: string;
  partId: string;
  workOrderId: string;
  quantity: string;
  status: string;
  version: number;
};
export function Inventory({ branch }: { branch: string }) {
  const me = useAccount(),
    [tab, setTab] = useState('catalog'),
    [q, setQ] = useState(''),
    [page, setPage] = useState(0),
    [form, setForm] = useState(''),
    [edit, setEdit] = useState<Part | null>(null),
    [threshold, setThreshold] = useState<Stock | null>(null);
  const search = useDeferredValue(q);
  const url =
    tab === 'catalog'
      ? `inventory/parts?q=${encodeURIComponent(search)}&includeArchived=true&page=${page}`
      : tab === 'stock' || tab === 'low'
        ? `inventory/inventory/stock?branchId=${branch}&lowStock=${tab === 'low'}&q=${encodeURIComponent(search)}&page=${page}`
        : `inventory/inventory/${tab}?branchId=${branch}&page=${page}`;
  const parts = useData<Page<Part>>(tab === 'catalog' ? url : null),
    stock = useData<Page<Stock>>(tab === 'stock' || tab === 'low' ? url : null),
    movements = useData<Page<Movement>>(tab === 'movements' ? url : null),
    reservations = useData<Page<Reservation>>(tab === 'reservations' ? url : null),
    cmd = useCommand();
  function refresh() {
    parts.reload();
    stock.reload();
    movements.reload();
    reservations.reload();
  }
  const data = parts.data || stock.data || movements.data || reservations.data;
  return (
    <>
      <nav className="management-nav" aria-label="Inventory views">
        {[
          ...(allowed(me, 'INVENTORY_COST_READ') ? [['suppliers', 'Suppliers']] : []),
          ['catalog', 'Parts catalog'],
          ['stock', 'Branch stock'],
          ['low', 'Low stock'],
          ['movements', 'Stock ledger'],
          ['reservations', 'Job reservations'],
        ].map(([v, label]) => (
          <Button
            variant={v === tab ? 'default' : 'ghost'}
            key={v}
            onClick={() => {
              setTab(v);
              setPage(0);
              setQ('');
            }}
          >
            {label}
          </Button>
        ))}
      </nav>
      {tab === 'suppliers' && <Suppliers />}
      <div className="panel-heading">
        <label>
          Search catalog or stock
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(0);
            }}
          />
        </label>
        <div className="button-row">
          {allowed(me, 'INVENTORY_WRITE') && allowed(me, 'INVENTORY_COST_READ') && (
            <Button
              onClick={() => {
                setEdit(null);
                setForm('part');
              }}
            >
              New part
            </Button>
          )}
          {allowed(me, 'INVENTORY_WRITE') && (
            <Button variant="outline" onClick={() => setForm('receipts')}>
              Receive stock
            </Button>
          )}
          {allowed(me, 'INVENTORY_ADJUST') && (
            <Button variant="outline" onClick={() => setForm('adjustments')}>
              Record adjustment
            </Button>
          )}
          {allowed(me, 'INVENTORY_RESERVE') && (
            <Button variant="outline" onClick={() => setForm('reservation')}>
              Reserve for job
            </Button>
          )}
        </div>
      </div>
      <Issue
        error={parts.error || stock.error || movements.error || reservations.error || cmd.error}
        loading={parts.loading || stock.loading || movements.loading || reservations.loading}
      />
      {parts.data && (
        <div className="commercial-grid">
          {parts.data.content.map((p) => (
            <article className="operation-card" key={p.id}>
              <span className="eyebrow">
                {p.sku} · {p.category}
              </span>
              <h2>{p.name}</h2>
              <p>
                {p.manufacturer} {p.oemNumber}
              </p>
              <p>{p.description}</p>
              <p>
                <Amount value={p.sellingPrice} currency={p.currency} />
                {p.purchasePrice !== undefined && (
                  <>
                    {' '}
                    · Purchase <Amount value={p.purchasePrice} currency={p.currency} />
                  </>
                )}
              </p>
              <p className="muted">
                {p.active ? 'Active' : 'Archived'} ·{' '}
                {p.compatibilityVerified
                  ? 'Compatibility reviewed by staff'
                  : 'Compatibility not verified'}
              </p>
              {p.compatibilityNotes && <p>{p.compatibilityNotes}</p>}
              {allowed(me, 'INVENTORY_WRITE') && allowed(me, 'INVENTORY_COST_READ') && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setEdit(p);
                    setForm('part');
                  }}
                >
                  Edit catalog entry
                </Button>
              )}
            </article>
          ))}
        </div>
      )}
      {stock.data && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Part</th>
                <th>On hand</th>
                <th>Reserved</th>
                <th>Available</th>
                <th>Reorder at</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {stock.data.content.map((s) => (
                <tr key={s.partId}>
                  <td>
                    {s.sku}
                    <br />
                    {s.name}
                  </td>
                  <td>{s.onHand}</td>
                  <td>{s.reserved}</td>
                  <td>{s.available}</td>
                  <td>{s.reorderLevel}</td>
                  <td>
                    {allowed(me, 'INVENTORY_WRITE') && (
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setThreshold(s);
                          setForm('threshold');
                        }}
                      >
                        Set threshold
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {movements.data && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Action / part</th>
                <th>On hand Δ</th>
                <th>Reserved Δ</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {movements.data.content.map((m) => (
                <tr key={m.id}>
                  <td>{date(m.createdAt)}</td>
                  <td>
                    {m.movementType}
                    <br />
                    <small>{m.partId}</small>
                  </td>
                  <td>{m.onHandDelta}</td>
                  <td>{m.reservedDelta}</td>
                  <td>
                    {m.reason}
                    <br />
                    <small>Reference {m.referenceId}</small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {reservations.data && (
        <div className="commercial-grid">
          {reservations.data.content.map((r) => (
            <article className="operation-card" key={r.id}>
              <Badge value={r.status} />
              <p>
                Part {r.partId} · Quantity {r.quantity}
              </p>
              <a href={'/jobs/' + r.workOrderId}>Open job card</a>
              {r.status === 'RESERVED' && allowed(me, 'INVENTORY_RESERVE') && (
                <div className="button-row">
                  {['release', 'consume'].map((action) => (
                    <Button
                      key={action}
                      variant="outline"
                      disabled={cmd.busy}
                      onClick={() =>
                        cmd.run(
                          `inventory/inventory/reservations/${r.id}/${action}`,
                          {
                            version: r.version,
                            note:
                              action === 'consume'
                                ? 'Installed within approved repair scope'
                                : 'Reservation released by authorized stock employee',
                          },
                          refresh,
                        )
                      }
                    >
                      {action === 'consume' ? 'Record installation' : 'Release reservation'}
                    </Button>
                  ))}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
      {data?.content.length === 0 && <p>No matching records in this view.</p>}
      <Paging page={page} setPage={setPage} data={data} />
      {form && (
        <ActionForm
          title={
            form === 'part'
              ? edit
                ? 'Edit part'
                : 'Create part'
              : form === 'reservation'
                ? 'Reserve stock for a job'
                : form === 'threshold'
                  ? 'Reorder threshold'
                  : form === 'receipts'
                    ? 'Receive supplier stock'
                    : 'Stock adjustment'
          }
          onClose={() => setForm('')}
          submit={async (f, key) => {
            if (form === 'part') {
              await send(
                `inventory/parts${edit ? '/' + edit.id : ''}`,
                {
                  sku: f.get('sku'),
                  name: f.get('name'),
                  category: f.get('category'),
                  oemNumber: f.get('oemNumber'),
                  manufacturer: f.get('manufacturer'),
                  description: f.get('description'),
                  compatibilityNotes: f.get('compatibilityNotes'),
                  compatibilityVerified: f.get('compatibilityVerified') === 'on',
                  currency: f.get('currency'),
                  purchasePrice: f.get('purchasePrice'),
                  sellingPrice: f.get('sellingPrice'),
                  active: f.get('active') === 'on',
                  version: edit?.version,
                  supplierId: f.get('supplierId') || null,
                },
                edit ? 'PATCH' : 'POST',
                me.activeTenant!,
                key,
              );
            } else if (form === 'threshold') {
              await send(
                'inventory/inventory/stock',
                {
                  branchId: branch,
                  partId: threshold!.partId,
                  reorderLevel: f.get('reorderLevel'),
                  version: threshold!.version,
                },
                'PATCH',
                me.activeTenant!,
                key,
              );
            } else if (form === 'reservation') {
              await send(
                'inventory/inventory/reservations',
                {
                  branchId: branch,
                  partId: f.get('partId'),
                  workOrderId: f.get('workOrderId'),
                  quantity: f.get('quantity'),
                },
                'POST',
                me.activeTenant!,
                key,
              );
            } else {
              await send(
                'inventory/inventory/' + form,
                {
                  branchId: branch,
                  partId: f.get('partId'),
                  quantity: f.get('quantity'),
                  reason: f.get('reason'),
                  adjustmentType: f.get('adjustmentType') || undefined,
                },
                'POST',
                me.activeTenant!,
                key,
              );
            }
            setForm('');
            refresh();
          }}
        >
          {form === 'part' ? (
            <>
              <SupplierPicker value={edit?.supplierId} />
              <Field name="sku" label="SKU" value={edit?.sku} max={80} />
              <Field name="name" label="Part name" value={edit?.name} max={200} />
              <Field name="category" label="Category" value={edit?.category} max={100} />
              <Field
                name="oemNumber"
                label="OEM reference"
                value={edit?.oemNumber}
                required={false}
                max={100}
              />
              <Field
                name="manufacturer"
                label="Manufacturer"
                value={edit?.manufacturer}
                required={false}
                max={160}
              />
              <Field
                name="description"
                label="Description"
                value={edit?.description}
                required={false}
              />
              <Field
                name="compatibilityNotes"
                label="Compatibility notes"
                value={edit?.compatibilityNotes}
                required={false}
              />
              <label>
                <input
                  name="compatibilityVerified"
                  type="checkbox"
                  defaultChecked={edit?.compatibilityVerified}
                />{' '}
                Compatibility has been reviewed by staff
              </label>
              <label>
                Currency
                <select name="currency" defaultValue={edit?.currency || 'INR'}>
                  {['INR', 'USD', 'EUR', 'GBP'].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
              <DecimalField
                name="purchasePrice"
                label="Purchase price"
                value={edit?.purchasePrice || '0.00'}
              />
              <DecimalField
                name="sellingPrice"
                label="Selling price"
                value={edit?.sellingPrice || '0.00'}
              />
              <label>
                <input name="active" type="checkbox" defaultChecked={edit?.active ?? true} /> Active
                catalog entry
              </label>
            </>
          ) : form === 'threshold' ? (
            <DecimalField
              name="reorderLevel"
              label="Reorder when available stock reaches"
              value={threshold?.reorderLevel}
            />
          ) : (
            <>
              <PartPicker />
              {form === 'reservation' && <JobPicker branch={branch} />}
              <DecimalField
                name="quantity"
                label={
                  form === 'adjustments'
                    ? 'Quantity change (negative removes available stock)'
                    : 'Quantity'
                }
                step="0.001"
                allowNegative={form === 'adjustments'}
              />
              {form === 'adjustments' && (
                <label>
                  Adjustment type
                  <select name="adjustmentType">
                    {['CORRECTION', 'DAMAGE', 'LOSS', 'SUPPLIER_RETURN', 'CUSTOMER_RETURN'].map(
                      (t) => (
                        <option key={t}>{t}</option>
                      ),
                    )}
                  </select>
                </label>
              )}
              {form !== 'reservation' && (
                <Field name="reason" label="Reason / supplier delivery reference" max={1000} />
              )}
              <p className="muted">
                Reservations hold stock without consuming it. Installation requires an in-progress
                job and customer-approved part quantities.
              </p>
            </>
          )}
        </ActionForm>
      )}
    </>
  );
}
export function DecimalField({
  name,
  label,
  value,
  step = '0.01',
  allowNegative = false,
}: {
  name: string;
  label: string;
  value?: string;
  step?: string;
  allowNegative?: boolean;
}) {
  return (
    <label>
      {label}
      <input
        name={name}
        type="number"
        inputMode="decimal"
        step={step}
        min={allowNegative ? undefined : '0'}
        defaultValue={value}
        required
      />
    </label>
  );
}

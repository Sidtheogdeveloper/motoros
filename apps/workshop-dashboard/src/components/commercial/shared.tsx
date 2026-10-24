'use client';
import { useDeferredValue, useState } from 'react';
import { useData, Issue } from '../registry/shared';
import { Button } from '../ui/button';
import { formatDecimal } from '@/lib/decimal';
import type { Page, Job } from '../operations/shared';
export type Part = {
  id: string;
  sku: string;
  name: string;
  oemNumber: string;
  manufacturer: string;
  category: string;
  description: string;
  compatibilityNotes: string;
  compatibilityVerified: boolean;
  supplierId: string;
  currency: string;
  purchasePrice?: string;
  sellingPrice: string;
  active: boolean;
  version: number;
};
export function Paging({
  page,
  setPage,
  data,
}: {
  page: number;
  setPage: (n: number) => void;
  data: { totalElements: number; totalPages: number } | null;
}) {
  return (
    <div className="pager">
      <Button type="button" variant="outline" disabled={!page} onClick={() => setPage(page - 1)}>
        Previous
      </Button>
      <span>
        Page {page + 1} · {data?.totalElements ?? 0} records
      </span>
      <Button
        type="button"
        variant="outline"
        disabled={!data || page + 1 >= data.totalPages}
        onClick={() => setPage(page + 1)}
      >
        Next
      </Button>
    </div>
  );
}
export function PartPicker({
  name = 'partId',
  value,
  onChange,
}: {
  name?: string;
  value?: string;
  onChange?: (id: string) => void;
}) {
  const [q, setQ] = useState(''),
    [page, setPage] = useState(0);
  const search = useDeferredValue(q);
  const parts = useData<Page<Part>>(`inventory/parts?q=${encodeURIComponent(search)}&page=${page}`);
  return (
    <fieldset>
      <legend>Part lookup</legend>
      <label>
        Find by name, SKU or OEM number
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(0);
          }}
        />
      </label>
      <Issue error={parts.error} loading={parts.loading} />
      <label>
        Part
        <select name={name} value={value} onChange={(e) => onChange?.(e.target.value)} required>
          <option value="">Choose a part</option>
          {value && !parts.data?.content.some((p) => p.id === value) && (
            <option value={value}>Current selected part ({value})</option>
          )}
          {parts.data?.content.map((p) => (
            <option key={p.id} value={p.id}>
              {p.sku} · {p.name} · {p.currency} {p.sellingPrice}
            </option>
          ))}
        </select>
      </label>
      <Paging page={page} setPage={setPage} data={parts.data} />
    </fieldset>
  );
}
export function JobPicker({ branch, name = 'workOrderId' }: { branch: string; name?: string }) {
  const [q, setQ] = useState(''),
    [page, setPage] = useState(0),
    search = useDeferredValue(q);
  const jobs = useData<Page<Job>>(
    `workorder/work-orders?branchId=${branch}&q=${encodeURIComponent(search)}&page=${page}`,
  );
  return (
    <fieldset>
      <legend>Job lookup</legend>
      <label>
        Find job or vehicle
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(0);
          }}
        />
      </label>
      <Issue error={jobs.error} loading={jobs.loading} />
      <label>
        Job card
        <select name={name} required>
          <option value="">Choose a job</option>
          {jobs.data?.content.map((j) => (
            <option key={j.id} value={j.id}>
              {j.jobCardNumber} · {j.registration} · {j.status}
            </option>
          ))}
        </select>
      </label>
      <Paging page={page} setPage={setPage} data={jobs.data} />
    </fieldset>
  );
}
export function Amount({ value, currency }: { value: string | number; currency: string }) {
  return (
    <span>
      {currency} {formatDecimal(value)}
    </span>
  );
}

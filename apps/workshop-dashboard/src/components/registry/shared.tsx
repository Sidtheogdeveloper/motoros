'use client';
import { useState, useEffect, useContext, createContext, type ReactNode } from 'react';
import { type Account } from '@/lib/account';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
type Row = {
  id: string;
  name?: string;
  registration?: string;
  make?: string;
  model?: string;
  customerId?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  country?: string;
  status?: string;
  version: number;
  vin?: string;
  year?: number;
  fuelType?: string;
  color?: string;
  fileName?: string;
  byteSize?: number;
  visibility?: string;
  kilometers?: number;
  recordedAt?: string;
  startedAt?: string;
  endedAt?: string;
  customerName?: string;
  reason?: string;
  createdAt?: string;
  branchId?: string;
  summary?: string;
  completedRepairs?: {taskDescription:string;completedAt:string}[];
  technicianNotes?: {kind:string;note:string}[];
  parts?: {description:string;quantity:number;status:string}[];
  odometer?: {odometerKilometers:number;checkInAt:string}[];
  recommendations?: {category:string;technicianNotes:string;severity:string}[];
  source?: {
    service: string;
    resourceId: string;
    path: string;
  };
  label?: string;
  value?: string;
  kind?: string;
  identifierConflict?: boolean;
};
type Page = {
  content: Row[];
  totalElements: number;
  totalPages: number;
};
type Branch = {
  id: string;
  name: string;
  status: string;
};
const Context = createContext<Account | null>(null);
function useAccount() {
  return useContext(Context)!;
}
function useData<T>(url: string | null) {
  const me = useAccount();
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false),
    [epoch, setEpoch] = useState(0);
  useEffect(() => {
    setData(null);
    setError('');
    if (!url) return;
    const controller = new AbortController();
    setLoading(true);
    api<T>(url, {
      signal: controller.signal,
      headers: { 'X-MotorOS-Expected-Tenant': me.activeTenant! },
    })
      .then((result) => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [url, me.activeTenant, epoch]);
  return { data, error, loading, reload: () => setEpoch((n) => n + 1) };
}
function Issue({ error, loading }: { error: string; loading?: boolean }) {
  return (
    <>
      {loading && <p role="status">Loading authorized records…</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
function Pager({
  page,
  setPage,
  result,
}: {
  page: number;
  setPage: (n: number) => void;
  result: Page | null;
}) {
  return (
    <div className="pager">
      <Button variant="outline" disabled={!page} onClick={() => setPage(page - 1)}>
        Previous
      </Button>
      <span>
        Page {page + 1} · {result?.totalElements ?? 0} records
      </span>
      <Button
        variant="outline"
        disabled={!result || page + 1 >= result.totalPages}
        onClick={() => setPage(page + 1)}
      >
        Next
      </Button>
    </div>
  );
}
function FormDialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Modal className="registry-modal" titleId="registry-form" onClose={onClose}>
      <div className="record-form">
        <div className="panel-heading">
          <h2 id="registry-form">{title}</h2>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
        {children}
      </div>
    </Modal>
  );
}
function BranchSelect({ branches }: { branches: Branch[] }) {
  return (
    <label>
      Acting branch
      <select name="branchId" required>
        {branches
          .filter((b) => b.status === 'ACTIVE')
          .map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
      </select>
    </label>
  );
}
export { Context, useAccount, useData, Issue, Pager, FormDialog, BranchSelect };
export type { Row, Page, Branch };

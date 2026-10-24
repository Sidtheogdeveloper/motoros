'use client';
import { useId, useRef, useState, type ReactNode, type SubmitEvent } from 'react';
import { send, statusLabel } from '@/lib/api';
import { allowed } from '@/lib/account';
import { useAccount, Issue, FormDialog, useData } from '../registry/shared';
import { Button } from '../ui/button';
export type Branch = { id: string; name: string; status: string; timezone: string };
export type Staff = {
  userId: string;
  membershipId: string;
  displayName: string;
  role: string;
  technician: boolean;
  available: boolean;
  qualityReview: boolean;
  safetyReview: boolean;
  capabilityVersion: number;
  activeJobs: number;
  estimatedRemainingMinutes: number;
  tasks: Task[];
  taskStatusCounts: { status: string; count: number }[];
};
export type Task = {
  id: string;
  version: number;
  taskDescription: string;
  taskCategory: string;
  priority: string;
  status: string;
  assignedTechnicianId: string;
  estimatedDurationMinutes: number;
  actualDurationMinutes: number;
};
export type Photo = { id: string; label: string; fileName: string; status: string };
export type Finding = {
  id: string;
  itemId: string;
  category: string;
  inspectionItem: string;
  condition: string;
  technicianNotes: string;
  severity: string;
  safetyRelated: boolean;
  photoReferences: string[];
};
export type Inspection = {
  id: string;
  version: number;
  status: string;
  inspectedBy: string;
  findings: Finding[];
};
export type Quality = {
  id: string;
  version: number;
  status: string;
  reviewerId: string;
  reviewerNotes: string;
  reviewedAt: string;
};
export type Job = {
  id: string;
  branchId: string;
  customerId: string;
  vehicleId: string;
  version: number;
  jobCardNumber: string;
  registration: string;
  vehicleModel: string;
  complaint: string;
  priority: string;
  status: string;
  assignedTechnicianId: string;
  checkInAt: string;
  createdAt: string;
  estimatedCompletionAt: string;
  developmentApprovalAvailable: boolean;
  developmentApprovalId: string;
  commercialEstimateId?: string;
  commercialRevision?: number;
  qualityPassedAt?: string;
  tasks: Task[];
  photos: Photo[];
  qualityChecks: Quality[];
  notes: { id: string; kind: string; note: string }[];
  parts: {
    id: string;
    description: string;
    quantity: number;
    version: number;
    status: string;
    inventoryReservationId?: string;
  }[];
  statusHistory: {
    id: string;
    fromStatus: string;
    toStatus: string;
    note: string;
    createdAt: string;
  }[];
};
export type Appointment = {
  id: string;
  branchId: string;
  customerId: string;
  vehicleId: string;
  serviceCategoryId: string;
  customerComplaint: string;
  registration: string;
  vehicleModel: string;
  customerName: string;
  branchTimezone: string;
  requestedStartTime: string;
  expectedEndTime: string;
  estimatedDurationMinutes: number;
  appointmentStatus: string;
  assignedTechnicianId?: string;
  bookingSource: string;
  version: number;
  checkInState: string;
  workOrderId: string;
  checkInId: string;
  history: { id: string; toStatus: string; note: string; createdAt: string }[];
};
export type Page<T> = { content: T[]; totalElements: number; totalPages: number };
export function date(value: string, zone?: string) {
  return value
    ? new Date(value).toLocaleString('en-IN', {
        timeZone: zone || 'Asia/Kolkata',
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : '—';
}
export function Badge({ value }: { value: string }) {
  return <span className={'tag status-' + value.toLowerCase()}>{statusLabel(value)}</span>;
}
export function useCommand() {
  const me = useAccount();
  const operationKeys = useRef(new Map<string, string>());
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function run<T>(
    path: string,
    body: unknown,
    done: (value: T) => void,
    method = 'POST',
    key?: string,
  ) {
    setBusy(true);
    setError('');
    try {
      const identity = path + ':' + method + ':' + JSON.stringify(body);
      const retained = key || operationKeys.current.get(identity) || crypto.randomUUID();
      operationKeys.current.set(identity, retained);
      const result = await send<T>(path, body, method, me.activeTenant!, retained);
      operationKeys.current.delete(identity);
      done(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Operation failed');
    } finally {
      setBusy(false);
    }
  }
  return { run, busy, error };
}
export function ActionForm({
  title,
  children,
  submit,
  onClose,
}: {
  title: string;
  children: ReactNode;
  submit: (f: FormData, key: string) => Promise<void>;
  onClose: () => void;
}) {
  const [key] = useState(() => crypto.randomUUID()),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function save(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await submit(new FormData(e.currentTarget), key);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Operation failed');
    } finally {
      setBusy(false);
    }
  }
  return (
    <FormDialog title={title} onClose={onClose}>
      <form onSubmit={save}>
        <Issue error={error} />
        {children}
        <Button disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
        <p className="muted">
          If a request times out, retry unchanged to safely resume it. Close and reopen for a
          different operation.
        </p>
      </form>
    </FormDialog>
  );
}
export function Field({
  name,
  label,
  type = 'text',
  value,
  required = true,
  max = 2000,
}: {
  name: string;
  label: string;
  type?: string;
  value?: string | number;
  required?: boolean;
  max?: number;
}) {
  const id = useId();
  return (
    <div className="operation-field">
      <label htmlFor={id}>{label}</label>
      {type === 'textarea' ? (
        <textarea id={id} name={name} defaultValue={value} required={required} maxLength={max} />
      ) : (
        <input
          id={id}
          name={name}
          type={type}
          defaultValue={value}
          required={required}
          maxLength={max}
        />
      )}
    </div>
  );
}
export function Priority({ value = 'NORMAL' }: { value?: string }) {
  return (
    <label>
      Priority
      <select name="priority" defaultValue={value}>
        {['LOW', 'NORMAL', 'HIGH', 'URGENT'].map((v) => (
          <option key={v}>{v}</option>
        ))}
      </select>
    </label>
  );
}
export function Technician({
  staff,
  name = 'technicianId',
  required = true,
}: {
  staff: Staff[];
  name?: string;
  required?: boolean;
}) {
  return (
    <label>
      Technician
      <select name={name} required={required}>
        <option value="">Select technician</option>
        {staff
          .filter((s) => s.technician)
          .map((s) => (
            <option key={s.userId} value={s.userId} disabled={!s.available}>
              {s.displayName}
              {s.available ? '' : ' · unavailable'}
            </option>
          ))}
      </select>
    </label>
  );
}
export function Pagination({
  page,
  setPage,
  result,
}: {
  page: number;
  setPage: (n: number) => void;
  result: Page<unknown> | null;
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
export function Lookup({
  kind,
  onSelect,
}: {
  kind: 'customers' | 'vehicles';
  onSelect: (id: string) => void;
}) {
  const [q, setQ] = useState('');
  const data = useData<
    Page<{ id: string; name: string; registration: string; make: string; model: string }>
  >('customer/' + kind + '?size=20&q=' + encodeURIComponent(q));
  return (
    <label>
      {kind === 'customers' ? 'Find customer' : 'Find vehicle'}
      <input
        aria-label={'Search ' + kind}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={kind === 'customers' ? 'Name or contact' : 'Registration or VIN'}
      />
      <select
        name={kind === 'customers' ? 'customerId' : 'vehicleId'}
        required
        defaultValue=""
        onChange={(e) => onSelect(e.target.value)}
      >
        <option value="">Choose {kind === 'customers' ? 'customer' : 'vehicle'}</option>
        {data.data?.content.map((r) => (
          <option value={r.id} key={r.id}>
            {r.name || [r.registration, r.make, r.model].join(' ')}
          </option>
        ))}
      </select>
      <Issue error={data.error} loading={data.loading} />
    </label>
  );
}
export function Can({ permission, children }: { permission: string; children: ReactNode }) {
  return allowed(useAccount(), permission) ? children : null;
}

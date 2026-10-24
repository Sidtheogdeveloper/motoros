export type {
  Branch,
  Tenant,
  Customer,
  Vehicle,
  WorkOrder,
  Page,
} from '../../../../packages/api-contracts';
export const stages = [
  'CREATED',
  'CHECKED_IN',
  'INSPECTION',
  'ESTIMATE_PENDING',
  'AWAITING_APPROVAL',
  'APPROVED',
  'IN_PROGRESS',
  'QUALITY_CHECK',
  'READY_FOR_DELIVERY',
  'DELIVERED',
  'CLOSED',
];
export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch('/api/backend/' + path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    cache: 'no-store',
  });
  const data = await res.json();
  if (!res.ok) {
    if (res.status === 401 && typeof window !== 'undefined')
      window.location.assign('/session-expired');
    if (res.status === 409 && data.code === 'TENANT_CONTEXT_CHANGED') window.location.reload();
    if (res.status === 403) window.dispatchEvent(new Event('motoros-access-denied'));
    throw new Error(data.title || 'Request failed');
  }
  return data as T;
}
export function send<T>(
  path: string,
  data: unknown,
  method = 'POST',
  tenantId?: string,
  requestKey = crypto.randomUUID(),
) {
  return api<T>(path, {
    method,
    body: JSON.stringify(data),
    headers: {
      'Idempotency-Key': requestKey,
      ...(tenantId ? { 'X-MotorOS-Expected-Tenant': tenantId } : {}),
    },
  });
}
export function statusLabel(status: string) {
  return status.toLowerCase().replaceAll('_', ' ');
}

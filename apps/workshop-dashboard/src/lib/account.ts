export type Membership = {
  id: string;
  tenantId: string;
  name: string;
  role: string;
  scope: string;
  status: string;
  tenantStatus: string;
};
export type Decision = {
  userId: string;
  tenantId: string;
  role: string;
  tenantWide: boolean;
  permissions: string[];
  branches: string[];
  assignedBranches: string[];
};
export type Account = {
  user: {
    id: string;
    email: string;
    displayName: string;
    phone: string | null;
    platformAdmin: boolean;
  };
  memberships: Membership[];
  activeTenant: string | null;
  context: Decision | null;
  expiresAt: number;
};
export async function account(): Promise<Account> {
  const r = await fetch('/api/auth/me', { cache: 'no-store' });
  const data = await r.json();
  if (!r.ok) {
    if (r.status === 401) window.location.assign('/session-expired');
    throw new Error(data.title || 'Unable to load your account');
  }
  return data;
}
export async function switchBrand(tenantId: string) {
  const response = await fetch('/api/context', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenantId }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.title || 'Brand selection denied');
  window.location.assign('/');
}
export async function signOut() {
  const r = await fetch('/api/auth/logout', { method: 'POST' });
  const data = await r.json();
  if (!r.ok) throw new Error(data.title || 'Unable to sign out');
  window.location.assign(data.logoutUrl || '/login');
}
export function allowed(me: Account, permission: string) {
  return me.context?.permissions.includes(permission) || false;
}

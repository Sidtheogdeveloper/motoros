'use client';
import { Brand } from '@/components/brand';

import { useEffect, useState, useCallback } from 'react';
import { ArrowLeft, Plus, RefreshCw, Building2, Users, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { account, allowed, switchBrand, type Account } from '@/lib/account';
import { api, send } from '@/lib/api';
type Row = Record<string, unknown> & { id: string; name?: string; version: number };
type Branch = Row & {
  branchCode: string;
  city: string;
  status: string;
  operatingHours?: Record<string, { closed?: boolean; open?: string; close?: string }>;
  settings?: { serviceBays?: number };
};
type Staff = Row & {
  userId: string;
  displayName: string;
  email: string;
  role: string;
  status: string;
  scope: string;
  branches: string[];
  permissions: string[];
};
type Invite = Row & {
  email: string;
  role: string;
  status: string;
  deliveryStatus: string;
  branches: string[];
  expiresAt: string;
};
const days = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
const titleCase = (value: string) => value.toLowerCase().replaceAll('_', ' ');
const str = (row: Row | null, key: string, fallback = '') =>
  typeof row?.[key] === 'string' ? (row[key] as string) : fallback;
type Mode = 'brand' | 'branches' | 'branch' | 'staff';
export function Management({ mode, branchId }: { mode: Mode; branchId?: string }) {
  const [me, setMe] = useState<Account | null>(null);
  const [row, setRow] = useState<Row | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [roles, setRoles] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Staff | null>(null);
  const [profile, setProfile] = useState<Staff | null>(null);
  const [inviting, setInviting] = useState(false);
  const [q, setQ] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const [page, setPage] = useState(0);
  const can = (permission: string) => !!me && allowed(me, permission);
  const call = useCallback(
    async <T,>(path: string, person: Account) =>
      api<T>(path, { headers: { 'X-MotorOS-Expected-Tenant': person.activeTenant! } }),
    [],
  );
  const load = useCallback(
    async (person: Account) => {
      if (!person.activeTenant || !person.context) return;
      const id = person.activeTenant;
      if (mode === 'brand') setRow(await call<Row>('tenant/tenants/' + id, person));
      if (mode === 'branch' && branchId)
        setRow(await call<Branch>('tenant/branches/' + branchId, person));
      if (mode === 'branches')
        setBranches(await call<Branch[]>(`tenant/branches?page=${page}&size=20`, person));
      if (
        mode === 'staff' &&
        (allowed(person, 'STAFF_INVITE') || allowed(person, 'STAFF_ASSIGN_ROLE'))
      ) {
        const [people, locations, catalog] = await Promise.all([
          call<Staff[]>(
            `tenant/tenants/${id}/staff?size=20&page=${page}&q=${encodeURIComponent(q)}${roleFilter ? '&role=' + roleFilter : ''}${branchFilter ? '&branchId=' + branchFilter : ''}`,
            person,
          ),
          call<Branch[]>('tenant/branches?size=100', person),
          call<{ grantableRoles: string[] }>('tenant/roles', person),
        ]);
        setStaff(people);
        setBranches(locations);
        setRoles(catalog.grantableRoles);
        if (allowed(person, 'STAFF_INVITE'))
          setInvites(
            await call<Invite[]>(`tenant/tenants/${id}/invitations?size=20&page=${page}`, person),
          );
      }
    },
    [mode, branchId, page, q, roleFilter, branchFilter, call],
  );
  useEffect(() => {
    let live = true;
    account()
      .then(async (person) => {
        if (!live) return;
        setMe(person);
        await load(person);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [load]);
  useEffect(() => {
    const timer = setInterval(() => {
      account()
        .then((person) => {
          if (
            me &&
            JSON.stringify([person.activeTenant, person.context]) !==
              JSON.stringify([me.activeTenant, me.context])
          )
            window.location.reload();
        })
        .catch(() => {});
    }, 5000);
    return () => clearInterval(timer);
  }, [me]);
  async function reload() {
    if (me) await load(me);
  }
  async function mutate(path: string, body: unknown, method = 'POST') {
    if (!me) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await send(path, body, method, me.activeTenant!);
      await reload();
      setNotice('Changes saved.');
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function saveBrand(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!row || !me) return;
    const f = Object.fromEntries(new FormData(event.currentTarget));
    await mutate('tenant/tenants/' + me.activeTenant, { ...f, version: row.version }, 'PATCH');
  }
  async function saveBranch(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const status = f.get('status');
    if (
      status === 'INACTIVE' &&
      row?.status !== 'INACTIVE' &&
      !window.confirm(
        'Deactivate this branch? Operational access and new invitations for this branch will stop.',
      )
    )
      return;
    const operatingHours = Object.fromEntries(
      days.map((day) => [
        day,
        {
          closed: f.get(day + '-closed') === 'on',
          open: f.get(day + '-open'),
          close: f.get(day + '-close'),
        },
      ]),
    );
    const fields: Record<string, unknown> = {};
    for (const key of [
      'name',
      'branchCode',
      'city',
      'address',
      'state',
      'postalCode',
      'phone',
      'email',
      'timezone',
      'status',
    ])
      fields[key] = f.get(key);
    const body = {
      ...fields,
      operatingHours,
      settings: { serviceBays: Number(f.get('serviceBays')) },
      ...(row ? { version: row.version } : {}),
    };
    if (branchId) await mutate('tenant/branches/' + branchId, body, 'PATCH');
    else if (me) {
      setBusy(true);
      try {
        const result = await send<{ id: string }>(
          'tenant/branches',
          body,
          'POST',
          me.activeTenant!,
        );
        window.location.assign('/branches/' + result.id);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    }
  }
  async function invitationAction(invite: Invite, action: 'resend' | 'revoke') {
    if (
      !window.confirm(
        action === 'revoke'
          ? 'Revoke this invitation? Its link will stop working.'
          : 'Send a replacement invitation? The previous link will stop working.',
      )
    )
      return;
    await mutate(`tenant/invitations/${invite.id}/${action}`, { version: invite.version });
  }
  const label = {
    brand: 'Brand details',
    branches: 'Branch directory',
    branch: branchId ? 'Branch profile' : 'Create branch',
    staff: 'Staff & invitations',
  }[mode];
  if (!me)
    return (
      <main className="account-page">
        <p role={error ? 'alert' : 'status'}>{error || 'Loading current permissions…'}</p>
      </main>
    );
  if (!me.context)
    return (
      <main className="account-page">
        <h1>Choose a workshop.</h1>
        <a href="/">Return to workspace selection</a>
      </main>
    );
  if (mode === 'staff' && !can('STAFF_INVITE') && !can('STAFF_ASSIGN_ROLE'))
    return (
      <main className="account-page">
        <h1>Access is restricted.</h1>
        <p>Your current role cannot manage staff.</p>
        <a href="/">Return to your workspace</a>
      </main>
    );
  return (
    <main className="management-page">
      <header className="management-header">
        <a href="/" className="brand">
          <Brand />
        </a>
        <label className="brand-picker">
          <span>Active brand</span>
          <select
            aria-label="Active brand"
            value={me.activeTenant!}
            onChange={(e) => switchBrand(e.target.value).catch((error) => setError(error.message))}
          >
            {me.memberships
              .filter((m) => m.tenantStatus === 'ACTIVE')
              .map((m) => (
                <option value={m.tenantId} key={m.id}>
                  {m.name}
                </option>
              ))}
          </select>
        </label>
        <a href="/profile">{me.user.displayName}</a>
      </header>
      <nav className="management-nav">
        <a href="/">
          <ArrowLeft size={14} />
          Workspace
        </a>
        <a href="/settings/brand">Brand details</a>
        <a href="/branches">Branches</a>
        {(can('STAFF_INVITE') || can('STAFF_ASSIGN_ROLE')) && (
          <a href="/staff">Staff & invitations</a>
        )}
      </nav>
      <div className="page-heading">
        <div>
          <span className="eyebrow">
            {me.context.role.replaceAll('_', ' ')} / WORKSHOP ADMINISTRATION
          </span>
          <h1>
            {label}
            <span className="title-dot">.</span>
          </h1>
          <p>Current memberships are enforced by the server on every request.</p>
        </div>
        <div className="chooser-actions">
          <Button variant="outline" onClick={() => reload().catch((e) => setError(e.message))}>
            <RefreshCw size={15} />
            Refresh
          </Button>
          {mode === 'branches' && can('BRANCH_CREATE') && (
            <Button asChild>
              <a href="/branches/new">
                <Plus size={15} />
                Add branch
              </a>
            </Button>
          )}
          {mode === 'staff' && can('STAFF_INVITE') && (
            <Button onClick={() => setInviting(true)}>
              <Plus size={15} />
              Invite employee
            </Button>
          )}
        </div>
      </div>
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {mode === 'brand' && row && (
        <section className="panel admin-form-panel">
          <div className="panel-heading">
            <h2>{str(row, 'name')}</h2>
            <span className="badge">
              {str(row, 'subscriptionPlan')} · {str(row, 'status')}
            </span>
          </div>
          <form key={row.version} onSubmit={saveBrand}>
            <fieldset disabled={!can('TENANT_UPDATE')}>
              <label>
                Brand name
                <input name="name" defaultValue={str(row, 'name')} required maxLength={120} />
              </label>
              <div className="form-grid">
                <label>
                  Business email
                  <input
                    name="businessEmail"
                    type="email"
                    defaultValue={str(row, 'businessEmail')}
                  />
                </label>
                <label>
                  Business phone
                  <input
                    name="businessPhone"
                    defaultValue={str(row, 'businessPhone')}
                    maxLength={32}
                  />
                </label>
              </div>
              <label>
                Business address
                <textarea
                  name="businessAddress"
                  defaultValue={str(row, 'businessAddress')}
                  maxLength={1000}
                />
              </label>
              <div className="form-grid">
                <label>
                  Country
                  <input name="country" defaultValue={str(row, 'country', 'India')} required />
                </label>
                <label>
                  Currency
                  <input
                    name="currency"
                    defaultValue={str(row, 'currency', 'INR')}
                    required
                    maxLength={3}
                  />
                </label>
              </div>
              <label>
                Time zone
                <input
                  name="timezone"
                  defaultValue={str(row, 'timezone', 'Asia/Kolkata')}
                  required
                />
              </label>
            </fieldset>
            {can('TENANT_UPDATE') && (
              <Button type="submit" disabled={busy}>
                Save brand details
              </Button>
            )}
          </form>
        </section>
      )}
      {mode === 'branches' && (
        <>
          <div className="vehicle-grid">
            {branches.map((branch) => (
              <a className="vehicle-card" key={branch.id} href={'/branches/' + branch.id}>
                <Building2 size={28} />
                <strong>{branch.name}</strong>
                <small>
                  {branch.branchCode} · {branch.city}
                </small>
                <span className="tag">{branch.status}</span>
                <span className="vehicle-link">Profile, opening hours & staff</span>
              </a>
            ))}
          </div>
          <Pager page={page} setPage={setPage} next={branches.length === 20} />
        </>
      )}
      {mode === 'branch' && (!branchId || row) && (
        <section className="panel admin-form-panel">
          <div className="panel-heading">
            <h2>{branchId ? str(row, 'name') : 'New workshop branch'}</h2>
            {can('STAFF_INVITE') && branchId && (
              <a href="/staff">Assign staff through invitations</a>
            )}
          </div>
          <form key={row?.version || 0} onSubmit={saveBranch}>
            <fieldset disabled={branchId ? !can('BRANCH_UPDATE') : !can('BRANCH_CREATE')}>
              <div className="form-grid">
                <label>
                  Branch name
                  <input name="name" required maxLength={100} defaultValue={str(row, 'name')} />
                </label>
                <label>
                  Branch code
                  <input
                    name="branchCode"
                    required
                    pattern="[A-Za-z0-9][A-Za-z0-9_-]{1,19}"
                    maxLength={20}
                    defaultValue={str(row, 'branchCode')}
                  />
                </label>
              </div>
              <label>
                Address
                <textarea name="address" maxLength={1000} defaultValue={str(row, 'address')} />
              </label>
              <div className="form-grid">
                <label>
                  City
                  <input name="city" required maxLength={100} defaultValue={str(row, 'city')} />
                </label>
                <label>
                  State
                  <input name="state" maxLength={100} defaultValue={str(row, 'state')} />
                </label>
                <label>
                  Postal code
                  <input name="postalCode" maxLength={20} defaultValue={str(row, 'postalCode')} />
                </label>
                <label>
                  Phone
                  <input name="phone" maxLength={32} defaultValue={str(row, 'phone')} />
                </label>
                <label>
                  Email
                  <input name="email" type="email" defaultValue={str(row, 'email')} />
                </label>
                <label>
                  Time zone
                  <input
                    name="timezone"
                    required
                    defaultValue={str(row, 'timezone', 'Asia/Kolkata')}
                  />
                </label>
                <label>
                  Service bays
                  <input
                    name="serviceBays"
                    type="number"
                    min={1}
                    max={100}
                    required
                    defaultValue={(row as Branch | null)?.settings?.serviceBays || 1}
                  />
                </label>
                <label>
                  Branch status
                  <select name="status" defaultValue={str(row, 'status', 'ACTIVE')}>
                    <option value="ACTIVE">Active</option>
                    <option value="INACTIVE">Inactive</option>
                  </select>
                </label>
              </div>
              <h2>Operating hours</h2>
              <p>Closing before opening represents an overnight shift.</p>
              <div className="hours-grid">
                {days.map((day) => {
                  const hours = (row as Branch | null)?.operatingHours?.[day];
                  return (
                    <div className="hours-row" key={day}>
                      <strong>{titleCase(day)}</strong>
                      <label className="inline-check">
                        <input
                          type="checkbox"
                          name={day + '-closed'}
                          defaultChecked={hours?.closed ?? day === 'SUNDAY'}
                        />
                        Closed
                      </label>
                      <label>
                        Opens
                        <input
                          type="time"
                          name={day + '-open'}
                          defaultValue={hours?.open || '09:00'}
                        />
                      </label>
                      <label>
                        Closes
                        <input
                          type="time"
                          name={day + '-close'}
                          defaultValue={hours?.close || '18:00'}
                        />
                      </label>
                    </div>
                  );
                })}
              </div>
            </fieldset>
            {(branchId ? can('BRANCH_UPDATE') : can('BRANCH_CREATE')) && (
              <Button type="submit" disabled={busy}>
                {branchId ? 'Save branch' : 'Create branch'}
              </Button>
            )}
          </form>
        </section>
      )}
      {mode === 'staff' && (
        <>
          <section className="panel">
            <div className="panel-heading">
              <h2>Employee directory</h2>
              <div className="staff-filters">
                <input
                  aria-label="Search staff"
                  value={q}
                  placeholder="Search name or email"
                  onChange={(e) => {
                    setQ(e.target.value);
                    setPage(0);
                  }}
                />
                <select
                  aria-label="Filter by role"
                  value={roleFilter}
                  onChange={(e) => {
                    setRoleFilter(e.target.value);
                    setPage(0);
                  }}
                >
                  <option value="">All roles</option>
                  {[
                    'BRAND_OWNER',
                    'REGIONAL_MANAGER',
                    'BRANCH_MANAGER',
                    'SERVICE_ADVISOR',
                    'MECHANIC',
                    'INVENTORY_MANAGER',
                    'CUSTOMER',
                  ].map((role) => (
                    <option key={role}>{role}</option>
                  ))}
                </select>
                <select
                  aria-label="Filter by branch"
                  value={branchFilter}
                  onChange={(e) => {
                    setBranchFilter(e.target.value);
                    setPage(0);
                  }}
                >
                  <option value="">All assigned branches</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Role</th>
                    <th>Branches</th>
                    <th>Status</th>
                    <th>Access</th>
                  </tr>
                </thead>
                <tbody>
                  {staff.map((person) => (
                    <tr key={person.id}>
                      <td>
                        <strong>{person.displayName}</strong>
                        <small className="cell-subline">{person.email}</small>
                        <small className="cell-subline">
                          Joined {new Date(str(person, 'createdAt')).toLocaleDateString('en-IN')}
                        </small>
                      </td>
                      <td>{titleCase(person.role)}</td>
                      <td>
                        {person.scope === 'TENANT'
                          ? 'All brand branches'
                          : person.branches
                              .map(
                                (id) =>
                                  branches.find((b) => b.id === id)?.name || 'Assigned branch',
                              )
                              .join(', ')}
                      </td>
                      <td>{titleCase(person.status)}</td>
                      <td>
                        <Button variant="ghost" onClick={() => setProfile(person)}>
                          View profile
                        </Button>
                        {can('STAFF_ASSIGN_ROLE') &&
                        roles.includes(person.role) &&
                        person.userId !== me.user.id ? (
                          <Button variant="outline" onClick={() => setEditing(person)}>
                            Edit access
                          </Button>
                        ) : (
                          <details>
                            <summary>Review permissions</summary>
                            <div className="permission-list">
                              {person.permissions.map((permission) => (
                                <span key={permission}>{titleCase(permission)}</span>
                              ))}
                            </div>
                          </details>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!staff.length && (
                <div className="empty-state">
                  <Users size={28} />
                  <h3>No matching staff</h3>
                  <p>Invite an employee or adjust your filters.</p>
                </div>
              )}
            </div>
          </section>
          <Pager page={page} setPage={setPage} next={staff.length === 20} />
          {can('STAFF_INVITE') && (
            <section className="panel">
              <div className="panel-heading">
                <h2>Invitations</h2>
                <span className="badge">EMAIL-BOUND · SINGLE USE</span>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Recipient</th>
                      <th>Role</th>
                      <th>Status</th>
                      <th>Delivery</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invites.map((invite) => (
                      <tr key={invite.id}>
                        <td>
                          {invite.email}
                          <small className="cell-subline">
                            Expires {new Date(invite.expiresAt).toLocaleString('en-IN')}
                          </small>
                        </td>
                        <td>{titleCase(invite.role)}</td>
                        <td>{titleCase(invite.status)}</td>
                        <td>{titleCase(invite.deliveryStatus || 'PENDING')}</td>
                        <td>
                          {['PENDING', 'EXPIRED'].includes(invite.status) && (
                            <div className="chooser-actions">
                              <Button
                                variant="outline"
                                disabled={busy}
                                onClick={() => invitationAction(invite, 'resend')}
                              >
                                Resend
                              </Button>
                              <Button
                                variant="ghost"
                                disabled={busy}
                                onClick={() => invitationAction(invite, 'revoke')}
                              >
                                Revoke
                              </Button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!invites.length && (
                  <div className="empty-state">
                    <p>No invitations on this page.</p>
                  </div>
                )}
              </div>
            </section>
          )}
        </>
      )}
      {profile && (
        <Modal titleId="staff-profile" onClose={() => setProfile(null)}>
          <div className="form-dialog">
            <h2 id="staff-profile">{profile.displayName}</h2>
            <p>{profile.email}</p>
            <p>Contact: {str(profile, 'phone', 'Not provided')}</p>
            <p>
              {titleCase(profile.role)} · {titleCase(profile.status)}
            </p>
            <p>Joined {new Date(str(profile, 'createdAt')).toLocaleDateString('en-IN')}</p>
            <p>
              {profile.scope === 'TENANT'
                ? 'All brand branches'
                : profile.branches
                    .map((id) => branches.find((b) => b.id === id)?.name || 'Assigned branch')
                    .join(', ')}
            </p>
            <h3>Permissions</h3>
            <div className="permission-list">
              {profile.permissions.map((p) => (
                <span key={p}>{titleCase(p)}</span>
              ))}
            </div>
            <Button onClick={() => setProfile(null)}>Close profile</Button>
          </div>
        </Modal>
      )}
      {inviting && (
        <AccessEditor
          me={me}
          branches={branches}
          roles={roles}
          onClose={() => setInviting(false)}
          onSaved={async () => {
            setInviting(false);
            await reload();
            setNotice('Invitation queued for email delivery.');
          }}
        />
      )}
      {editing && (
        <AccessEditor
          me={me}
          person={editing}
          branches={branches}
          roles={roles}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await reload();
            setNotice('Access updated. New requests use the new permissions immediately.');
          }}
        />
      )}
    </main>
  );
}
function Pager({
  page,
  setPage,
  next,
}: {
  page: number;
  setPage: (n: number) => void;
  next: boolean;
}) {
  return (
    <div className="pager">
      <Button variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>
        Previous
      </Button>
      <span>Page {page + 1}</span>
      <Button variant="outline" disabled={!next} onClick={() => setPage(page + 1)}>
        Next
      </Button>
    </div>
  );
}
function AccessEditor({
  me,
  person,
  branches,
  roles,
  onClose,
  onSaved,
}: {
  me: Account;
  person?: Staff;
  branches: Branch[];
  roles: string[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [role, setRole] = useState(person?.role || roles[0] || '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const tenantWide = role === 'BRAND_OWNER' || role === 'CUSTOMER';
  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const branchIds = tenantWide ? [] : f.getAll('branches');
    const status = f.get('status') || 'ACTIVE';
    if (
      person &&
      !window.confirm(
        `Update ${person.displayName}'s role, branch assignments and status? New requests will use the new access immediately.`,
      )
    )
      return;
    setBusy(true);
    setError('');
    try {
      await send(
        person
          ? `tenant/tenants/${me.activeTenant}/staff/${person.id}/roles`
          : `tenant/tenants/${me.activeTenant}/invitations`,
        person
          ? { role, branchIds, status, version: person.version }
          : { email: f.get('email'), role, branchIds },
        person ? 'PATCH' : 'POST',
        me.activeTenant!,
      );
      await onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal onClose={onClose} titleId="access-title">
      <section className="dialog">
        <button className="dialog-close" onClick={onClose} aria-label="Close access editor">
          <X size={18} />
        </button>
        <span className="eyebrow">VERIFIED WORKSHOP ACCESS</span>
        <h2 id="access-title">{person ? 'Edit employee access' : 'Invite an employee'}</h2>
        <p>
          {person ? person.email : 'The recipient must sign in with this exact verified email.'}
        </p>
        <form onSubmit={submit}>
          {!person && (
            <label>
              Employee email
              <input type="email" name="email" required maxLength={254} />
            </label>
          )}
          <label>
            Role
            <select
              aria-label="Employee role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              required
            >
              {roles.map((role) => (
                <option key={role} value={role}>
                  {titleCase(role)}
                </option>
              ))}
            </select>
          </label>
          {tenantWide ? (
            <p>
              {role === 'BRAND_OWNER'
                ? 'This owner will have tenant-wide administrative access.'
                : 'Customer membership grants no staff operations.'}
            </p>
          ) : (
            <fieldset>
              <legend>Authorized branches</legend>
              {branches
                .filter((b) => b.status === 'ACTIVE')
                .map((branch) => (
                  <label className="inline-check" key={branch.id}>
                    <input
                      type="checkbox"
                      name="branches"
                      value={branch.id}
                      defaultChecked={person?.branches.includes(branch.id)}
                    />
                    {branch.name}
                  </label>
                ))}
            </fieldset>
          )}
          {person && (
            <>
              <label>
                Membership status
                <select name="status" defaultValue={person.status}>
                  <option value="ACTIVE">Active</option>
                  <option value="INACTIVE">Inactive — revoke access</option>
                </select>
              </label>
              <details>
                <summary>Current role permissions</summary>
                <div className="permission-list">
                  {person.permissions.map((p) => (
                    <span key={p}>{titleCase(p)}</span>
                  ))}
                </div>
              </details>
            </>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <Button type="submit" disabled={busy}>
            {busy ? 'Saving…' : person ? 'Save access' : 'Send invitation'}
            <Check size={15} />
          </Button>
        </form>
      </section>
    </Modal>
  );
}

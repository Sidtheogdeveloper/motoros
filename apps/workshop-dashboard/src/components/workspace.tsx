'use client';
import { Brand } from '@/components/brand';

import { useState, useEffect } from 'react';
import { account, switchBrand, signOut, allowed, type Account } from '@/lib/account';
import { WorkshopChooser } from '@/components/workshop-chooser';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Building2,
  Car,
  Check,
  ChevronDown,
  LayoutDashboard,
  LogOut,
  Plus,
  Search,
  ShieldCheck,
  Sun,
  Moon,
  Users,
  Wrench,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import {
  api as baseApi,
  send as baseSend,
  stages,
  statusLabel,
  type Branch,
  type Tenant,
  type Customer,
  type Vehicle,
  type WorkOrder,
  type Page,
} from '@/lib/api';
type View = 'overview' | 'jobs' | 'customers' | 'vehicles' | 'branches';
type FormKind = 'customer' | 'vehicle' | 'workorder' | 'branch';
export function Workspace() {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 10000 } } }),
  );
  return (
    <QueryClientProvider client={client}>
      <Bootstrap />
    </QueryClientProvider>
  );
}
function Bootstrap() {
  const client = useQueryClient();
  const [checking, setChecking] = useState(false);
  const me = useQuery({
    queryKey: ['session'],
    queryFn: account,
    refetchInterval: 5000,
    retry: false,
  });
  useEffect(() => {
    const check = () => {
      setChecking(true);
      void client.invalidateQueries({ queryKey: ['session'] }).finally(() => setChecking(false));
    };
    window.addEventListener('motoros-access-denied', check);
    return () => window.removeEventListener('motoros-access-denied', check);
  }, [client]);
  if (me.isPending || checking)
    return (
      <main className="account-page">
        <p role="status">Checking current workshop access…</p>
      </main>
    );
  if (me.error)
    return (
      <main className="account-page">
        <h1>Workspace unavailable.</h1>
        <p role="alert" className="error">
          {me.error.message}
        </p>
        <Button onClick={() => me.refetch()}>Retry</Button>
        <a href="/login">Return to sign-in</a>
      </main>
    );
  if (!me.data.context || !me.data.context.permissions.length)
    return <WorkshopChooser me={me.data} />;
  return (
    <Dashboard
      key={JSON.stringify([me.data.user.id, me.data.activeTenant, me.data.context])}
      me={me.data}
    />
  );
}
function Dashboard({ me }: { me: Account }) {
  const can = (permission: string) => allowed(me, permission);
  const namespace = [me.user.id, me.activeTenant, JSON.stringify(me.context)];
  const api = <T,>(path: string) =>
    baseApi<T>(path, { headers: { 'X-MotorOS-Expected-Tenant': me.activeTenant! } });
  const send = <T,>(path: string, data: unknown, method = 'POST') =>
    baseSend<T>(path, data, method, me.activeTenant!);

  const client = useQueryClient();
  const [view, setView] = useState<View>('overview');
  const [selected, setSelected] = useState('');
  const [form, setForm] = useState<FormKind | null>(null);
  const [search, setSearch] = useState('');
  const [theme, setTheme] = useState(false);
  const [error, setError] = useState('');
  const [history, setHistory] = useState<Vehicle | null>(null);
  const [busy, setBusy] = useState(false);
  const tenant = useQuery({
    queryKey: [...namespace, 'tenant'],
    queryFn: () => api<Tenant>('tenant/tenants/current'),
  });
  const branches = useQuery({
    queryKey: [...namespace, 'branches'],
    queryFn: () => api<Branch[]>('tenant/branches'),
  });
  const branchId = selected || branches.data?.find((b) => b.status === 'ACTIVE')?.id || '';
  const accessBranch =
    branchId === 'all' ? branches.data?.find((b) => b.status === 'ACTIVE')?.id || '' : branchId;
  const branch = branches.data?.find((b) => b.id === branchId);
  const customers = useQuery({
    queryKey: [...namespace, 'customers', search],
    queryFn: () =>
      api<Page<Customer>>('customer/customers?size=100&q=' + encodeURIComponent(search)),
    enabled: can('CUSTOMER_READ'),
  });
  const vehicles = useQuery({
    queryKey: [...namespace, 'vehicles'],
    queryFn: () => api<Page<Vehicle>>('customer/vehicles?size=100'),
    enabled: can('VEHICLE_READ'),
  });
  const jobs = useQuery({
    queryKey: [...namespace, 'jobs', branchId],
    queryFn: () =>
      api<Page<WorkOrder>>(
        'workorder/work-orders?size=100&' +
          (branchId === 'all' ? 'allBranches=true' : 'branchId=' + branchId),
      ),
    enabled: !!branchId && can('WORKORDER_READ'),
  });
  const historyBranches = useQuery({
    queryKey: [...namespace, 'history-branches'],
    queryFn: () => api<Pick<Branch, 'id' | 'name'>[]>('tenant/history-branches'),
    enabled: !!history && can('VEHICLE_HISTORY_READ'),
  });
  const historyQuery = useQuery({
    queryKey: [...namespace, 'history', history?.id, branchId],
    queryFn: () =>
      api<WorkOrder[]>('workorder/vehicles/' + history!.id + '/history?branchId=' + accessBranch),
    enabled: !!history && !!accessBranch && can('VEHICLE_HISTORY_READ'),
  });
  const all = jobs.data?.content || [];
  const active = all.filter((j) => !['CLOSED', 'DELIVERED', 'CANCELLED'].includes(j.status));
  const loading = tenant.isPending || branches.isPending || jobs.isLoading;
  const failure = tenant.error || branches.error || customers.error || vehicles.error || jobs.error;
  async function refresh() {
    await client.invalidateQueries();
  }
  async function advance(job: WorkOrder) {
    if (!['CREATED', 'CHECKED_IN'].includes(job.status)) {
      window.location.assign('/jobs/' + job.id);
      return;
    }
    const next = job.status === 'CREATED' ? 'CHECKED_IN' : 'INSPECTION';
    setBusy(true);
    setError('');
    try {
      await send(
        'workorder/work-orders/' + job.id + '/status',
        {
          status: next,
          version: job.version,
          note: 'Advisor recorded ' + statusLabel(next) + ' from workshop overview',
        },
        'PATCH',
      );
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to update work order');
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    try {
      await signOut();
      client.clear();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const title = {
    overview: 'Workshop overview',
    jobs: 'Work orders',
    customers: 'Customers',
    vehicles: 'Vehicle garage',
    branches: 'Your branches',
  }[view];
  return (
    <div className={'workspace ' + (theme ? 'light' : '')}>
      <aside className="sidebar">
        <a href="/" className="brand">
          <Brand />
        </a>
        <div className="tenant-box">
          <span className="tenant-avatar">{tenant.data?.name?.slice(0, 1) || 'M'}</span>
          <div>
            <strong>{tenant.data?.name || 'Connecting…'}</strong>
            <small>Workshop workspace</small>
          </div>
          <ShieldCheck size={16} />
        </div>
        <span className="nav-label">WORKSPACE</span>
        <nav>
          {(
            [
              { id: 'overview', icon: LayoutDashboard, label: 'Overview' },
              { id: 'jobs', icon: Wrench, label: 'Work orders' },
              { id: 'customers', icon: Users, label: 'Customers' },
              { id: 'vehicles', icon: Car, label: 'Vehicles' },
              { id: 'branches', icon: Building2, label: 'Branches' },
            ] as const
          )
            .filter((item) =>
              item.id === 'customers'
                ? can('CUSTOMER_READ')
                : item.id === 'vehicles'
                  ? can('VEHICLE_READ')
                  : item.id === 'jobs'
                    ? can('WORKORDER_READ')
                    : true,
            )
            .map((item) => (
              <button
                key={item.id}
                className={view === item.id ? 'nav-item active' : 'nav-item'}
                onClick={() => {
                  setView(item.id);
                  setSearch('');
                }}
              >
                <item.icon size={18} />
                {item.label}
                {item.id === 'jobs' && <span>{jobs.data?.totalElements ?? '—'}</span>}
              </button>
            ))}
        </nav>
        <div className="admin-links">
          {can('BOOKING_READ') && <a href="/appointments">Appointments</a>}
          {can('WORKORDER_READ') && (
            <>
              <a href="/operations">Workshop board</a>
              <a href="/mechanic">My jobs</a>
            </>
          )}
          {can('WORKORDER_CREATE') && <a href="/check-in">Vehicle intake</a>}
          <a href="/settings/brand">Brand details</a>
          {(can('STAFF_INVITE') || can('STAFF_ASSIGN_ROLE')) && (
            <a href="/staff">Staff & invitations</a>
          )}
          <a href="/profile">Your profile</a>
        </div>
        <div className="sidebar-bottom">
          <div className="foundation">
            <span className="green-dot" /> LOCAL FOUNDATION
            <p>
              Connected to your local services.
              <br />
              AI and billing arrive in later milestones.
            </p>
          </div>
          <button className="profile" aria-label="Sign out" onClick={logout}>
            <span className="avatar">SA</span>
            <div>
              <strong>{me.user.displayName}</strong>
              <small>{me.context?.role.replaceAll('_', ' ')}</small>
            </div>
            <LogOut size={16} />
          </button>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <span>/</span> <strong>{title}</strong>
          </div>
          <div className="top-actions">
            <label className="brand-picker">
              <span className="sr-only">Active brand</span>
              <select
                aria-label="Active brand"
                value={me.activeTenant || ''}
                onChange={(e) => {
                  void client.cancelQueries();
                  switchBrand(e.target.value).catch((error) => setError(error.message));
                }}
              >
                {me.memberships
                  .filter((m) => m.tenantStatus === 'ACTIVE')
                  .map((m) => (
                    <option key={m.id} value={m.tenantId}>
                      {m.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="branch-picker">
              <Building2 size={15} />
              <span className="sr-only">Selected branch</span>
              <select
                aria-label="Selected branch"
                value={branchId}
                onChange={(e) => {
                  setSelected(e.target.value);
                  setHistory(null);
                  setForm(null);
                  setError('');
                }}
              >
                {can('ANALYTICS_BRAND_READ') && <option value="all">All branches</option>}
                {branches.data
                  ?.filter((b) => b.status === 'ACTIVE')
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
              </select>
              <ChevronDown size={13} />
            </label>
            <button
              className="icon-button"
              aria-label={theme ? 'Use dark theme' : 'Use light theme'}
              onClick={() => setTheme(!theme)}
            >
              {theme ? <Moon size={17} /> : <Sun size={17} />}
            </button>
            <span className="avatar small">SA</span>
          </div>
        </header>
        <main className="content">
          <div className="page-heading">
            <div>
              <span className="eyebrow">
                {branch?.city || 'MOTOROS'} <span className="dot-separator">/</span>{' '}
                {branch?.name || 'WORKSPACE'}
              </span>
              <h1>
                {title}
                <span className="title-dot">.</span>
              </h1>
              <p>
                {view === 'overview'
                  ? 'A clear view of what’s moving through your workshop.'
                  : view === 'vehicles'
                    ? 'Every vehicle. One history across your brand.'
                    : view === 'branches'
                      ? 'Connected locations, shared customer history.'
                      : 'Keep your workshop moving, one detail at a time.'}
              </p>
            </div>
            {(view === 'customers'
              ? can('CUSTOMER_WRITE')
              : view === 'vehicles'
                ? can('VEHICLE_WRITE')
                : view === 'branches'
                  ? can('BRANCH_CREATE')
                  : can('WORKORDER_CREATE')) && (
              <Button
                disabled={
                  (view === 'overview' || view === 'jobs') && (!branchId || branchId === 'all')
                }
                title={branchId === 'all' ? 'Select a branch to create a work order' : undefined}
                onClick={() =>
                  setForm(
                    view === 'customers'
                      ? 'customer'
                      : view === 'vehicles'
                        ? 'vehicle'
                        : view === 'branches'
                          ? 'branch'
                          : 'workorder',
                  )
                }
              >
                <Plus size={17} />
                {view === 'customers'
                  ? 'Add customer'
                  : view === 'vehicles'
                    ? 'Add vehicle'
                    : view === 'branches'
                      ? 'Add branch'
                      : 'New work order'}
              </Button>
            )}
          </div>
          {(failure || error) && (
            <div role="alert" className="error-banner">
              {error || (failure as Error)?.message}{' '}
              <button
                onClick={() => {
                  setError('');
                  void refresh();
                }}
              >
                Retry
              </button>
            </div>
          )}
          {loading ? (
            <div className="loading" role="status">
              Connecting to your workshop…
            </div>
          ) : (
            <>
              {view === 'overview' && (
                <>
                  <div className="metrics">
                    {[
                      {
                        label: 'Active work orders',
                        value: active.length,
                        icon: Wrench,
                        note: 'In this branch · loaded records',
                      },
                      {
                        label: 'Ready for delivery',
                        value: all.filter((j) => j.status === 'READY_FOR_DELIVERY').length,
                        icon: Check,
                        note: 'Awaiting customer collection',
                      },
                      {
                        label: 'Registered customers',
                        value: customers.data?.totalElements ?? '—',
                        icon: Users,
                        note: 'Shared across your brand',
                      },
                      {
                        label: 'Vehicles in your garage',
                        value: vehicles.data?.totalElements ?? '—',
                        icon: Car,
                        note: 'One connected service history',
                      },
                    ]
                      .filter((m) =>
                        m.label === 'Registered customers'
                          ? can('CUSTOMER_READ')
                          : m.label === 'Vehicles in your garage'
                            ? can('VEHICLE_READ')
                            : true,
                      )
                      .map((m) => (
                        <section className="metric" key={m.label}>
                          <div>
                            {m.label}
                            <m.icon size={17} />
                          </div>
                          <strong>{m.value}</strong>
                          <small>{m.note}</small>
                        </section>
                      ))}
                  </div>
                  <div className="section-row">
                    <h2>
                      On the workshop floor <span>{active.length}</span>
                    </h2>
                    <button onClick={() => setView('jobs')}>
                      View all work orders <ArrowUpRight size={15} />
                    </button>
                  </div>
                  <div className="board">
                    {[
                      {
                        label: 'Intake & inspection',
                        states: ['CREATED', 'CHECKED_IN', 'INSPECTION'],
                        color: 'amber',
                      },
                      {
                        label: 'Estimates & approval',
                        states: ['ESTIMATE_PENDING', 'AWAITING_APPROVAL', 'APPROVED'],
                        color: 'purple',
                      },
                      {
                        label: 'In the workshop',
                        states: ['IN_PROGRESS', 'QUALITY_CHECK'],
                        color: 'blue',
                      },
                      { label: 'Ready to go', states: ['READY_FOR_DELIVERY'], color: 'green' },
                    ].map((column) => {
                      const rows = all.filter((j) => column.states.includes(j.status));
                      return (
                        <section className="board-column" key={column.label}>
                          <div className="column-title">
                            <span className={'status-dot ' + column.color} />
                            {column.label}
                            <small>{rows.length}</small>
                          </div>
                          {rows.length ? (
                            rows
                              .slice(0, 3)
                              .map((j) => (
                                <JobCard
                                  key={j.id}
                                  job={j}
                                  vehicle={vehicles.data?.content.find((v) => v.id === j.vehicleId)}
                                  onAdvance={can('WORKORDER_UPDATE') ? () => advance(j) : undefined}
                                  busy={busy}
                                />
                              ))
                          ) : (
                            <div className="empty-column">
                              <Check size={20} />
                              <span>All clear here</span>
                              <small>Jobs appear as work progresses</small>
                            </div>
                          )}
                        </section>
                      );
                    })}
                  </div>
                  <div className="bottom-grid">
                    <section className="panel activity-panel">
                      <div className="panel-heading">
                        <h2>Connected service history</h2>
                        <Car size={19} />
                      </div>
                      <p>Previous visits, wherever they happened.</p>
                      <div className="history-callout">
                        <div className="vehicle-illustration">
                          <Car size={56} strokeWidth={1} />
                        </div>
                        <div>
                          <strong>One vehicle. Every branch.</strong>
                          <p>
                            Open a vehicle to see delivered and closed work orders from authorized
                            locations across your brand.
                          </p>
                          <Button variant="outline" onClick={() => setView('vehicles')}>
                            Explore vehicle garage <ArrowRight size={15} />
                          </Button>
                        </div>
                      </div>
                    </section>
                    <section className="panel branch-panel">
                      <div className="panel-heading">
                        <h2>Branch network</h2>
                        <span className="badge">LIVE</span>
                      </div>
                      {branches.data?.map((b) => (
                        <button className="branch-row" key={b.id} onClick={() => setSelected(b.id)}>
                          <span className="branch-building">
                            <Building2 size={18} />
                          </span>
                          <span>
                            <strong>{b.name}</strong>
                            <small>{b.city}</small>
                          </span>
                          {b.id === branchId ? (
                            <span className="selected-label">
                              Selected <Check size={12} />
                            </span>
                          ) : (
                            <ArrowUpRight size={16} />
                          )}
                        </button>
                      ))}
                    </section>
                  </div>
                </>
              )}
              {view === 'jobs' && (
                <section className="panel">
                  <div className="panel-heading">
                    <h2>Branch work orders</h2>
                    <span className="badge">{jobs.data?.totalElements ?? 0} TOTAL</span>
                  </div>
                  {all.length ? (
                    <div className="job-list">
                      {all.map((j) => (
                        <JobCard
                          key={j.id}
                          job={j}
                          vehicle={vehicles.data?.content.find((v) => v.id === j.vehicleId)}
                          onAdvance={can('WORKORDER_UPDATE') ? () => advance(j) : undefined}
                          busy={busy}
                        />
                      ))}
                    </div>
                  ) : (
                    <Empty
                      icon="jobs"
                      title="Your floor is ready"
                      text="Create a customer, register their vehicle, then open the first work order."
                      action={() => setForm('workorder')}
                      label="Create work order"
                    />
                  )}
                </section>
              )}
              {view === 'customers' && (
                <section className="panel">
                  <div className="panel-heading">
                    <h2>
                      Customer directory <span>{customers.data?.totalElements ?? 0}</span>
                    </h2>
                    <label className="search">
                      <Search size={16} />
                      <input
                        aria-label="Search customers"
                        placeholder="Search by name…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </label>
                  </div>
                  {customers.data?.content.length ? (
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Customer</th>
                            <th>Email</th>
                            <th>Phone</th>
                            <th>Scope</th>
                          </tr>
                        </thead>
                        <tbody>
                          {customers.data.content.map((c) => (
                            <tr key={c.id}>
                              <td>
                                <span className="table-avatar">{c.name[0]}</span>
                                {c.name}
                              </td>
                              <td>{c.email || '—'}</td>
                              <td>{c.phone || '—'}</td>
                              <td>
                                <span className="tag">Brand-wide</span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <Empty
                      icon="customers"
                      title="Your customers, in one place"
                      text="Add your first customer to start building a lasting service relationship."
                      action={() => setForm('customer')}
                      label="Add customer"
                    />
                  )}
                </section>
              )}
              {view === 'vehicles' && (
                <section className="panel">
                  <div className="panel-heading">
                    <h2>Brand vehicle garage</h2>
                    <span className="badge">{vehicles.data?.totalElements ?? 0} VEHICLES</span>
                  </div>
                  {vehicles.data?.content.length ? (
                    <div className="vehicle-grid">
                      {vehicles.data.content.map((v) => (
                        <button className="vehicle-card" key={v.id} onClick={() => setHistory(v)}>
                          <Car size={38} strokeWidth={1} />
                          <span className="registration">{v.registration}</span>
                          <strong>
                            {v.make} {v.model}
                          </strong>
                          <small>
                            {customers.data?.content.find((c) => c.id === v.customerId)?.name ||
                              'Registered customer'}
                          </small>
                          <span className="vehicle-link">
                            View service history <ArrowUpRight size={15} />
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <Empty
                      icon="vehicles"
                      title="Build your vehicle garage"
                      text="Register a vehicle against an existing customer to begin its service timeline."
                      action={() => setForm('vehicle')}
                      label="Add vehicle"
                    />
                  )}
                </section>
              )}
              {view === 'branches' && (
                <section className="panel">
                  <div className="panel-heading">
                    <h2>Your connected locations</h2>
                    <span className="badge">{branches.data?.length ?? 0} BRANCHES</span>
                  </div>
                  <div className="vehicle-grid">
                    {branches.data?.map((b) => (
                      <div className="vehicle-card" key={b.id}>
                        <Building2 size={32} />
                        <h3>{b.name}</h3>
                        <p>{b.city}</p>
                        <a className="vehicle-link" href={'/branches/' + b.id}>
                          Branch profile & hours
                        </a>
                        <Button
                          variant="outline"
                          onClick={() => {
                            setSelected(b.id);
                            setView('overview');
                          }}
                        >
                          Open branch <ArrowRight size={15} />
                        </Button>
                      </div>
                    ))}
                  </div>
                  <p className="panel-note">
                    Memberships are checked live. Newly created branches appear immediately for
                    authorized owners.
                  </p>
                </section>
              )}
              <footer className="workspace-footer">
                <span>
                  <span className="green-dot" /> Local API workspace
                </span>
                <span>MotorOS Foundation · v0.1</span>
              </footer>
            </>
          )}
        </main>
      </div>
      {form && (
        <RecordForm
          kind={form}
          tenantId={me.activeTenant!}
          branchId={branchId}
          customers={customers.data?.content || []}
          vehicles={vehicles.data?.content || []}
          onClose={() => setForm(null)}
          onSaved={async () => {
            setForm(null);
            await refresh();
          }}
        />
      )}
      {history && (
        <Modal titleId="history-title" onClose={() => setHistory(null)}>
          <section className="dialog">
            <button
              className="dialog-close"
              aria-label="Close history"
              onClick={() => setHistory(null)}
            >
              <X size={20} />
            </button>
            <span className="eyebrow">CROSS-BRANCH SERVICE HISTORY</span>
            <h2 id="history-title">{history.registration}</h2>
            <p>
              {history.make} {history.model} · Access from {branch?.name}
            </p>
            {historyQuery.isPending ? (
              <p role="status">Retrieving authorized records…</p>
            ) : historyQuery.error ? (
              <p role="alert" className="error">
                {historyQuery.error.message}
              </p>
            ) : historyQuery.data?.length ? (
              <div className="timeline">
                {historyQuery.data.map((j) => (
                  <div key={j.id}>
                    <span className="green-dot" />
                    <strong>
                      {new Date(j.createdAt).toLocaleDateString('en-IN')} ·{' '}
                      {historyBranches.data?.find((b) => b.id === j.branchId)?.name ||
                        'Authorized brand branch'}
                    </strong>
                    <p>{j.complaint}</p>
                    <small>
                      {statusLabel(j.status)} · WO-{j.id.slice(0, 8)}
                    </small>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <Activity size={32} />
                <h3>No completed visits yet</h3>
                <p>Delivered and closed work orders will appear here.</p>
              </div>
            )}
            <p className="panel-note">
              <ShieldCheck size={14} /> This sensitive access is recorded in the audit log.
            </p>
          </section>
        </Modal>
      )}
    </div>
  );
}
function JobCard({
  job,
  vehicle,
  onAdvance,
  busy,
}: {
  job: WorkOrder;
  vehicle?: Vehicle;
  onAdvance?: () => void;
  busy: boolean;
}) {
  const next = stages[stages.indexOf(job.status) + 1];
  return (
    <article className="job-card">
      <div className="job-top">
        <span>WO-{job.id.slice(0, 8).toUpperCase()}</span>
        <ArrowDownRight size={14} />
      </div>
      <strong>
        {vehicle?.make || 'Vehicle'} {vehicle?.model || ''}
      </strong>
      <span className="plate">{vehicle?.registration || job.vehicleId.slice(0, 8)}</span>
      <p>{job.complaint}</p>
      <div className="job-bottom">
        <span className={'tag ' + (job.status === 'READY_FOR_DELIVERY' ? 'ready' : '')}>
          {statusLabel(job.status)}
        </span>
        {next && onAdvance && job.status !== 'CANCELLED' && (
          <button
            disabled={busy}
            onClick={onAdvance}
            aria-label={
              ['CREATED', 'CHECKED_IN'].includes(job.status)
                ? 'Move work order to ' + statusLabel(next)
                : 'Open job card workflow'
            }
            title={
              ['CREATED', 'CHECKED_IN'].includes(job.status)
                ? 'Move to ' + statusLabel(next)
                : 'Open guarded job card workflow'
            }
          >
            <ArrowRight size={16} />
          </button>
        )}
      </div>
    </article>
  );
}
function Empty({
  icon,
  title,
  text,
  action,
  label,
}: {
  icon: string;
  title: string;
  text: string;
  action: () => void;
  label: string;
}) {
  return (
    <div className="empty-state">
      {icon === 'vehicles' ? (
        <Car size={36} />
      ) : icon === 'customers' ? (
        <Users size={36} />
      ) : (
        <Wrench size={36} />
      )}
      <h3>{title}</h3>
      <p>{text}</p>
      <Button variant="outline" onClick={action}>
        <Plus size={16} />
        {label}
      </Button>
    </div>
  );
}
function RecordForm({
  kind,
  tenantId,
  branchId,
  customers,
  vehicles,
  onClose,
  onSaved,
}: {
  kind: FormKind;
  tenantId: string;
  branchId: string;
  customers: Customer[];
  vehicles: Vehicle[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const send = <T,>(path: string, data: unknown, method = 'POST') =>
    baseSend<T>(path, data, method, tenantId);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const title = {
    customer: 'Add a customer',
    vehicle: 'Register a vehicle',
    workorder: 'New work order',
    branch: 'Connect a branch',
  }[kind];
  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const paths = {
        customer: 'customer/customers',
        vehicle: 'customer/vehicles',
        workorder: 'workorder/work-orders',
        branch: 'tenant/branches',
      };
      await send(paths[kind], { ...data, ...(kind === 'workorder' ? { branchId } : {}) });
      await onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal titleId="form-title" onClose={onClose}>
      <section className="dialog">
        <button className="dialog-close" aria-label="Close form" onClick={onClose}>
          <X size={20} />
        </button>
        <span className="eyebrow">WORKSHOP OPERATIONS</span>
        <h2 id="form-title">{title}</h2>
        <p>Saved securely to your workshop’s local database.</p>
        <form onSubmit={submit}>
          {kind === 'customer' ? (
            <>
              <label>
                Full name
                <input name="name" required maxLength={120} autoFocus />
              </label>
              <label>
                Email
                <input name="email" type="email" maxLength={254} />
              </label>
              <label>
                Phone
                <input name="phone" maxLength={32} />
              </label>
            </>
          ) : kind === 'vehicle' ? (
            <>
              <label>
                Customer
                <select name="customerId" aria-label="Customer" required defaultValue="">
                  <option value="" disabled>
                    Select customer
                  </option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Registration number
                <input name="registration" required maxLength={32} />
              </label>
              <div className="form-grid">
                <label>
                  Manufacturer
                  <input name="make" required maxLength={80} />
                </label>
                <label>
                  Model
                  <input name="model" required maxLength={80} />
                </label>
              </div>
              {!customers.length && (
                <p className="notice">Add a customer before registering a vehicle.</p>
              )}
            </>
          ) : kind === 'workorder' ? (
            <>
              <label>
                Vehicle
                <select name="vehicleId" aria-label="Vehicle" required defaultValue="">
                  <option value="" disabled>
                    Select a vehicle
                  </option>
                  {vehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.registration} · {v.make} {v.model}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Customer complaint
                <textarea name="complaint" required maxLength={2000} rows={4} />
              </label>
              {!vehicles.length && (
                <p className="notice">
                  Register a customer and vehicle before creating a work order.
                </p>
              )}
            </>
          ) : (
            <>
              <label>
                Branch name
                <input name="name" required maxLength={100} />
              </label>
              <label>
                Branch code
                <input
                  name="branchCode"
                  required
                  maxLength={20}
                  pattern="[A-Za-z0-9][A-Za-z0-9_-]{1,19}"
                />
              </label>
              <label>
                City
                <input name="city" required maxLength={100} />
              </label>
            </>
          )}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                busy ||
                (kind === 'workorder' && !vehicles.length) ||
                (kind === 'vehicle' && !customers.length)
              }
            >
              {busy ? 'Saving…' : 'Save record'}
              <Check size={16} />
            </Button>
          </div>
        </form>
      </section>
    </Modal>
  );
}

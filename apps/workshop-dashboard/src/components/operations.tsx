'use client';
import { useState, useEffect } from 'react';
import { account, allowed, switchBrand, type Account } from '@/lib/account';
import { Context, Issue, useData } from './registry/shared';
import { type Branch } from './operations/shared';
import { Bookings } from './operations/bookings';
import { Jobs, JobDetail, Workload } from './operations/jobs';
import { Intake } from './operations/intake';
import { Inventory } from './commercial/inventory';
import { Transfers } from './commercial/transfers';
import { NotificationCenter } from './communications/notification-center';
import { BranchReporting } from './communications/reporting';
import { Estimates, EstimateDetail, Invoices, InvoiceDetail } from './commercial/billing';
export function OperationsPage({
  view,
  id,
}: {
  view:
    | 'appointments'
    | 'check-in'
    | 'jobs'
    | 'operations'
    | 'mechanic'
    | 'workload'
    | 'inventory'
    | 'transfers'
    | 'estimates'
    | 'invoices'
    | 'notifications'
    | 'reporting';
  id?: string;
}) {
  const [me, setMe] = useState<Account | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    account()
      .then(setMe)
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (!me) return;
    const timer = setInterval(
      () =>
        account()
          .then((n) => {
            if (
              JSON.stringify(n.context) !== JSON.stringify(me.context) ||
              n.activeTenant !== me.activeTenant
            )
              window.location.reload();
          })
          .catch(() => {}),
      5000,
    );
    return () => clearInterval(timer);
  }, [me]);
  if (!me)
    return (
      <main className="account-page">
        <Issue error={error} loading={!error} />
      </main>
    );
  if (!me.context)
    return (
      <main className="account-page">
        <h1>Select a workshop</h1>
        <a href="/">Workspaces</a>
      </main>
    );
  const permission =
    view === 'notifications'
      ? 'NOTIFICATION_READ'
      : view === 'reporting'
        ? 'ANALYTICS_BRANCH_READ'
        : view === 'inventory' || view === 'transfers'
          ? 'INVENTORY_READ'
          : view === 'estimates'
            ? 'ESTIMATE_READ'
            : view === 'invoices'
              ? 'INVOICE_READ'
              : view === 'appointments'
                ? 'BOOKING_READ'
                : view === 'check-in'
                  ? 'WORKORDER_CREATE'
                  : 'WORKORDER_READ';
  if (!allowed(me, permission))
    return (
      <main className="account-page">
        <h1>Access denied</h1>
        <a href="/">Workspace</a>
      </main>
    );
  return (
    <Context.Provider value={me}>
      <main className="management-page operations-page">
        <header className="management-header">
          <a className="brand" href="/">
            motor<span>os</span>
          </a>
          <label className="brand-picker">
            Active brand
            <select
              aria-label="Active brand"
              value={me.activeTenant!}
              onChange={(e) => switchBrand(e.target.value).catch((e) => setError(e.message))}
            >
              {me.memberships
                .filter((m) => m.tenantStatus === 'ACTIVE')
                .map((m) => (
                  <option key={m.tenantId} value={m.tenantId}>
                    {m.name}
                  </option>
                ))}
            </select>
          </label>
        </header>
        <nav className="management-nav">
          <a href="/">Workspace</a>
          {allowed(me, 'BOOKING_READ') && <a href="/appointments">Appointments</a>}
          {allowed(me, 'WORKORDER_CREATE') && <a href="/check-in">Vehicle intake</a>}
          <a href="/jobs">Job cards</a>
          <a href="/operations">Job board</a>
          <a href="/workload">Technicians</a>
          <a href="/mechanic">My jobs</a>
          <a href="/vehicles">Vehicles</a>
          {allowed(me, 'INVENTORY_READ') && (
            <>
              <a href="/inventory">Inventory</a>
              <a href="/transfers">Transfers</a>
            </>
          )}
          {allowed(me, 'ESTIMATE_READ') && <a href="/estimates">Estimates</a>}
          {allowed(me, 'INVOICE_READ') && <a href="/invoices">Invoices</a>}
          {allowed(me, 'NOTIFICATION_READ') && <a href="/notifications">Communications</a>}
          {allowed(me, 'ANALYTICS_BRANCH_READ') && <a href="/reporting">Reporting</a>}
          {me.user.platformAdmin && <a href="/platform/operations">Event operations</a>}
        </nav>
        <Issue error={error} />
        <Operations view={view} id={id} />
      </main>
    </Context.Provider>
  );
}
function Operations({ view, id }: { view: string; id?: string }) {
  const branches = useData<Branch[]>('tenant/branches?size=100'),
    [selected, setSelected] = useState('');
  const active = branches.data?.filter((b) => b.status === 'ACTIVE') || [];
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('branch');
    if (requested) setSelected(requested);
  }, []);
  const branch = active.some((b) => b.id === selected) ? selected : active[0]?.id || '';
  return (
    <>
      <div className="operations-heading">
        <div>
          <span className="eyebrow">WORKSHOP OPERATIONS</span>
          <h1>
            {id
              ? view === 'estimates'
                ? 'Estimate'
                : view === 'invoices'
                  ? 'Invoice'
                  : 'Job card'
              : (
                  {
                    notifications: 'Customer communications',
                    reporting: 'Branch reporting',
                    inventory: 'Inventory',
                    transfers: 'Stock transfers',
                    estimates: 'Estimates',
                    invoices: 'Invoices',
                    appointments: 'Appointments',
                    'check-in': 'Vehicle intake',
                    jobs: 'Job cards',
                    operations: 'Workshop board',
                    mechanic: 'My jobs',
                    workload: 'Technician workload',
                  } as Record<string, string>
                )[view]}
          </h1>
        </div>
        {!id && (
          <label>
            Acting branch
            <select
              aria-label="Acting branch"
              value={branch}
              onChange={(e) => setSelected(e.target.value)}
            >
              {active.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <Issue error={branches.error} loading={branches.loading} />
      {branches.data && !branches.loading && !branch && (
        <p role="alert">No active authorized branch.</p>
      )}
      {branch &&
        (id ? (
          view === 'estimates' ? (
            <EstimateDetail key={id} id={id} />
          ) : view === 'invoices' ? (
            <InvoiceDetail key={id} id={id} />
          ) : (
            <JobDetail key={id} id={id} branches={active} />
          )
        ) : view === 'notifications' ? (
          <NotificationCenter key={branch} branch={branch} />
        ) : view === 'reporting' ? (
          <BranchReporting key={branch} branch={branch} />
        ) : view === 'inventory' ? (
          <Inventory key={branch} branch={branch} />
        ) : view === 'transfers' ? (
          <Transfers key={branch} branch={branch} branches={active} />
        ) : view === 'estimates' ? (
          <Estimates key={branch} branch={branch} />
        ) : view === 'invoices' ? (
          <Invoices key={branch} branch={branch} />
        ) : view === 'appointments' ? (
          <Bookings key={branch} branch={active.find((b) => b.id === branch)!} />
        ) : view === 'check-in' ? (
          <Intake branch={branch} onAppointmentBranch={setSelected} />
        ) : view === 'workload' ? (
          <Workload key={branch} branch={branch} />
        ) : (
          <Jobs
            key={branch}
            branch={branch}
            board={view === 'operations'}
            mine={view === 'mechanic'}
          />
        ))}
    </>
  );
}

'use client';
import { useData, Issue } from '../registry/shared';
import { Button } from '../ui/button';
import { formatDecimal } from '@/lib/decimal';
type Metrics = {
  booking: { bookings: number; confirmed: number; cancelled: number }[];
  workorder: { completedWorkOrders: number; averageTurnaroundMinutes: string | null }[];
  billing: {
    currency: string;
    issuedInvoices: number;
    issuedInvoiceValue: string;
    recordedPaymentCollections: string;
    pendingApprovals: number;
  }[];
  parts: { consumed_quantity: string }[];
  notifications: { status: string; count: number }[];
  freshness: {
    lastEventAt: string | null;
    projectedAt: string | null;
    secondsSinceProjection: string | null;
  };
  asOf: string;
  consistency: string;
  collectionsDefinition: string;
};
export function BranchReporting({ branch }: { branch: string }) {
  const data = useData<Metrics>(`analytics/analytics/branch?branchId=${branch}`);
  return (
    <>
      <p>
        Event-driven reporting is eventually consistent. A quiet projection does not prove that the
        source queues are empty.
      </p>
      <Button variant="outline" onClick={data.reload}>
        Refresh reporting
      </Button>
      <Issue error={data.error} loading={data.loading} />
      {data.data && (
        <>
          <section className="operation-card">
            <h2>Projection freshness</h2>
            <p>
              Last source event:{' '}
              {data.data.freshness.lastEventAt
                ? new Date(data.data.freshness.lastEventAt).toLocaleString()
                : 'No projected events'}
            </p>
            <p>
              Last projection:{' '}
              {data.data.freshness.projectedAt
                ? new Date(data.data.freshness.projectedAt).toLocaleString()
                : 'Awaiting events'}
            </p>
            <p>Snapshot requested: {new Date(data.data.asOf).toLocaleString()}</p>
          </section>
          <section className="operation-card">
            <h2>Bookings</h2>
            {data.data.booking.map((m, i) => (
              <p key={i}>
                {m.bookings} bookings · {m.confirmed} confirmed · {m.cancelled} cancelled
              </p>
            ))}
          </section>
          <section className="operation-card">
            <h2>Workshop completion</h2>
            {data.data.workorder.map((m, i) => (
              <p key={i}>
                {m.completedWorkOrders} completed repairs · average turnaround{' '}
                {m.averageTurnaroundMinutes === null
                  ? 'unavailable'
                  : Number(m.averageTurnaroundMinutes).toFixed(1) + ' minutes'}
              </p>
            ))}
          </section>
          <section className="operation-card">
            <h2>Billing and collections</h2>
            <p>{data.data.collectionsDefinition}</p>
            {data.data.billing.map((m) => (
              <div key={m.currency || 'none'}>
                <h3>{m.currency || 'Unspecified currency'}</h3>
                <p>
                  {m.issuedInvoices} issued invoices · issued value{' '}
                  {formatDecimal(m.issuedInvoiceValue)}
                </p>
                <p>
                  Recorded net collections {formatDecimal(m.recordedPaymentCollections)} ·{' '}
                  {m.pendingApprovals} pending approvals
                </p>
              </div>
            ))}
          </section>
          <section className="operation-card">
            <h2>Parts and communications</h2>
            <p>Consumed quantity: {data.data.parts[0]?.consumed_quantity || '0'}</p>
            {data.data.notifications.map((n) => (
              <p key={n.status}>
                {n.status}: {n.count}
              </p>
            ))}
          </section>
        </>
      )}
    </>
  );
}

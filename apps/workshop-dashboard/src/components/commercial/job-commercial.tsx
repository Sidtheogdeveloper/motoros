'use client';
import { useData, useAccount, Issue } from '../registry/shared';
import { allowed } from '@/lib/account';
import { useCommand, Badge, type Job, type Page } from '../operations/shared';
import { Button } from '../ui/button';
import { Amount } from './shared';
import type { Estimate, Invoice } from './billing';
export function JobCommercial({ job, refresh }: { job: Job; refresh: () => void }) {
  const me = useAccount(),
    can = (p: string) => allowed(me, p),
    cmd = useCommand();
  const estimates = useData<Page<Estimate>>(
      can('ESTIMATE_READ')
        ? `billing/estimates?branchId=${job.branchId}&workOrderId=${job.id}`
        : null,
    ),
    invoices = useData<Page<Invoice>>(
      can('INVOICE_READ')
        ? `billing/invoices?branchId=${job.branchId}&workOrderId=${job.id}`
        : null,
    );
  const current = estimates.data?.content.find((e) => e.status === 'APPROVED');
  return (
    <section className="panel operation-card">
      <h2>Parts and commercial workflow</h2>
      <Issue
        error={estimates.error || invoices.error || cmd.error}
        loading={estimates.loading || invoices.loading}
      />
      {can('INVENTORY_READ') && (
        <p>
          <a href={'/inventory?branch=' + job.branchId}>Branch stock and job reservations</a>
        </p>
      )}
      {can('ESTIMATE_READ') && (
        <>
          <p>
            <a href={'/estimates?branch=' + job.branchId}>Estimate builder and revisions</a>
          </p>
          {estimates.data?.content.map((e) => (
            <p key={e.id}>
              <a href={'/estimates/' + e.id}>Estimate revision {e.revision}</a> ·{' '}
              <Badge value={e.status} /> · <Amount value={e.total} currency={e.currency} />
            </p>
          ))}
          {can('WORKORDER_ASSIGN') &&
            current &&
            ['AWAITING_APPROVAL', 'APPROVED', 'IN_PROGRESS'].includes(job.status) && (
              <Button
                variant="outline"
                disabled={cmd.busy}
                onClick={() =>
                  cmd.run(
                    `workorder/work-orders/${job.id}/commercial-approval`,
                    {
                      version: job.version,
                      note: 'Verified current customer approval against Billing',
                    },
                    refresh,
                  )
                }
              >
                Verify customer approval for repair
              </Button>
            )}
        </>
      )}
      {can('INVOICE_READ') &&
        invoices.data?.content.map((i) => (
          <p key={i.id}>
            <a href={'/invoices/' + i.id}>{i.invoiceNumber || 'Draft invoice'}</a> · {i.status}
          </p>
        ))}
      {can('INVOICE_WRITE') &&
        current &&
        invoices.data?.content.length === 0 &&
        ['QUALITY_CHECK', 'READY_FOR_DELIVERY'].includes(job.status) && (
          <Button
            variant="outline"
            disabled={cmd.busy}
            onClick={() =>
              cmd.run<Invoice>('billing/invoices', { estimateId: current.id }, (i) =>
                window.location.assign('/invoices/' + i.id),
              )
            }
          >
            Create invoice from approved estimate
          </Button>
        )}
      {can('WORKORDER_ASSIGN') &&
        job.commercialEstimateId &&
        job.status === 'QUALITY_CHECK' &&
        job.qualityPassedAt && (
          <Button
            disabled={cmd.busy}
            onClick={() =>
              cmd.run(
                `workorder/work-orders/${job.id}/ready-for-delivery`,
                { version: job.version, note: 'Quality sign-off and financial readiness verified' },
                refresh,
              )
            }
          >
            Verify invoice and mark ready for delivery
          </Button>
        )}
      {job.commercialEstimateId && (
        <p className="muted">
          Customer approval is verified again before repair updates. New tasks or additional part
          quantities require a revised approved estimate.
        </p>
      )}
    </section>
  );
}

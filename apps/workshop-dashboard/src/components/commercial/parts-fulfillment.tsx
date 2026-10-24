'use client';
import { useState } from 'react';
import { send } from '@/lib/api';
import { useAccount, useData, Issue } from '../registry/shared';
import { ActionForm, Field, type Job, type Page } from '../operations/shared';
import { Button } from '../ui/button';
import { Paging } from './shared';
type Installation = {
  id: string;
  partId: string;
  partName: string;
  sku: string;
  quantity: string;
  status: string;
};
type Request = {
  id: string;
  quantity: number;
  version: number;
  status: string;
  inventoryReservationId?: string;
};
export function PartsFulfillment({
  job,
  request,
  refresh,
}: {
  job: Job;
  request: Request;
  refresh: () => void;
}) {
  const [open, setOpen] = useState(false);
  return request.inventoryReservationId ? (
    <p className="muted">Installed stock has been verified for this parts request.</p>
  ) : (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        Link installed stock
      </Button>
      {open && (
        <LinkForm
          job={job}
          request={request}
          onClose={() => setOpen(false)}
          saved={() => {
            setOpen(false);
            refresh();
          }}
        />
      )}
    </>
  );
}
function LinkForm({
  job,
  request,
  onClose,
  saved,
}: {
  job: Job;
  request: Request;
  onClose: () => void;
  saved: () => void;
}) {
  const me = useAccount(),
    [page, setPage] = useState(0),
    data = useData<Page<Installation>>(
      `inventory/inventory/reservations?branchId=${job.branchId}&workOrderId=${job.id}&page=${page}`,
    );
  return (
    <ActionForm
      title="Verify installed parts"
      onClose={onClose}
      submit={async (f, key) => {
        await send(
          `workorder/work-orders/${job.id}/parts/${request.id}/fulfill`,
          { version: request.version, reservationId: f.get('reservationId'), note: f.get('note') },
          'POST',
          me.activeTenant!,
          key,
        );
        saved();
      }}
    >
      <p>
        Choose the recorded installation that fulfills this request. Quantity must match{' '}
        {request.quantity}. A reservation that has not been installed cannot close the request.
      </p>
      <Issue error={data.error} loading={data.loading} />
      <label>
        Installed reservation
        <select name="reservationId" required>
          <option value="">Choose installed stock</option>
          {data.data?.content
            .filter((r) => r.status === 'CONSUMED')
            .map((r) => (
              <option key={r.id} value={r.id}>
                {r.sku} · {r.partName} · Quantity {r.quantity}
              </option>
            ))}
        </select>
      </label>
      <Paging page={page} setPage={setPage} data={data.data} />
      <Field name="note" label="Parts verification notes" max={850} />
    </ActionForm>
  );
}

'use client';
import { useDeferredValue, useState } from 'react';
import { allowed } from '@/lib/account';
import { send } from '@/lib/api';
import { useAccount, useData, Issue } from '../registry/shared';
import {
  ActionForm,
  Badge,
  Field,
  date,
  useCommand,
  type Branch,
  type Page,
} from '../operations/shared';
import { Button } from '../ui/button';
import { DecimalField } from './inventory';
import { Paging, PartPicker } from './shared';
type Line = {
  partId: string;
  sku:string;partName:string;
  quantity: string;
  receivedQuantity: string;
  damagedQuantity: string;
  missingQuantity: string;
};
type Transfer = {
  id: string;
  createdBy: string;
  sourceBranchId: string;
  destinationBranchId: string;
  status: string;
  note: string;
  version: number;
  items: Line[];
  history: { id: string; action: string; note: string; createdAt: string }[];
};
export function Transfers({ branch, branches }: { branch: string; branches: Branch[] }) {
  const me = useAccount(),
    [page, setPage] = useState(0),
    [create, setCreate] = useState(false),
    [selected, setSelected] = useState(''),
    [direction, setDirection] = useState('OUTGOING');
  const references = useData<Page<Branch>>(
    allowed(me, 'INVENTORY_TRANSFER') ? 'tenant/stock-transfer/branches?size=100' : null,
  );
  const names = [...branches, ...(references.data?.content || [])];
  const data = useData<Page<Transfer>>(
    `inventory/inventory/transfers?branchId=${branch}&page=${page}`,
  );
  return (
    <>
      <div className="panel-heading">
        <p>Stock leaves the source on dispatch and enters the destination only after receipt.</p>
        {allowed(me, 'INVENTORY_TRANSFER') && (
          <Button onClick={() => setCreate(true)}>Request transfer</Button>
        )}
      </div>
      <Issue error={data.error} loading={data.loading} />
      <div className="commercial-grid">
        {data.data?.content.map((t) => (
          <article className="operation-card" key={t.id}>
            <Badge value={t.status} />
            <h2>
              {names.find((b) => b.id === t.sourceBranchId)?.name || 'Source branch'} →{' '}
              {names.find((b) => b.id === t.destinationBranchId)?.name || 'Destination branch'}
            </h2>
            <p>{t.note}</p>
            <Button variant="outline" onClick={() => setSelected(t.id)}>
              Open transfer
            </Button>
          </article>
        ))}
      </div>
      {data.data?.content.length === 0 && <p>No transfers for this branch.</p>}
      <Paging page={page} setPage={setPage} data={data.data} />
      {selected && (
        <TransferDetail
          key={selected}
          id={selected}
          branch={branch}
          refresh={data.reload}
          onClose={() => setSelected('')}
        />
      )}
      {create && (
        <ActionForm
          title="Request branch transfer"
          onClose={() => setCreate(false)}
          submit={async (f, key) => {
            const items = [...f.getAll('partId')].map((partId, i) => ({
              partId,
              quantity: f.getAll('quantity')[i],
            }));
            await send(
              'inventory/inventory/transfers',
              {
                sourceBranchId: direction === 'OUTGOING' ? branch : f.get('otherBranchId'),
                destinationBranchId: direction === 'OUTGOING' ? f.get('otherBranchId') : branch,
                note: f.get('note'),
                items,
              },
              'POST',
              me.activeTenant!,
              key,
            );
            setCreate(false);
            data.reload();
          }}
        >
          <label>
            Transfer direction
            <select
              name="direction"
              value={direction}
              onChange={(e) => setDirection(e.target.value)}
            >
              <option value="OUTGOING">Send from acting branch</option>
              <option value="INCOMING">Request into acting branch</option>
            </select>
          </label>
          <TransferBranch
            branch={branch}
            label={direction === 'OUTGOING' ? 'Destination branch' : 'Source branch'}
          />
          <TransferLines />
          <Field name="note" label="Transfer reason" max={1000} />
        </ActionForm>
      )}
    </>
  );
}
function TransferLines() {
  const [lines, setLines] = useState([crypto.randomUUID()]);
  return (
    <>
      {lines.map((id, i) => (
        <fieldset key={id}>
          <legend>Part {i + 1}</legend>
          <PartPicker />
          <DecimalField name="quantity" label="Quantity to transfer" step="0.001" />
          {lines.length > 1 && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => setLines(lines.filter((x) => x !== id))}
            >
              Remove line
            </Button>
          )}
        </fieldset>
      ))}
      <Button
        type="button"
        variant="outline"
        disabled={lines.length >= 20}
        onClick={() => setLines([...lines, crypto.randomUUID()])}
      >
        Add transfer part
      </Button>
    </>
  );
}
function TransferDetail({
  id,
  branch,
  refresh,
  onClose,
}: {
  id: string;
  branch: string;
  refresh: () => void;
  onClose: () => void;
}) {
  const me = useAccount(),
    data = useData<Transfer>(`inventory/inventory/transfers/${id}`),
    [action, setAction] = useState(''),
    cmd = useCommand();
  const t = data.data;
  function changed() {
    data.reload();
    refresh();
    setAction('');
  }
  const source = t?.sourceBranchId === branch;
  return (
    <section className="panel operation-card">
      <div className="panel-heading">
        <h2>Transfer detail</h2>
        <Button variant="ghost" onClick={onClose}>
          Close transfer
        </Button>
      </div>
      <Issue error={data.error || cmd.error} loading={data.loading} />
      {t && (
        <>
          <Badge value={t.status} />
          <p>{t.note}</p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Part reference</th>
                  <th>Dispatched quantity</th>
                  <th>Received</th>
                  <th>Damaged / quarantined</th>
                  <th>Missing with approved evidence</th>
                </tr>
              </thead>
              <tbody>
                {t.items.map((i) => (
                  <tr key={i.partId}>
                    <td>{i.sku}<br/>{i.partName}</td>
                    <td>{i.quantity}</td>
                    <td>{i.receivedQuantity}</td>
                    <td>{i.damagedQuantity}</td>
                    <td>{i.missingQuantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {allowed(me, 'INVENTORY_TRANSFER') && (
            <div className="button-row">
              {!source && t.status === 'REQUESTED' && t.createdBy === me.user.id && (
                <Button variant="outline" onClick={() => setAction('cancel')}>
                  Withdraw request
                </Button>
              )}
              {source &&
                t.status === 'REQUESTED' &&
                ['approve', 'reject', 'cancel'].map((a) => (
                  <Button key={a} variant="outline" onClick={() => setAction(a)}>
                    {a === 'approve'
                      ? 'Approve and reserve'
                      : a === 'reject'
                        ? 'Reject request'
                        : 'Cancel request'}
                  </Button>
                ))}
              {source &&
                t.status === 'APPROVED' &&
                ['dispatch', 'cancel'].map((a) => (
                  <Button key={a} variant="outline" onClick={() => setAction(a)}>
                    {a === 'dispatch' ? 'Dispatch stock' : 'Cancel and release stock'}
                  </Button>
                ))}
              {source && t.status === 'DISPATCHED' && (
                <Button variant="outline" onClick={() => setAction('in-transit')}>
                  Mark in transit
                </Button>
              )}
              {!source && ['DISPATCHED', 'IN_TRANSIT', 'PARTIALLY_RECEIVED'].includes(t.status) && (
                <Button onClick={() => setAction('receive')}>Record receipt</Button>
              )}
            </div>
          )}
          <h3>Transfer history</h3>
          {t.history.map((h) => (
            <article key={h.id}>
              <Badge value={h.action} />
              <p>
                {h.note} · {date(h.createdAt)}
              </p>
            </article>
          ))}
          {action && (
            <ActionForm
              title={action === 'receive' ? 'Receive transferred stock' : `Transfer: ${action}`}
              onClose={() => setAction('')}
              submit={async (f, key) => {
                const body =
                  action === 'receive'
                    ? {
                        version: t.version,
                        note: f.get('note'),
                        items: t.items
                          .map((i) => ({
                            partId: i.partId,
                            quantity: f.get('qty-' + i.partId) || '0',
                            damagedQuantity: f.get('damage-' + i.partId) || '0',
                            missingQuantity: f.get('missing-' + i.partId) || '0',
                          }))
                          .filter(
                            (i) =>
                              Number(i.quantity) +
                                Number(i.damagedQuantity) +
                                Number(i.missingQuantity) >
                              0,
                          ),
                      }
                    : { version: t.version, note: f.get('note') };
                await send(
                  `inventory/inventory/transfers/${id}/${action}`,
                  body,
                  'POST',
                  me.activeTenant!,
                  key,
                );
                changed();
              }}
            >
              {action === 'receive' && (
                <>
                  <p>
                    Enter only quantities physically received now. Damaged items are recorded
                    separately and do not enter available stock. Unresolved quantities remain in
                    transit until received or explicitly approved as missing.
                  </p>
                  {t.items.map((i) => (
                    <fieldset key={i.partId}>
                      <legend>{i.sku} · {i.partName}</legend>
                      <DecimalField
                        name={'qty-' + i.partId}
                        label="Usable quantity received now"
                        value="0"
                        step="0.001"
                      />
                      {allowed(me, 'INVENTORY_ADJUST') && (
                        <>
                          <DecimalField
                            name={'missing-' + i.partId}
                            label="Missing quantity approved with receipt evidence"
                            value="0"
                            step="0.001"
                          />
                          <DecimalField
                            name={'damage-' + i.partId}
                            label="Damaged quantity reviewed and quarantined"
                            value="0"
                            step="0.001"
                          />
                        </>
                      )}
                    </fieldset>
                  ))}
                </>
              )}
              <Field name="note" label="Action / receipt evidence" max={1000} />
            </ActionForm>
          )}
        </>
      )}
    </section>
  );
}

function TransferBranch({ branch, label }: { branch: string; label: string }) {
  const [q, setQ] = useState(''),
    [page, setPage] = useState(0),
    search = useDeferredValue(q),
    data = useData<Page<Branch>>(
      `tenant/stock-transfer/branches?q=${encodeURIComponent(search)}&page=${page}`,
    );
  return (
    <fieldset>
      <legend>{label}</legend>
      <label>
        Find branch
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(0);
          }}
        />
      </label>
      <Issue error={data.error} loading={data.loading} />
      <label>
        {label}
        <select name="otherBranchId" required>
          <option value="">Choose branch</option>
          {data.data?.content
            .filter((b) => b.id !== branch)
            .map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
        </select>
      </label>
      <Paging page={page} setPage={setPage} data={data.data} />
    </fieldset>
  );
}

'use client';
import { useState } from 'react';
import { History, ShieldCheck } from 'lucide-react';
import { useData, Issue, Pager, type Page, type Branch } from './shared';
export function Timeline({ id, branches }: { id: string; branches: Branch[] }) {
  const [selected, setSelected] = useState(''),
    [page, setPage] = useState(0);
  const branch = selected || branches.find((b) => b.status === 'ACTIVE')?.id;
  const result = useData<Page>(
      branch ? `customer/vehicles/${id}/timeline?branchId=${branch}&page=${page}&size=20` : null,
    ),
    labels = useData<Branch[]>('tenant/history-branches');
  return (
    <section className="panel registry-summary">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">AUTHORIZED CROSS-BRANCH HISTORY</span>
          <h2>Service timeline</h2>
        </div>
        <ShieldCheck size={24} />
      </div>
      <p>
        Completed services across this brand. Each entry retains its source reference; viewing
        history does not grant operational access to that branch.
      </p>
      <label>
        Viewing from branch
        <select
          aria-label="Timeline branch"
          value={branch || ''}
          onChange={(e) => {
            setSelected(e.target.value);
            setPage(0);
          }}
        >
          {branches
            .filter((b) => b.status === 'ACTIVE')
            .map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
        </select>
      </label>
      <Issue error={result.error || labels.error} loading={result.loading} />
      {!branch && <p role="alert">No active authorized branch.</p>}
      <div className="registry-timeline">
        {result.data?.content.map((event) => (
          <article key={event.id}>
            <span className="green-dot" />
            <div>
              <small>
                {new Date(event.createdAt!).toLocaleDateString('en-IN')} ·{' '}
                {labels.data?.find((b) => b.id === event.branchId)?.name || 'Brand branch'}
              </small>
              <h3>{event.summary}</h3>
              <span className="tag">{event.status}</span>
 {event.odometer?.map((o,i)=><p key={i}>{o.odometerKilometers.toLocaleString()} km at intake</p>)}
 {event.completedRepairs?.map((r,i)=><p key={i}>Completed: {r.taskDescription}</p>)}
 {event.parts?.map((r,i)=><p key={i}>{r.quantity} × {r.description} · {r.status}</p>)}
 {event.technicianNotes?.map((n,i)=><p key={i}>{n.kind}: {n.note}</p>)}
 {event.recommendations?.map((r,i)=><p key={i}>Recorded recommendation · {r.category}: {r.technicianNotes} ({r.severity})</p>)}
              <p className="source-reference">
                Source: {event.source?.service} / {event.source?.resourceId}
              </p>
            </div>
          </article>
        ))}
      </div>
      {result.data && !result.data.content.length && (
        <div className="empty-state">
          <History />
          <h3>No completed service records</h3>
          <p>In-progress work orders remain in the operational workspace.</p>
        </div>
      )}
      <Pager page={page} setPage={setPage} result={result.data} />
    </section>
  );
}

'use client';
import { useState } from 'react';
import { useAccount, useData, Issue } from '../registry/shared';
import { Timeline } from '../registry/timeline';
import { send, statusLabel } from '@/lib/api';
import { allowed } from '@/lib/account';
import { Button } from '../ui/button';
import {
  type Branch,
  type Job,
  type Staff,
  type Page,
  ActionForm,
  Field,
  Priority,
  Technician,
  Badge,
  date,
  Pagination,
  useCommand,
  Can,
} from './shared';
import { InspectionPanel, QualityPanel, Photos } from './inspection';
import { JobCommercial } from '../commercial/job-commercial';
import { PartsFulfillment } from '../commercial/parts-fulfillment';
export function Jobs({ branch, board, mine }: { branch: string; board: boolean; mine: boolean }) {
  const [q, setQ] = useState(''),
    [status, setStatus] = useState(''),
    [priority, setPriority] = useState(''),
    [technician, setTechnician] = useState(''),
    [page, setPage] = useState(0);
  const staff = useData<Staff[]>('tenant/branches/' + branch + '/technicians');
  const query = new URLSearchParams({
    branchId: branch,
    q,
    status,
    priority,
    mine: String(mine),
    page: String(page),
    size: board ? '100' : '30',
  });
  if (technician) query.set('technicianId', technician);
  const data = useData<Page<Job> & { statusCounts: { status: string; count: number }[] }>(
    'workorder/work-orders' + (board ? '/board' : '') + '?' + query,
  );
  const columns = [
    'CHECKED_IN',
    'INSPECTION',
    'ESTIMATE_PENDING',
    'AWAITING_APPROVAL',
    'APPROVED',
    'IN_PROGRESS',
    'QUALITY_CHECK',
    'READY_FOR_DELIVERY',
  ];
  function card(job: Job) {
    return (
      <article className="panel operation-card" key={job.id}>
        <small className="job-number">{job.jobCardNumber}</small>
        <h3>
          <a href={'/jobs/' + job.id}>
            {job.registration || 'Vehicle'} · {job.vehicleModel}
          </a>
        </h3>
        <Badge value={job.status} />
        <Badge value={job.priority} />
        <p>{job.complaint}</p>
        <p>
          {staff.data?.find((s) => s.userId === job.assignedTechnicianId)?.displayName ||
            'Unassigned technician'}
        </p>
        <small>
          Check-in {date(job.checkInAt || job.createdAt)}
          {job.estimatedCompletionAt && <> · Due {date(job.estimatedCompletionAt)}</>}
        </small>
        <a className="button" href={'/jobs/' + job.id}>
          Open job card
        </a>
      </article>
    );
  }
  return (
    <>
      <div className="operations-tools">
        <input
          aria-label="Search jobs"
          value={q}
          placeholder="Registration, complaint or job number"
          onChange={(e) => {
            setQ(e.target.value);
            setPage(0);
          }}
        />
        <select
          aria-label="Job status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(0);
          }}
        >
          <option value="">All statuses</option>
          {['CREATED', ...columns, 'DELIVERED', 'CLOSED', 'CANCELLED'].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <select
          aria-label="Job priority"
          value={priority}
          onChange={(e) => {
            setPriority(e.target.value);
            setPage(0);
          }}
        >
          <option value="">All priorities</option>
          {['LOW', 'NORMAL', 'HIGH', 'URGENT'].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        {!mine && (
          <select
            aria-label="Filter technician"
            value={technician}
            onChange={(e) => {
              setTechnician(e.target.value);
              setPage(0);
            }}
          >
            <option value="">All technicians</option>
            {staff.data?.map((s) => (
              <option key={s.userId} value={s.userId}>
                {s.displayName}
              </option>
            ))}
          </select>
        )}
        <Can permission="WORKORDER_CREATE">
          <a className="button" href="/check-in">
            Create job card / walk-in
          </a>
        </Can>
      </div>
      <Issue error={data.error || staff.error} loading={data.loading} />
      <div className="operations-counts">
        {data.data?.statusCounts.map((s) => (
          <span key={s.status}>
            {statusLabel(s.status)} <strong>{s.count}</strong>
          </span>
        ))}
      </div>
      {board ? (
        <div className="job-board">
          {columns.map((c) => (
            <section key={c}>
              <h2>
                {statusLabel(c)}{' '}
                <small>{data.data?.statusCounts.find((s) => s.status === c)?.count || 0}</small>
              </h2>
              {data.data?.content.filter((j) => j.status === c).map(card)}
            </section>
          ))}
        </div>
      ) : (
        <div className="operations-list">{data.data?.content.map(card)}</div>
      )}
      {data.data && !data.data.content.length && <p>No jobs match your branch and filters.</p>}
      <Pagination page={page} setPage={setPage} result={data.data} />
      {board && (
        <p className="muted">
          Board pages contain up to 100 matching jobs. Open a card for authorized transitions.
        </p>
      )}
    </>
  );
}
export function JobDetail({ id, branches }: { id: string; branches: Branch[] }) {
  const me = useAccount(),
    data = useData<Job>('workorder/work-orders/' + id),
    job = data.data,
    staff = useData<Staff[]>(job ? 'tenant/branches/' + job.branchId + '/technicians' : null),
    [tab, setTab] = useState('details'),
    [form, setForm] = useState(''),
    command = useCommand();
  const can = (p: string) => allowed(me, p);
  async function submit(f: FormData, key: string) {
    if (!job) return;
    let path = 'workorder/work-orders/' + id + '/' + form,
      method = 'POST',
      body: unknown = {};
    if (form === 'assign')
      body = { technicianId: f.get('technicianId'), version: job.version, reason: f.get('reason') };
    if (form === 'tasks')
      body = {
        taskDescription: f.get('taskDescription'),
        taskCategory: f.get('taskCategory'),
        priority: f.get('priority'),
        estimatedDurationMinutes: Number(f.get('estimatedDurationMinutes')),
        assignedTechnicianId: f.get('technicianId') || null,
      };
    if (form === 'notes') body = { kind: f.get('kind'), note: f.get('note') };
    if (form === 'parts') body = { description: f.get('description'), quantity: f.get('quantity') };
    if (form === 'development-approval')
      body = { version: job.version, decision: f.get('decision'), reason: f.get('reason') };
    if (form === 'edit') {
      path = 'workorder/work-orders/' + id;
      method = 'PATCH';
      body = { version: job.version, complaint: f.get('complaint'), priority: f.get('priority') };
    }
    if (form === 'transition')
      body = { version: job.version, status: f.get('status'), note: f.get('note') };
    await send(path, body, method, me.activeTenant!, key);
    setForm('');
    data.reload();
  }
  if (!job) return <Issue error={data.error} loading={data.loading} />;
  const manager = can('WORKORDER_ASSIGN'),
    editable =
      can('WORKORDER_UPDATE') &&
      (manager || job.assignedTechnicianId === me.user.id) &&
      !['DELIVERED', 'CLOSED', 'CANCELLED'].includes(job.status);
  const transitions: Record<string, string[]> = {
    CREATED: ['CHECKED_IN', 'CANCELLED'],
    CHECKED_IN: ['INSPECTION', 'CANCELLED'],
    INSPECTION: ['ESTIMATE_PENDING', 'CANCELLED'],
    ESTIMATE_PENDING: ['AWAITING_APPROVAL', 'INSPECTION', 'CANCELLED'],
    AWAITING_APPROVAL: ['ESTIMATE_PENDING', 'CANCELLED'],
    APPROVED: ['IN_PROGRESS', 'CANCELLED'],
    READY_FOR_DELIVERY: ['DELIVERED'],
    DELIVERED: ['CLOSED'],
  };
  return (
    <>
      <Issue error={command.error || staff.error || data.error} loading={data.loading} />
      <section className="panel operation-card">
        <small className="job-number">{job.jobCardNumber}</small>
        <h2>
          {job.registration} · {job.vehicleModel}
        </h2>
        <p>Branch: {branches.find((b) => b.id === job.branchId)?.name || 'Authorized branch'}</p>
        <Badge value={job.status} />
        <Badge value={job.priority} />
        <p>{job.complaint}</p>
        <p>
          Technician:{' '}
          {staff.data?.find((s) => s.userId === job.assignedTechnicianId)?.displayName ||
            'Unassigned'}{' '}
          · Checked in {date(job.checkInAt || job.createdAt)}
        </p>
        {job.developmentApprovalId && (
          <p className="notice">
            DEVELOPMENT SIMULATION: estimate approval was recorded locally. This is not a financial
            approval from Billing.
          </p>
        )}
        <div className="operations-tools">
          {manager && editable && (
            <>
              <Button onClick={() => setForm('assign')}>Assign technician</Button>
              <Button variant="outline" onClick={() => setForm('edit')}>
                Edit job details
              </Button>
            </>
          )}
          {(editable || (job.status === 'DELIVERED' && manager)) &&
            transitions[job.status]?.length && (
              <Button onClick={() => setForm('transition')}>Change job status</Button>
            )}
          {job.status === 'AWAITING_APPROVAL' &&
            job.developmentApprovalAvailable &&
            can('WORKORDER_DEV_APPROVAL') && (
              <Button variant="outline" onClick={() => setForm('development-approval')}>
                Development approval simulation
              </Button>
            )}
        </div>
      </section>
      <JobCommercial job={job} refresh={data.reload} />
      <nav className="operations-tabs" aria-label="Job sections">
        {['details', 'tasks', 'inspection', 'photos', 'quality', 'history', 'audit'].map((t) => (
          <Button key={t} variant={tab === t ? 'default' : 'outline'} onClick={() => setTab(t)}>
            {statusLabel(t)}
          </Button>
        ))}
      </nav>
      {tab === 'details' && (
        <div className="operations-list">
          <section className="panel operation-card">
            <h2>Technician notes</h2>
            {job.notes.map((n) => (
              <article key={n.id}>
                <Badge value={n.kind} />
                <p>{n.note}</p>
              </article>
            ))}
            {editable && (
              <Button onClick={() => setForm('notes')}>Add note or additional work</Button>
            )}
          </section>
          <section className="panel operation-card">
            <h2>Required parts</h2>
            {job.parts.map((p) => (
              <div key={p.id}>
                <p>
                  {p.quantity} × {p.description} <Badge value={p.status} />
                </p>
                {editable && p.status === 'REQUESTED' && manager && (
                  <Button
                    variant="outline"
                    disabled={command.busy}
                    onClick={() =>
                      command.run(
                        'workorder/work-orders/' + id + '/parts/' + p.id,
                        {
                          version: p.version,
                          status: 'RECEIVED',
                          note: 'Workshop recorded parts receipt',
                        },
                        data.reload,
                        'PATCH',
                      )
                    }
                  >
                    Record received
                  </Button>
                )}
                {editable &&
                  !job.commercialEstimateId &&
                  p.status === 'RECEIVED' &&
                  job.status === 'IN_PROGRESS' && (
                    <Button
                      variant="outline"
                      disabled={command.busy}
                      onClick={() =>
                        command.run(
                          'workorder/work-orders/' + id + '/parts/' + p.id,
                          {
                            version: p.version,
                            status: 'USED',
                            note: 'Workshop recorded parts used',
                          },
                          data.reload,
                          'PATCH',
                        )
                      }
                    >
                      Record used
                    </Button>
                  )}
                {job.commercialEstimateId && editable && p.status !== 'CANCELLED' && (
                  <PartsFulfillment job={job} request={p} refresh={data.reload} />
                )}
              </div>
            ))}
            {editable && <Button onClick={() => setForm('parts')}>Request parts</Button>}
          </section>
        </div>
      )}
      {tab === 'tasks' && (
        <section className="panel operation-card">
          <div className="panel-heading">
            <h2>Repair tasks</h2>
            {manager && editable && (
              <Button onClick={() => setForm('tasks')}>Add repair task</Button>
            )}
          </div>
          {job.tasks.map((task) => (
            <article className="repair-task" key={task.id}>
              <h3>{task.taskDescription}</h3>
              <Badge value={task.status} />
              <Badge value={task.priority} />
              <p>
                {task.estimatedDurationMinutes} min estimated · {task.actualDurationMinutes ?? '—'}{' '}
                min recorded ·{' '}
                {staff.data?.find((s) => s.userId === task.assignedTechnicianId)?.displayName ||
                  'Unassigned'}
              </p>
              {editable &&
                (manager || task.assignedTechnicianId === me.user.id) &&
                !['COMPLETED', 'CANCELLED'].includes(task.status) && (
                  <TaskEditor
                    job={job}
                    taskId={task.id}
                    staff={staff.data || []}
                    reload={data.reload}
                  />
                )}
            </article>
          ))}
          {!job.tasks.length && <p>No repair tasks yet.</p>}
        </section>
      )}
      {tab === 'inspection' && (
        <InspectionPanel job={job} editable={editable} reload={data.reload} />
      )}{' '}
      {tab === 'photos' && <Photos job={job} editable={editable} reload={data.reload} />}{' '}
      {tab === 'quality' && (
        <QualityPanel job={job} staff={staff.data || []} editable={editable} reload={data.reload} />
      )}{' '}
      {tab === 'history' && <Timeline id={job.vehicleId} branches={branches} />}{' '}
      {tab === 'audit' && (
        <section className="panel operation-card">
          <h2>Status history</h2>
          {job.statusHistory.map((h) => (
            <article key={h.id}>
              <p>
                {h.fromStatus || 'Created'} → {h.toStatus} · {date(h.createdAt)}
              </p>
              <p>{h.note}</p>
            </article>
          ))}
        </section>
      )}
      {form && (
        <ActionForm title={statusLabel(form)} onClose={() => setForm('')} submit={submit}>
          {form === 'assign' && (
            <>
              <Technician staff={staff.data || []} />
              <Field name="reason" label="Assignment reason" max={1000} />
            </>
          )}
          {form === 'edit' && (
            <>
              <Field name="complaint" label="Complaint summary" value={job.complaint} />
              <Priority value={job.priority} />
            </>
          )}
          {form === 'transition' && (
            <>
              <label>
                Next status
                <select name="status">
                  {transitions[job.status]
                    ?.filter((s) => manager || !['DELIVERED', 'CLOSED', 'CANCELLED'].includes(s))
                    .map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                </select>
              </label>
              <Field name="note" label="Reason / status notes" max={1000} />
            </>
          )}
          {form === 'tasks' && (
            <>
              <Field name="taskDescription" label="Task description" max={1000} />
              <Field name="taskCategory" label="Task category" max={80} />
              <Priority />
              <Field
                name="estimatedDurationMinutes"
                type="number"
                label="Estimated minutes"
                value={60}
              />
              <Technician staff={staff.data || []} required={false} />
            </>
          )}
          {form === 'notes' && (
            <>
              <label>
                Note type
                <select name="kind">
                  <option>TECHNICIAN</option>
                  <option>INSPECTION</option>
                  <option>ADDITIONAL_WORK</option>
                </select>
              </label>
              <Field name="note" type="textarea" label="Notes" />
            </>
          )}
          {form === 'parts' && (
            <>
              <Field name="description" label="Part description" max={300} />
              <label>
                Quantity
                <input
                  name="quantity"
                  type="number"
                  step="0.001"
                  min="0.001"
                  max="10000"
                  defaultValue="1"
                  required
                />
              </label>
            </>
          )}
          {form === 'development-approval' && (
            <>
              <p className="notice">
                Local development simulation only. Customer financial approval is managed in
                Estimates.
              </p>
              <label>
                Decision
                <select name="decision">
                  <option>APPROVE</option>
                  <option>REJECT</option>
                  <option>REVISE</option>
                </select>
              </label>
              <Field name="reason" label="Manager reason (at least 10 characters)" max={1000} />
            </>
          )}
        </ActionForm>
      )}
    </>
  );
}
function TaskEditor({
  job,
  taskId,
  staff,
  reload,
}: {
  job: Job;
  taskId: string;
  staff: Staff[];
  reload: () => void;
}) {
  const task = job.tasks.find((t) => t.id === taskId)!,
    me = useAccount(),
    command = useCommand();
  return (
    <form
      className="operations-tools"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        command.run(
          'workorder/work-orders/' + job.id + '/tasks/' + task.id,
          {
            version: task.version,
            status: f.get('status'),
            note: f.get('note'),
            ...(allowed(me, 'WORKORDER_ASSIGN')
              ? { priority: f.get('priority'), assignedTechnicianId: f.get('technicianId') || null }
              : {}),
          },
          reload,
          'PATCH',
        );
      }}
    >
      <label>
        Task status
        <select name="status" aria-label="Task status" defaultValue={task.status}>
          {['TODO', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'CANCELLED'].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </label>
      {allowed(me, 'WORKORDER_ASSIGN') && (
        <>
          <Priority value={task.priority} />
          <Technician staff={staff} required={false} />
        </>
      )}
      <Field name="note" label="Update reason" max={1000} />
      <Button disabled={command.busy}>Update task</Button>
      <Issue error={command.error} />
    </form>
  );
}
export function Workload({ branch }: { branch: string }) {
  const me = useAccount(),
    data = useData<Staff[]>('workorder/technicians/workload?branchId=' + branch),
    [member, setMember] = useState<Staff | null>(null),
    [unavailable, setUnavailable] = useState<Staff | null>(null);
  return (
    <>
      <Issue error={data.error} loading={data.loading} />
      <div className="operations-list">
        {data.data?.map((s) => (
          <section className="panel operation-card" key={s.userId}>
            <h2>{s.displayName}</h2>
            <Badge value={s.available ? 'AVAILABLE' : 'UNAVAILABLE'} />
            <p>
              {s.activeJobs} active jobs · {s.estimatedRemainingMinutes} min estimated remaining
            </p>
            <p>
              QC attestation: {s.qualityReview ? 'recorded' : 'not recorded'} · Safety finding
              review: {s.safetyReview ? 'recorded' : 'not recorded'}
            </p>
            <div className="operations-counts">
              {['TODO', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED'].map((state) => (
                <span key={state}>
                  {statusLabel(state)}{' '}
                  <strong>{s.taskStatusCounts?.find((c) => c.status === state)?.count || 0}</strong>
                </span>
              ))}
            </div>
            {s.tasks.slice(0, 20).map((t) => (
              <p key={t.id}>
                {t.taskDescription} <Badge value={t.priority} /> <Badge value={t.status} />
              </p>
            ))}
            {allowed(me, 'WORKORDER_ASSIGN') && (
              <Button variant="outline" onClick={() => setUnavailable(s)}>
                Record unavailability
              </Button>
            )}
            {allowed(me, 'STAFF_ASSIGN_ROLE') && s.userId !== me.user.id && (
              <Button variant="outline" onClick={() => setMember(s)}>
                Attest qualification
              </Button>
            )}
          </section>
        ))}
      </div>
      {unavailable && (
        <ActionForm
          title={'Unavailability: ' + unavailable.displayName}
          onClose={() => setUnavailable(null)}
          submit={async (f, key) => {
            await send(
              'tenant/tenants/' +
                me.activeTenant +
                '/staff/' +
                unavailable.membershipId +
                '/unavailability',
              {
                branchId: branch,
                startsAt: new Date(String(f.get('startsAt'))).toISOString(),
                endsAt: new Date(String(f.get('endsAt'))).toISOString(),
                reason: f.get('reason'),
              },
              'POST',
              me.activeTenant!,
              key,
            );
            setUnavailable(null);
            data.reload();
          }}
        >
          <p>Times use your device timezone: {Intl.DateTimeFormat().resolvedOptions().timeZone}.</p>
          <Field name="startsAt" type="datetime-local" label="Unavailable from" />
          <Field name="endsAt" type="datetime-local" label="Unavailable until" />
          <Field name="reason" label="Unavailability reason" max={300} />
        </ActionForm>
      )}
      {member && (
        <ActionForm
          title={'Qualification: ' + member.displayName}
          onClose={() => setMember(null)}
          submit={async (f, key) => {
            await send(
              'tenant/tenants/' +
                me.activeTenant +
                '/staff/' +
                member.membershipId +
                '/capabilities',
              {
                branchId: branch,
                qualityReview: f.get('quality') === 'on',
                safetyReview: f.get('safety') === 'on',
                attestation: f.get('attestation'),
                version: member.capabilityVersion,
              },
              'PATCH',
              me.activeTenant!,
              key,
            );
            setMember(null);
            data.reload();
          }}
        >
          <p>
            A manager records staff competence and review authority. This does not certify vehicle
            roadworthiness.
          </p>
          <label>
            <input type="checkbox" name="quality" defaultChecked={member.qualityReview} />
            Quality reviewer
          </label>
          <label>
            <input type="checkbox" name="safety" defaultChecked={member.safetyReview} />
            Safety finding reviewer (also requires QC)
          </label>
          <Field
            name="attestation"
            label="Competence review / qualification basis"
            type="textarea"
            max={1000}
          />
        </ActionForm>
      )}
    </>
  );
}

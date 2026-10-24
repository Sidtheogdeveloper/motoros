'use client';
import { useState } from 'react';
import { useAccount, useData, Issue } from '../registry/shared';
import { allowed } from '@/lib/account';
import { send } from '@/lib/api';
import { Button } from '../ui/button';
import {
  type Job,
  type Staff,
  type Inspection,
  type Finding,
  ActionForm,
  Field,
  Badge,
  date,
  useCommand,
} from './shared';
export function InspectionPanel({
  job,
  editable,
  reload,
}: {
  job: Job;
  editable: boolean;
  reload: () => void;
}) {
  const me = useAccount(),
    command = useCommand(),
    templates = useData<{ id: string; name: string }[]>('workorder/inspection-templates'),
    data = useData<Inspection[]>('workorder/work-orders/' + job.id + '/inspections'),
    [selected, setSelected] = useState('');
  const active = data.data?.find((i) => i.id === selected) || data.data?.at(-1);
  return (
    <section className="panel operation-card">
      <h2>Digital vehicle inspection</h2>
      <p className="notice">
        Workshop observations require staff judgment. This checklist is not a certified safety
        inspection.
      </p>
      <Issue error={data.error || templates.error || command.error} loading={data.loading} />
      {job.status === 'INSPECTION' &&
        editable &&
        !data.data?.some((i) => i.status !== 'COMPLETED') && (
          <form
            className="operations-tools"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              command.run<Inspection>(
                'workorder/work-orders/' + job.id + '/inspections',
                { templateId: f.get('templateId') || templates.data?.[0]?.id },
                (i) => {
                  setSelected(i.id);
                  data.reload();
                  reload();
                },
              );
            }}
          >
            <label>
              Inspection template
              <select name="templateId">
                {templates.data?.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <Button disabled={command.busy || !templates.data?.length || !data.data}>
              Start inspection
            </Button>
          </form>
        )}
      {!!data.data?.length && (
        <label>
          Inspection record
          <select value={active?.id || ''} onChange={(e) => setSelected(e.target.value)}>
            {data.data.map((i) => (
              <option key={i.id} value={i.id}>
                {i.id.slice(0, 8)} · {i.status}
              </option>
            ))}
          </select>
        </label>
      )}
      {active && (
        <Checklist
          key={active.id + ':' + active.version}
          inspection={active}
          job={job}
          editable={editable}
          reload={() => {
            data.reload();
            reload();
          }}
        />
      )}
    </section>
  );
}
function Checklist({
  inspection,
  job,
  editable,
  reload,
}: {
  inspection: Inspection;
  job: Job;
  editable: boolean;
  reload: () => void;
}) {
  const me = useAccount(),
    command = useCommand(),
    [findings, setFindings] = useState(inspection.findings),
    [notes, setNotes] = useState('');
  const canEdit = editable && inspection.status === 'DRAFT' && job.status === 'INSPECTION';
  function update(id: string, patch: Partial<Finding>) {
    setFindings((f) => f.map((item) => (item.itemId === id ? { ...item, ...patch } : item)));
  }
  const categories = Array.from(new Set(findings.map((f) => f.category)));
  return (
    <>
      <Badge value={inspection.status} />
      <div className="inspection-progress">
        {categories.map((c) => (
          <span key={c}>
            {c} {findings.filter((f) => f.category === c && f.condition !== 'NOT_INSPECTED').length}
            /{findings.filter((f) => f.category === c).length}
          </span>
        ))}
      </div>
      <Issue error={command.error} />
      {findings.map((f) => (
        <article className="inspection-item" key={f.itemId}>
          <h3>
            {f.category}
            {f.safetyRelated ? ' · safety-related observations' : ''}
          </h3>
          <p>{f.inspectionItem}</p>
          <label>
            Condition
            <select
              aria-label={f.category + ' condition'}
              disabled={!canEdit}
              value={f.condition}
              onChange={(e) => update(f.itemId, { condition: e.target.value })}
            >
              {['GOOD', 'ATTENTION_REQUIRED', 'NOT_INSPECTED', 'NOT_APPLICABLE'].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label>
            Severity
            <select
              disabled={!canEdit}
              value={f.severity}
              onChange={(e) => update(f.itemId, { severity: e.target.value })}
            >
              {['LOW', 'MEDIUM', 'HIGH'].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label>
            Technician notes
            <textarea
              aria-label={f.category + ' notes'}
              maxLength={2000}
              disabled={!canEdit}
              value={f.technicianNotes}
              onChange={(e) => update(f.itemId, { technicianNotes: e.target.value })}
            />
          </label>
          <label>
            Attached photos
            <select
              multiple
              aria-label={f.category + ' photos'}
              disabled={!canEdit}
              value={f.photoReferences}
              onChange={(e) =>
                update(f.itemId, {
                  photoReferences: Array.from(e.target.selectedOptions, (o) => o.value),
                })
              }
            >
              {job.photos
                .filter((p) => p.status === 'AVAILABLE')
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label} · {p.fileName}
                  </option>
                ))}
            </select>
          </label>
        </article>
      ))}
      <div className="operations-tools">
        {canEdit && (
          <Button
            disabled={command.busy}
            onClick={() =>
              command.run(
                'workorder/inspections/' + inspection.id,
                {
                  version: inspection.version,
                  findings: findings.map(
                    ({ itemId, condition, technicianNotes, severity, photoReferences }) => ({
                      itemId,
                      condition,
                      technicianNotes,
                      severity,
                      photoReferences,
                    }),
                  ),
                },
                reload,
                'PATCH',
              )
            }
          >
            Save checklist
          </Button>
        )}
        {inspection.status === 'DRAFT' && editable && (
          <Button
            disabled={command.busy}
            onClick={() =>
              command.run(
                'workorder/inspections/' + inspection.id + '/complete',
                { version: inspection.version },
                reload,
              )
            }
          >
            Complete saved inspection
          </Button>
        )}
        {inspection.status === 'REVIEW_REQUIRED' && allowed(me, 'WORKORDER_INSPECTION_REVIEW') && (
          <>
            <label>
              Qualified reviewer notes
              <textarea
                value={notes}
                minLength={10}
                maxLength={1000}
                onChange={(e) => setNotes(e.target.value)}
              />
            </label>
            <Button
              disabled={command.busy || notes.length < 10}
              onClick={() =>
                command.run(
                  'workorder/inspections/' + inspection.id + '/complete',
                  { version: inspection.version, reviewNotes: notes },
                  reload,
                )
              }
            >
              Record qualified review
            </Button>
          </>
        )}
      </div>
      <h3>Recommended work</h3>
      {findings
        .filter((f) => f.condition === 'ATTENTION_REQUIRED')
        .map((f) => (
          <p key={f.itemId}>
            {f.category}: {f.technicianNotes} · {f.severity}
          </p>
        ))}
      <p className="muted">
        Save observations before completing. Safety-related attention findings and high-severity
        findings require a separate qualified staff review.
      </p>
    </>
  );
}
export function QualityPanel({
  job,
  staff,
  editable,
  reload,
}: {
  job: Job;
  staff: Staff[];
  editable: boolean;
  reload: () => void;
}) {
  const me = useAccount(),
    command = useCommand(),
    [form, setForm] = useState<'request' | 'approve' | 'reject' | null>(null);
  const pending = job.qualityChecks.find((q) => q.status === 'PENDING');
  async function submit(f: FormData) {
    let body: unknown;
    const path = 'workorder/work-orders/' + job.id + '/quality-check';
    if (form === 'request') body = { version: job.version, reviewerId: f.get('reviewerId') };
    else
      body = {
        version: pending?.version,
        checklist: {
          repairsVerified: f.get('repairsVerified') === 'on',
          findingsReviewed: f.get('findingsReviewed') === 'on',
          belongingsVerified: f.get('belongingsVerified') === 'on',
        },
        notes: f.get('notes'),
      };
    await send(path + (form === 'request' ? '' : '/' + form), body, 'POST', me.activeTenant!);
    setForm(null);
    reload();
  }
  return (
    <section className="panel operation-card">
      <h2>Quality control</h2>
      <p>
        Document the review before delivery. A separate repair reviewer is required unless branch
        policy explicitly permits otherwise.
      </p>
      <Issue error={command.error} />
      {job.status === 'IN_PROGRESS' && editable && (
        <Button onClick={() => setForm('request')}>Submit for quality check</Button>
      )}
      {pending && (
        <p>
          Assigned reviewer:{' '}
          {staff.find((s) => s.userId === pending.reviewerId)?.displayName || pending.reviewerId}
        </p>
      )}
      {pending?.reviewerId === me.user.id && allowed(me, 'WORKORDER_QUALITY_CHECK') && (
        <div className="operations-tools">
          <Button onClick={() => setForm('approve')}>Approve quality check</Button>
          <Button variant="outline" onClick={() => setForm('reject')}>
            Return for rework
          </Button>
        </div>
      )}
      {job.qualityChecks.map((q) => (
        <article className="repair-task" key={q.id}>
          <Badge value={q.status} />
          <p>{q.reviewerNotes}</p>
          <small>{date(q.reviewedAt)}</small>
        </article>
      ))}
      {form && (
        <ActionForm
          title={
            form === 'request'
              ? 'Assign quality reviewer'
              : form === 'approve'
                ? 'Quality sign-off'
                : 'Request rework'
          }
          submit={submit}
          onClose={() => setForm(null)}
        >
          {form === 'request' ? (
            <label>
              Qualified reviewer
              <select name="reviewerId" aria-label="Qualified reviewer" required>
                <option value="">Choose reviewer</option>
                {staff
                  .filter((s) => s.qualityReview && s.available)
                  .map((s) => (
                    <option key={s.userId} value={s.userId}>
                      {s.displayName}
                    </option>
                  ))}
              </select>
            </label>
          ) : (
            <>
              <label>
                <input type="checkbox" name="repairsVerified" required={form === 'approve'} />
                Completed repairs verified
              </label>
              <label>
                <input type="checkbox" name="findingsReviewed" required={form === 'approve'} />
                Inspection findings reviewed
              </label>
              <label>
                <input type="checkbox" name="belongingsVerified" required={form === 'approve'} />
                Accessories and belongings verified
              </label>
              <Field
                name="notes"
                label="Reviewer notes / rework reason (minimum 10 characters)"
                type="textarea"
              />
            </>
          )}
        </ActionForm>
      )}
    </section>
  );
}
export function Photos({
  job,
  editable,
  reload,
}: {
  job: Job;
  editable: boolean;
  reload: () => void;
}) {
  const me = useAccount(),
    command = useCommand(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [key, setKey] = useState(() => crypto.randomUUID());
  async function upload(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const form = e.currentTarget,
      f = new FormData(form),
      file = f.get('file') as File;
    try {
      if (file.size < 1 || file.size > 10485760 || !['image/png', 'image/jpeg'].includes(file.type))
        throw new Error('Choose a PNG or JPEG up to 10 MB');
      const hash = Array.from(
        new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())),
        (b) => b.toString(16).padStart(2, '0'),
      ).join('');
      const grant = await send<{ url: string; headers: Record<string, string>; photoId: string }>(
        'workorder/work-orders/' + job.id + '/photos',
        {
          label: f.get('label'),
          fileName: file.name,
          contentType: file.type,
          byteSize: file.size,
          sha256: hash,
        },
        'POST',
        me.activeTenant!,
        key,
      );
      const put = await fetch(grant.url, {
        method: 'PUT',
        headers: grant.headers,
        body: file,
        credentials: 'omit',
      });
      if (!put.ok) throw new Error('Object upload failed; retry this file');
      await send(
        'workorder/work-orders/' + job.id + '/photos/' + grant.photoId + '/complete',
        { version: 0 },
        'POST',
        me.activeTenant!,
      );
      setKey(crypto.randomUUID());
      form.reset();
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Photo upload failed');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel operation-card">
      <h2>Private intake and repair photos</h2>
      <Issue error={error || command.error} />
      {editable && allowed(me, 'WORKORDER_PHOTO_WRITE') && (
        <form className="operations-tools" onSubmit={upload}>
          <label>
            Photo view
            <select name="label">
              {[
                'FRONT',
                'REAR',
                'LEFT',
                'RIGHT',
                'DASHBOARD',
                'DAMAGE',
                'COMPLAINT',
                'INSPECTION',
                'REPAIR',
              ].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label>
            PNG or JPEG (maximum 10 MB)
            <input name="file" type="file" accept="image/png,image/jpeg" required />
          </label>
          <Button disabled={busy}>{busy ? 'Uploading…' : 'Upload private photo'}</Button>
        </form>
      )}
      <div className="operations-list">
        {job.photos
          .filter((p) => p.status === 'AVAILABLE')
          .map((p) => (
            <article key={p.id}>
              <h3>{p.label}</h3>
              <p>{p.fileName}</p>
              <Button
                variant="outline"
                disabled={command.busy}
                onClick={() =>
                  command.run<{ url: string }>(
                    'workorder/work-orders/' + job.id + '/photos/' + p.id + '/download',
                    undefined,
                    (v) => {
                      window.location.assign(v.url);
                    },
                    'GET',
                  )
                }
              >
                View authorized photo
              </Button>
            </article>
          ))}
      </div>
      <p className="muted">
        Download authorization expires after 60 seconds. Stored objects remain private.
      </p>
    </section>
  );
}

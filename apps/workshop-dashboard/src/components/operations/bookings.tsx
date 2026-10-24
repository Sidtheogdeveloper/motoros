'use client';
import { useState } from 'react';
import { useAccount, useData, Issue } from '../registry/shared';
import { send, statusLabel } from '@/lib/api';
import { allowed } from '@/lib/account';
import { Button } from '../ui/button';
import {
  type Branch,
  type Staff,
  type Appointment,
  type Page,
  ActionForm,
  Field,
  Lookup,
  Can,
  Badge,
  date,
  Pagination,
  useCommand,
} from './shared';
export function branchInstant(value: string, zone: string) {
  const desired = new Date(value + 'Z');
  let guess = desired.getTime();
  for (let n = 0; n < 3; n++) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(guess));
    const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
    const local = Date.UTC(
      Number(p.year),
      Number(p.month) - 1,
      Number(p.day),
      Number(p.hour),
      Number(p.minute),
      Number(p.second),
    );
    guess += desired.getTime() - local;
  }
  if (!Number.isFinite(guess)) throw new Error('Invalid appointment time');
  return new Date(guess).toISOString();
}
function localInput(value: string, zone: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(value))
      .map((p) => [p.type, p.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
export function Bookings({ branch }: { branch: Branch }) {
  const [q, setQ] = useState(''),
    [status, setStatus] = useState(''),
    [today, setToday] = useState(false),
    [calendar, setCalendar] = useState(false),
    [day, setDay] = useState(() => new Date().toISOString().slice(0, 10)),
    [page, setPage] = useState(0),
    [form, setForm] = useState<'new' | Appointment | null>(null),
    [detail, setDetail] = useState<Appointment | null>(null);
  const me = useAccount(),
    command = useCommand(),
    categories = useData<{ id: string; name: string; defaultDurationMinutes: number }[]>(
      'booking/service-categories',
    ),
    [category, setCategory] = useState('');
  const query = new URLSearchParams({
    branchId: branch.id,
    q,
    status,
    page: String(page),
    size: '30',
    today: String(today),
  });
  if (category) query.set('serviceCategoryId', category);
  if (calendar) {
    query.set('from', branchInstant(day + 'T00:00', branch.timezone));
    const next = new Date(day + 'T00:00:00Z');
    next.setUTCDate(next.getUTCDate() + 1);
    query.set('until', branchInstant(next.toISOString().slice(0, 10) + 'T00:00', branch.timezone));
  }
  const staff = useData<Staff[]>('tenant/branches/' + branch.id + '/technicians');
  const bookings = useData<Page<Appointment>>('booking/appointments?' + query);
  async function submit(f: FormData, key: string) {
    const existing = form && form !== 'new' ? form : null;
    const body = {
      branchId: branch.id,
      customerId: existing?.customerId || String(f.get('customerId')),
      vehicleId: existing?.vehicleId || String(f.get('vehicleId')),
      serviceCategoryId: String(f.get('serviceCategoryId')),
      requestedStartTime: branchInstant(String(f.get('requestedStartTime')), branch.timezone),
      estimatedDurationMinutes: Number(f.get('estimatedDurationMinutes')),
      customerComplaint: String(f.get('customerComplaint')),
      bookingSource: existing?.bookingSource || String(f.get('bookingSource')),
      assignedTechnicianId: f.get('assignedTechnicianId') || null,
      version: existing?.version,
    };
    await send(
      'booking/appointments' + (existing ? '/' + existing.id + '/reschedule' : ''),
      body,
      'POST',
      me.activeTenant!,
      key,
    );
    setForm(null);
    setDetail(null);
    bookings.reload();
  }
  function action(a: Appointment, next: string) {
    command.run<Appointment>(
      'booking/appointments/' + a.id + '/' + next,
      { version: a.version, note: 'Staff ' + next + ' appointment' },
      (v) => {
        setDetail(v);
        bookings.reload();
      },
    );
  }
  return (
    <>
      <div className="operations-tools">
        <input
          aria-label="Search appointments"
          placeholder="Registration or customer"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(0);
          }}
        />
        <select
          aria-label="Appointment status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(0);
          }}
        >
          <option value="">All statuses</option>
          {['REQUESTED', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED', 'NO_SHOW'].map(
            (s) => (
              <option key={s}>{s}</option>
            ),
          )}
        </select>
        <select
          aria-label="Service category filter"
          value={category}
          onChange={(e) => {
            setCategory(e.target.value);
            setPage(0);
          }}
        >
          <option value="">All categories</option>
          {categories.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <label>
          <input
            type="checkbox"
            checked={today}
            onChange={(e) => {
              setToday(e.target.checked);
              setCalendar(false);
              setPage(0);
            }}
          />
          Today
        </label>
        <Button
          variant="outline"
          onClick={() => {
            setCalendar(!calendar);
            setToday(false);
            setPage(0);
          }}
        >
          {calendar ? 'List view' : 'Day calendar'}
        </Button>
        {calendar && (
          <input
            aria-label="Calendar day"
            type="date"
            value={day}
            onChange={(e) => {
              setDay(e.target.value);
              setPage(0);
            }}
          />
        )}
        <Can permission="BOOKING_WRITE">
          <Button onClick={() => setForm('new')}>New appointment</Button>
          <a className="button" href="/check-in">
            Walk-in intake
          </a>
        </Can>
      </div>
      <p className="muted">
        Times shown in {branch.timezone}. Capacity is revalidated when saving.
      </p>
      <Issue
        error={bookings.error || categories.error || command.error}
        loading={bookings.loading}
      />
      <div className={calendar ? 'appointment-calendar' : 'operations-list'}>
        {bookings.data?.content.map((a) => (
          <article className="panel operation-card" key={a.id}>
            <time>
              {date(a.requestedStartTime, branch.timezone)} →{' '}
              {date(a.expectedEndTime, branch.timezone)}
            </time>
            <h2>
              {a.registration} · {a.customerName}
            </h2>
            <Badge value={a.appointmentStatus} />
            <p>{a.customerComplaint}</p>
            {a.checkInState && a.checkInState !== 'COMPLETE' && (
              <p className="notice">
                Intake {a.checkInState}: reopen and reconcile the saved request.
              </p>
            )}
            <Button variant="outline" onClick={() => setDetail(a)}>
              Booking detail
            </Button>
          </article>
        ))}
      </div>
      {bookings.data && !bookings.data.content.length && (
        <p>No appointments match these filters.</p>
      )}
      <Pagination page={page} setPage={setPage} result={bookings.data} />
      {form && (
        <ActionForm
          title={form === 'new' ? 'New appointment' : 'Reschedule appointment'}
          onClose={() => setForm(null)}
          submit={submit}
        >
          {form === 'new' ? (
            <>
              <Lookup kind="customers" onSelect={() => {}} />
              <Lookup kind="vehicles" onSelect={() => {}} />
              <label>
                Booking source
                <select name="bookingSource">
                  <option>STAFF</option>
                  <option>PHONE</option>
                  <option>WALK_IN</option>
                </select>
              </label>
            </>
          ) : (
            <p>
              {form.registration} · {form.customerName}
            </p>
          )}
          <label>
            Service category
            <select
              name="serviceCategoryId"
              required
              defaultValue={form === 'new' ? categories.data?.[0]?.id : form.serviceCategoryId}
            >
              {categories.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · suggested {c.defaultDurationMinutes} min
                </option>
              ))}
            </select>
          </label>
          <label>
            Specific technician (optional)
            <select
              name="assignedTechnicianId"
              defaultValue={form === 'new' ? '' : form.assignedTechnicianId || ''}
            >
              <option value="">Any available workshop capacity</option>
              {staff.data
                ?.filter((s) => s.technician)
                .map((s) => (
                  <option key={s.userId} value={s.userId}>
                    {s.displayName}
                  </option>
                ))}
            </select>
          </label>
          <Field
            name="requestedStartTime"
            type="datetime-local"
            label={'Start (' + branch.timezone + ')'}
            value={
              form === 'new' ? undefined : localInput(form.requestedStartTime, branch.timezone)
            }
          />
          <Field
            name="estimatedDurationMinutes"
            type="number"
            label="Duration in minutes (15–480)"
            value={form === 'new' ? 60 : form.estimatedDurationMinutes}
          />
          <Field
            name="customerComplaint"
            label="Customer complaint"
            type="textarea"
            value={form === 'new' ? '' : form.customerComplaint}
          />
        </ActionForm>
      )}
      {detail && (
        <div className="panel operation-card">
          <div className="panel-heading">
            <h2>Booking detail · {detail.registration}</h2>
            <Button variant="ghost" onClick={() => setDetail(null)}>
              Close detail
            </Button>
          </div>
          <p>
            {date(detail.requestedStartTime, branch.timezone)} · {detail.customerName}
          </p>
          <Badge value={detail.appointmentStatus} />
          <p>{detail.customerComplaint}</p>
          <div className="operations-tools">
            {allowed(me, 'BOOKING_WRITE') &&
              ['REQUESTED', 'CONFIRMED'].includes(detail.appointmentStatus) &&
              !detail.checkInState && (
                <>
                  <Button disabled={command.busy} onClick={() => setForm(detail)}>
                    Reschedule
                  </Button>
                  {detail.appointmentStatus === 'REQUESTED' && (
                    <Button disabled={command.busy} onClick={() => action(detail, 'confirm')}>
                      Confirm appointment
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    disabled={command.busy}
                    onClick={() => action(detail, 'cancel')}
                  >
                    Cancel appointment
                  </Button>
                  <Button
                    variant="outline"
                    disabled={command.busy}
                    onClick={() => action(detail, 'no-show')}
                  >
                    Record no-show
                  </Button>
                </>
              )}
            {detail.appointmentStatus === 'CONFIRMED' &&
              !detail.checkInState &&
              allowed(me, 'WORKORDER_CREATE') && (
                <a
                  className="button"
                  href={'/check-in?appointment=' + detail.id + '&branch=' + detail.branchId}
                >
                  Check in vehicle
                </a>
              )}
            {detail.checkInState && (
              <Button
                disabled={command.busy}
                onClick={() =>
                  command.run<Appointment>(
                    'booking/appointments/' + detail.id + '/reconcile',
                    {},
                    (v) => {
                      setDetail(v);
                      bookings.reload();
                    },
                  )
                }
              >
                Reconcile intake / completion
              </Button>
            )}
            {detail.workOrderId && <a href={'/jobs/' + detail.workOrderId}>Open job card</a>}
          </div>
        </div>
      )}
    </>
  );
}

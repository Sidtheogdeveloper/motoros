'use client';
import { useState, useEffect } from 'react';
import { useAccount, useData, Issue } from '../registry/shared';
import { send } from '@/lib/api';
import { Button } from '../ui/button';
import { Field, Lookup, type Appointment, type Job } from './shared';
export function Intake({
  branch,
  onAppointmentBranch,
}: {
  branch: string;
  onAppointmentBranch: (id: string) => void;
}) {
  const me = useAccount(),
    [appointmentId, setAppointmentId] = useState(''),
    [key] = useState(() => crypto.randomUUID()),
    [vehicle, setVehicle] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [receipt, setReceipt] = useState<{ id: string; workOrderId: string } | null>(null);
  useEffect(() => {
    setAppointmentId(new URLSearchParams(window.location.search).get('appointment') || '');
  }, []);
  const appointment = useData<Appointment>(
      appointmentId ? 'booking/appointments/' + appointmentId : null,
    ),
    selected = useData<{ customerId: string; registration: string; make: string; model: string }>(
      vehicle ? 'customer/vehicles/' + vehicle : null,
    );
  const owner = appointment.data?.customerId || selected.data?.customerId;
  useEffect(() => {
    if (appointment.data?.branchId && appointment.data.branchId !== branch)
      onAppointmentBranch(appointment.data.branchId);
  }, [appointment.data?.branchId, branch, onAppointmentBranch]);
  async function submit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const f = new FormData(e.currentTarget);
    const body = {
      branchId: appointment.data?.branchId || branch,
      customerId: owner,
      vehicleId: appointment.data?.vehicleId || vehicle,
      odometerKilometers: Number(f.get('odometerKilometers')),
      complaints: String(f.get('complaints')),
      serviceRequested: String(f.get('serviceRequested')),
      damageObservations: String(f.get('damageObservations')),
      fuelLevel: f.get('fuelLevel') ? Number(f.get('fuelLevel')) : null,
      accessories: String(f.get('accessories') || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    };
    try {
      if (!owner) throw new Error('Choose an active vehicle with current ownership');
      if (appointmentId) {
        const a = await send<Appointment>(
          'booking/appointments/' + appointmentId + '/check-in',
          body,
          'POST',
          me.activeTenant!,
          key,
        );
        setReceipt({ id: a.checkInId, workOrderId: a.workOrderId });
      } else setReceipt(await send('workorder/check-ins', body, 'POST', me.activeTenant!, key));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Check-in failed');
    } finally {
      setBusy(false);
    }
  }
  if (receipt)
    return (
      <section className="panel operation-card">
        <span className="eyebrow">CHECK-IN CONFIRMED</span>
        <h2>Vehicle intake saved</h2>
        <p>Receipt reference: {receipt.id}</p>
        <p>Odometer, complaints and arrival observations were recorded with the job card.</p>
        <a className="button" href={'/jobs/' + receipt.workOrderId}>
          Open job card and attach intake photos
        </a>
        <a href="/check-in">Next vehicle</a>
      </section>
    );
  return (
    <section className="panel operation-card">
      <h2>{appointmentId ? 'Appointment arrival' : 'Walk-in registration'}</h2>
      <p>
        Register a walk-in directly; no customer portal appointment is required. Photos can be added
        to the saved job card.
      </p>
      <Issue error={error || appointment.error || selected.error} loading={appointment.loading} />
      <form className="intake-form" onSubmit={submit}>
        {appointmentId ? (
          <p>
            {appointment.data?.registration} · {appointment.data?.customerName} ·{' '}
            {appointment.data?.appointmentStatus}
          </p>
        ) : (
          <>
            <Lookup kind="vehicles" onSelect={setVehicle} />
            <p>
              {selected.data?.registration} {selected.data?.make} {selected.data?.model}
            </p>
            <p>
              Current customer is validated from the vehicle registry.{' '}
              <a href="/customers">Register a new customer</a> ·{' '}
              <a href="/vehicles">Register a vehicle</a>
            </p>
          </>
        )}
        <Field name="odometerKilometers" label="Current odometer (km)" type="number" />
        <Field
          name="complaints"
          label="Customer complaints"
          type="textarea"
          value={appointment.data?.customerComplaint}
        />
        <Field name="serviceRequested" label="Service requested" max={1000} />
        <Field
          name="damageObservations"
          label="Existing damage observations"
          type="textarea"
          required={false}
        />
        <Field
          name="fuelLevel"
          label="Fuel level, percent (optional)"
          type="number"
          required={false}
        />
        <Field
          name="accessories"
          label="Accessories and belongings (comma-separated)"
          required={false}
          max={1000}
        />
        <p className="muted">
          You are recorded as the service advisor. Check-in time is recorded by the server.
        </p>
        <Button
          disabled={busy || (!!appointmentId && !appointment.data) || (!appointmentId && !owner)}
        >
          {busy ? 'Checking in…' : 'Complete vehicle check-in'}
        </Button>
        <p className="notice">
          If this operation times out, retry without changing the form. The same request key resumes
          check-in safely.
        </p>
      </form>
    </section>
  );
}

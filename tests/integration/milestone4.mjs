import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { signIn, select, call, createIdentity, invitationMail } from '../helpers/oidc.mjs';
const f = JSON.parse(readFileSync('.runtime/m3-fixtures.json', 'utf8'));
const results = [],
  browser = await chromium.launch(),
  contexts = [];
async function actor(identity, tenant = f.tenant) {
  const c = await browser.newContext();
  contexts.push(c);
  await signIn(await c.newPage(), identity);
  if (tenant) await select(c, tenant);
  return c;
}
function check(name, actual, expected) {
  results.push({ name, actual, expected, pass: actual === expected });
  assert.equal(actual, expected, name);
}
async function req(c, path, expected = 200, name = path, options = {}) {
  const r = await call(c, path, { tenant: f.tenant, ...options });
  const body = await r.json();
  check(name + (r.status() === expected ? '' : ' (' + body.title + ')'), r.status(), expected);
  return body;
}
const post = (data, key) => ({ method: 'POST', data, key });
async function invite(owner, role, prefix) {
  const identity = await createIdentity(prefix);
  await req(
    owner,
    'tenant/tenants/' + f.tenant + '/invitations',
    201,
    'Invite workshop ' + role,
    post({ email: identity.email, role, branchIds: [f.omr.id] }),
  );
  const mail = await invitationMail(identity.email);
  const c = await actor(identity, null);
  const accepted = await req(
    c,
    'tenant/invitations/accept',
    200,
    'Accept workshop role',
    post({ token: mail.token }),
  );
  await select(c, f.tenant);
  return { identity, membershipId: accepted.membershipId, context: c };
}
try {
  const owner = await actor(f.owner);
  let setup;
  if (existsSync('.runtime/m4-fixtures.json'))
    setup = JSON.parse(readFileSync('.runtime/m4-fixtures.json', 'utf8'));
  else {
    const tech = await invite(owner, 'MECHANIC', 'm4-omr-mechanic'),
      reviewer = await invite(owner, 'BRANCH_MANAGER', 'm4-qc-reviewer');
    setup = {
      technician: tech.identity,
      technicianMembershipId: tech.membershipId,
      reviewer: reviewer.identity,
      reviewerMembershipId: reviewer.membershipId,
    };
    writeFileSync('.runtime/m4-fixtures.json', JSON.stringify(setup, null, 2));
  }
  const tech = await actor(setup.technician),
    reviewer = await actor(setup.reviewer),
    vel = await actor(f.employeeA),
    precision = await actor(f.employeeB, f.precisionTenant);
  const techMe = await tech.request.get('http://127.0.0.1:3000/api/auth/me').then((r) => r.json()),
    reviewMe = await reviewer.request
      .get('http://127.0.0.1:3000/api/auth/me')
      .then((r) => r.json());
  const techId = techMe.user.id,
    reviewerId = reviewMe.user.id;
  for (const branch of [f.anna, f.omr, f.velachery]) {
    const current = await req(owner, 'tenant/branches/' + branch.id);
    const operatingHours = Object.fromEntries(
      ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'].map((d) => [
        d,
        { open: '09:00', close: '18:00' },
      ]),
    );
    await req(owner, 'tenant/branches/' + branch.id, 200, 'Configure branch scheduling', {
      method: 'PATCH',
      data: {
        ...current,
        operatingHours,
        settings: { ...current.settings, appointmentCapacity: 2, separateQualityReviewer: true },
      },
    });
  }
  const staff = await req(owner, 'tenant/branches/' + f.omr.id + '/technicians');
  const reviewerStaff = staff.find((s) => s.userId === reviewerId);
  await req(
    owner,
    'tenant/tenants/' + f.tenant + '/staff/' + setup.reviewerMembershipId + '/capabilities',
    200,
    'Manager attests separate reviewer',
    {
      method: 'PATCH',
      data: {
        branchId: f.omr.id,
        qualityReview: true,
        safetyReview: true,
        attestation: 'Development fixture: manager reviewed workshop competence',
        version: reviewerStaff.capabilityVersion,
      },
    },
  );
  const customer = await req(
    owner,
    'customer/customers',
    201,
    'Create customer at Apex',
    post({
      name: 'M4 acceptance customer',
      email: 'm4-' + randomUUID() + '@example.test',
      phone: '',
      city: 'Chennai',
      country: 'India',
    }),
  );
  const vehicle = await req(
    owner,
    'customer/vehicles',
    201,
    'Register vehicle at Anna Nagar',
    post({
      customerId: customer.id,
      registration: 'TN04' + Date.now().toString().slice(-8),
      make: 'Honda',
      model: 'City',
      year: 2022,
      branchId: f.anna.id,
    }),
  );
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const start = new Date(tomorrow + 'T05:30:00Z').toISOString();
  const input = {
    branchId: f.omr.id,
    customerId: customer.id,
    vehicleId: vehicle.id,
    serviceCategoryId: '00000000-0000-0000-0000-000000000401',
    requestedStartTime: start,
    estimatedDurationMinutes: 60,
    customerComplaint: 'Check brake noise and carry out service',
    bookingSource: 'STAFF',
  };
  const key = randomUUID();
  let appointment = await req(
    owner,
    'booking/appointments',
    201,
    'Create appointment',
    post(input, key),
  );
  const again = await req(
    owner,
    'booking/appointments',
    201,
    'Appointment retry returns same resource',
    post(input, key),
  );
  check('Appointment identity survives retry', again.id, appointment.id);
  await req(
    owner,
    'booking/appointments',
    409,
    'Different request cannot reuse operation key',
    post({ ...input, customerComplaint: 'Different complaint' }, key),
  );
  await req(
    owner,
    'booking/appointments',
    409,
    'Opening hours enforced',
    post({ ...input, requestedStartTime: tomorrow + 'T00:00:00Z' }),
  );
  await req(
    owner,
    'booking/appointments',
    400,
    'Past appointment rejected',
    post({ ...input, requestedStartTime: '2020-01-01T10:00:00Z' }),
  );
  await req(tech, 'booking/appointments', 403, 'Mechanic cannot create bookings', post(input));
  const capStart = tomorrow + 'T08:30:00Z';
  const concurrent = await Promise.all(
    Array.from({ length: 6 }, () =>
      call(owner, 'booking/appointments', {
        tenant: f.tenant,
        ...post({ ...input, requestedStartTime: capStart }),
      }),
    ),
  );
  check(
    'Concurrent bookings admitted to capacity',
    concurrent.filter((r) => r.status() === 201).length,
    2,
  );
  check('Concurrent overbooking rejected', concurrent.filter((r) => r.status() === 409).length, 4);
  for (const response of concurrent.filter((r) => r.status() === 201)) {
    const a = await response.json();
    await req(
      owner,
      'booking/appointments/' + a.id + '/cancel',
      200,
      'Cancel releases capacity',
      post({ version: a.version, note: 'Capacity test complete' }),
    );
  }
  appointment = await req(
    owner,
    'booking/appointments/' + appointment.id + '/reschedule',
    200,
    'Reschedule with revalidation',
    post({ ...input, requestedStartTime: tomorrow + 'T06:30:00Z', version: appointment.version }),
  );
  appointment = await req(
    owner,
    'booking/appointments/' + appointment.id + '/confirm',
    200,
    'Confirm appointment',
    post({ version: appointment.version, note: 'Confirmed by advisor' }),
  );
  await req(
    vel,
    'booking/appointments/' + appointment.id,
    403,
    'Unauthorized branch appointment denied',
  );
  const intake = {
    branchId: f.omr.id,
    customerId: customer.id,
    vehicleId: vehicle.id,
    odometerKilometers: 15000,
    complaints: input.customerComplaint,
    serviceRequested: 'General service and brake diagnosis',
    damageObservations: 'Small left rear scratch',
    fuelLevel: 40,
    accessories: ['Spare wheel', 'Tool kit'],
  };
  const intakeKey = randomUUID();
  appointment = await req(
    owner,
    'booking/appointments/' + appointment.id + '/check-in',
    200,
    'Appointment check-in coordinates real work order',
    post(intake, intakeKey),
  );
  const retried = await req(
    owner,
    'booking/appointments/' + appointment.id + '/check-in',
    200,
    'Check-in retry does not duplicate job',
    post(intake, intakeKey),
  );
  check('Intake retry retains work order', retried.workOrderId, appointment.workOrderId);
  await req(
    owner,
    'booking/appointments/' + appointment.id + '/check-in',
    409,
    'Committed intake cannot be retried with changed input',
    post({ ...intake, complaints: 'Different intake' }, intakeKey),
  );
  let job = await req(owner, 'workorder/work-orders/' + appointment.workOrderId);
  check('Job starts checked in', job.status, 'CHECKED_IN');
  check('Human readable job card present', job.jobCardNumber.startsWith('JC-'), true);
  await req(
    owner,
    'workorder/work-orders/' + job.id + '/transition',
    409,
    'Skipping workflow is rejected',
    post({ version: job.version, status: 'DELIVERED', note: 'Invalid skip' }),
  );
  const velMe = await vel.request.get('http://127.0.0.1:3000/api/auth/me').then((r) => r.json());
  await req(
    owner,
    'workorder/work-orders/' + job.id + '/assign',
    403,
    'Assignment rejects technician from unauthorized branch',
    post({
      version: job.version,
      technicianId: velMe.user.id,
      reason: 'Invalid branch assignment test',
    }),
  );
  const blocked = await invite(owner, 'MECHANIC', 'm4-inactive-mechanic');
  const blockedMe = await blocked.context.request
    .get('http://127.0.0.1:3000/api/auth/me')
    .then((r) => r.json());
  const scoped = await invite(owner, 'REGIONAL_MANAGER', 'm4-scoped-regional');
  await req(
    owner,
    'tenant/tenants/' + f.tenant + '/staff/' + blocked.membershipId,
    200,
    'Give synthetic employee two branch assignments',
    { method: 'PATCH', data: { version: 0, branchIds: [f.omr.id, f.velachery.id] } },
  );
  const qualification = {
    branchId: f.omr.id,
    qualityReview: true,
    safetyReview: true,
    attestation: 'Scope boundary test for workshop qualifications',
    version: 0,
  };
  await req(
    scoped.context,
    'tenant/tenants/' + f.tenant + '/staff/' + blocked.membershipId + '/capabilities',
    403,
    'Scoped regional manager cannot attest wider employee membership',
    { method: 'PATCH', data: qualification },
  );
  const ownerAccount = await owner.request
    .get('http://127.0.0.1:3000/api/auth/me')
    .then((r) => r.json());
  const ownerMember = ownerAccount.memberships.find((m) => m.tenantId === f.tenant).id;
  await req(
    scoped.context,
    'tenant/tenants/' + f.tenant + '/staff/' + ownerMember + '/capabilities',
    403,
    'Regional manager cannot attest a privileged owner',
    { method: 'PATCH', data: qualification },
  );
  await req(
    owner,
    'tenant/tenants/' + f.tenant + '/staff/' + blocked.membershipId + '/deactivate',
    200,
    'Deactivate synthetic technician',
    post({ version: 1 }),
  );
  await req(
    owner,
    'workorder/work-orders/' + job.id + '/assign',
    403,
    'Assignment rejects deactivated technician',
    post({
      version: job.version,
      technicianId: blockedMe.user.id,
      reason: 'Deactivated technician test',
    }),
  );
  const unavailableStart = new Date(new Date(start).getTime() + 5 * 3600000).toISOString(),
    unavailableEnd = new Date(new Date(start).getTime() + 6 * 3600000).toISOString();
  await req(
    owner,
    'tenant/tenants/' + f.tenant + '/staff/' + setup.technicianMembershipId + '/unavailability',
    200,
    'Record future staff unavailability',
    post({
      branchId: f.omr.id,
      startsAt: unavailableStart,
      endsAt: unavailableEnd,
      reason: 'Synthetic availability test',
    }),
  );
  await req(
    owner,
    'booking/appointments',
    409,
    'Assigned technician unavailable for requested appointment',
    post({ ...input, requestedStartTime: unavailableStart, assignedTechnicianId: techId }),
  );
  const assign = () =>
    call(owner, 'workorder/work-orders/' + job.id + '/assign', {
      tenant: f.tenant,
      ...post({
        version: job.version,
        technicianId: techId,
        reason: 'Assign available OMR mechanic',
      }),
    });
  const assigned = await Promise.all([assign(), assign()]);
  check(
    'Concurrent assignment admits one version',
    assigned.filter((r) => r.status() === 200).length,
    1,
  );
  check(
    'Stale simultaneous assignment rejected',
    assigned.filter((r) => r.status() === 409).length,
    1,
  );
  job = await req(owner, 'workorder/work-orders/' + job.id);
  await req(
    vel,
    'workorder/work-orders/' + job.id + '/notes',
    403,
    'Different branch mechanic cannot edit job',
    post({ kind: 'TECHNICIAN', note: 'Unauthorized modification' }),
  );
  await req(
    tech,
    'workorder/work-orders/' + job.id + '/assign',
    403,
    'Mechanic cannot reassign jobs',
    post({ version: job.version, technicianId: techId, reason: 'Unauthorized assignment' }),
  );
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGmQAAAAASUVORK5CYII=',
    'base64',
  );
  const grant = await req(
    tech,
    'workorder/work-orders/' + job.id + '/photos',
    200,
    'Assigned mechanic gets private photo upload',
    post({
      label: 'DAMAGE',
      fileName: 'damage.png',
      contentType: 'image/png',
      byteSize: png.length,
      sha256: createHash('sha256').update(png).digest('hex'),
    }),
  );
  check(
    'Signed photo upload succeeds',
    (await fetch(grant.url, { method: 'PUT', headers: grant.headers, body: png })).status,
    200,
  );
  await req(
    tech,
    'workorder/work-orders/' + job.id + '/photos/' + grant.photoId + '/complete',
    200,
    'Photo verified and privately published',
    post({ version: 0 }),
  );
  const photo = await req(
    owner,
    'workorder/work-orders/' + job.id + '/photos/' + grant.photoId + '/download',
  );
  check('Anonymous object request denied', (await fetch(photo.url.split('?')[0])).status, 403);
  check('Authorized signed photo download', (await fetch(photo.url)).status, 200);
  async function move(status, context = owner) {
    job = await req(owner, 'workorder/work-orders/' + job.id);
    job = await req(
      context,
      'workorder/work-orders/' + job.id + '/transition',
      200,
      'Transition ' + status,
      post({ version: job.version, status, note: 'M4 acceptance workflow ' + status }),
    );
  }
  await move('INSPECTION', tech);
  let inspection = await req(
    tech,
    'workorder/work-orders/' + job.id + '/inspections',
    200,
    'Create checklist snapshot',
    post({ templateId: '00000000-0000-0000-0000-000000000410' }),
  );
  await req(
    tech,
    'workorder/inspections/' + inspection.id + '/complete',
    409,
    'Incomplete checklist cannot complete',
    post({ version: inspection.version }),
  );
  inspection = await req(tech, 'workorder/inspections/' + inspection.id, 200, 'Persist findings', {
    method: 'PATCH',
    data: {
      version: inspection.version,
      findings: inspection.findings.map((i) => ({
        itemId: i.itemId,
        condition: i.category === 'Brakes' ? 'ATTENTION_REQUIRED' : 'GOOD',
        technicianNotes:
          i.category === 'Brakes' ? 'Brake noise requires qualified review' : 'Observed normal',
        severity: i.category === 'Brakes' ? 'HIGH' : 'LOW',
        photoReferences: i.category === 'Brakes' ? [grant.photoId] : [],
      })),
    },
  });
  inspection = await req(
    tech,
    'workorder/inspections/' + inspection.id + '/complete',
    200,
    'Safety finding requires qualified review',
    post({ version: inspection.version }),
  );
  check('Inspection waits for reviewer', inspection.status, 'REVIEW_REQUIRED');
  inspection = await req(
    reviewer,
    'workorder/inspections/' + inspection.id + '/complete',
    200,
    'Separate qualified reviewer records review',
    post({
      version: inspection.version,
      reviewNotes: 'Reviewed brake observations; repair task required',
    }),
  );
  const task = await req(
    owner,
    'workorder/work-orders/' + job.id + '/tasks',
    200,
    'Create assigned repair task',
    post({
      taskDescription: 'Inspect and service brake assembly',
      taskCategory: 'BRAKES',
      priority: 'HIGH',
      estimatedDurationMinutes: 60,
      assignedTechnicianId: techId,
    }),
  );
  await req(
    tech,
    'workorder/work-orders/' + job.id + '/tasks/' + task.id + '/start',
    409,
    'Repairs cannot start before approval',
    post({ version: 0, status: 'IN_PROGRESS', note: 'Cannot start yet' }),
  );
  await move('ESTIMATE_PENDING', tech);
  await move('AWAITING_APPROVAL', tech);
  await req(
    tech,
    'workorder/work-orders/' + job.id + '/development-approval',
    403,
    'Mechanic cannot approve own estimate',
    post({ version: job.version, decision: 'APPROVE', reason: 'Unauthorized approval attempt' }),
  );
  job = await req(
    owner,
    'workorder/work-orders/' + job.id + '/development-approval',
    200,
    'Manager records explicit local simulation',
    post({
      version: job.version,
      decision: 'APPROVE',
      reason: 'M4 local acceptance simulation only',
    }),
  );
  await move('IN_PROGRESS', tech);
  const part = await req(
    tech,
    'workorder/work-orders/' + job.id + '/parts',
    200,
    'Mechanic requests required part',
    post({ description: 'Synthetic brake service part', quantity: 1 }),
  );
  const partId = part.parts.at(-1).id;
  job = await req(
    owner,
    'workorder/work-orders/' + job.id + '/parts/' + partId,
    200,
    'Advisor records part received',
    { method: 'PATCH', data: { version: 0, status: 'RECEIVED', note: 'Synthetic part receipt' } },
  );
  job = await req(
    tech,
    'workorder/work-orders/' + job.id + '/parts/' + partId,
    200,
    'Mechanic records part used',
    { method: 'PATCH', data: { version: 1, status: 'USED', note: 'Synthetic part installed' } },
  );
  async function finishTask(taskId) {
    job = await req(owner, 'workorder/work-orders/' + job.id);
    let task = job.tasks.find((t) => t.id === taskId);
    job = await req(
      tech,
      'workorder/work-orders/' + job.id + '/tasks/' + taskId + '/start',
      200,
      'Technician starts repair task',
      post({ version: task.version, status: 'IN_PROGRESS', note: 'Repair work started' }),
    );
    task = job.tasks.find((t) => t.id === taskId);
    job = await req(
      tech,
      'workorder/work-orders/' + job.id + '/tasks/' + taskId + '/complete',
      200,
      'Technician completes repair task',
      post({ version: task.version, status: 'COMPLETED', note: 'Repair task completed' }),
    );
  }
  await finishTask(task.id);
  job = await req(
    tech,
    'workorder/work-orders/' + job.id + '/quality-check',
    200,
    'Submit for qualified quality check',
    post({ version: job.version, reviewerId }),
  );
  let qc = job.qualityChecks.find((q) => q.status === 'PENDING');
  await req(
    tech,
    'workorder/work-orders/' + job.id + '/quality-check/approve',
    403,
    'Mechanic cannot sign quality check',
    post({
      version: qc.version,
      checklist: { repairsVerified: true },
      notes: 'Unauthorized self sign off',
    }),
  );
  job = await req(
    reviewer,
    'workorder/work-orders/' + job.id + '/quality-check/reject',
    200,
    'QC rejection creates rework',
    post({
      version: qc.version,
      checklist: { repairsVerified: false },
      notes: 'Brake noise remains; repeat repair verification',
    }),
  );
  check('Failed QC returns job in progress', job.status, 'IN_PROGRESS');
  const rework = job.tasks.find((t) => t.taskCategory === 'REWORK');
  check('Rework task recorded', !!rework, true);
  await finishTask(rework.id);
  job = await req(
    tech,
    'workorder/work-orders/' + job.id + '/quality-check',
    200,
    'Resubmit completed rework',
    post({ version: job.version, reviewerId }),
  );
  qc = job.qualityChecks.find((q) => q.status === 'PENDING');
  job = await req(
    reviewer,
    'workorder/work-orders/' + job.id + '/quality-check/approve',
    200,
    'Qualified reviewer signs final check',
    post({
      version: qc.version,
      checklist: { repairsVerified: true, findingsReviewed: true, belongingsVerified: true },
      notes: 'Repairs and recorded observations verified for delivery',
    }),
  );
  check('Job ready for delivery', job.status, 'READY_FOR_DELIVERY');
  await move('DELIVERED');
  await move('CLOSED');
  const history = await req(
    vel,
    'customer/vehicles/' + vehicle.id + '/timeline?branchId=' + f.velachery.id,
    200,
    'Velachery mechanic sees completed OMR service',
  );
  check(
    'OMR completed service appears',
    history.content.some((h) => h.id === job.id),
    true,
  );
  await req(
    precision,
    'customer/vehicles/' + vehicle.id,
    404,
    'Precision cannot read Apex vehicle',
    { tenant: f.precisionTenant },
  );
  await req(precision, 'workorder/work-orders/' + job.id, 404, 'Precision cannot read Apex job', {
    tenant: f.precisionTenant,
  });
  await req(
    precision,
    'workorder/work-orders/' + job.id + '/photos/' + grant.photoId + '/download',
    404,
    'Precision cannot access Apex photos',
    { tenant: f.precisionTenant },
  );
  await req(
    precision,
    'customer/vehicles/' + vehicle.id + '/timeline?branchId=' + f.precisionBranch.id,
    404,
    'Precision cannot access Apex timeline',
    { tenant: f.precisionTenant },
  );
  await req(
    owner,
    'booking/appointments/' + appointment.id + '/reconcile',
    200,
    'Booking completion reconciles delivered job',
    post({}),
  );
  const workload = await req(
    owner,
    'workorder/technicians/workload?branchId=' + f.omr.id,
    200,
    'Real technician workload',
  );
  check(
    'Workload contains completed tasks',
    workload
      .find((s) => s.userId === techId)
      .tasks.some((t) => t.id === task.id && t.status === 'COMPLETED'),
    true,
  );
  const audit = await req(
    owner,
    'workorder/work-orders/' + job.id + '/audit',
    200,
    'Mutation audit retained',
  );
  check(
    'QC rework audit exists',
    audit.some((a) => a.action === 'QUALITY_REWORK_REQUESTED'),
    true,
  );
  setup.lastAcceptance = {
    jobId: job.id,
    vehicleId: vehicle.id,
    customerId: customer.id,
    appointmentId: appointment.id,
    photoId: grant.photoId,
    technicianId: techId,
    reviewerId,
  };
  writeFileSync('.runtime/m4-fixtures.json', JSON.stringify(setup, null, 2));
  console.log('M4 API checks passed: ' + results.length);
} finally {
  writeFileSync('.runtime/m4-api-results.json', JSON.stringify(results, null, 2));
  for (const c of contexts) await c.close();
  await browser.close();
}

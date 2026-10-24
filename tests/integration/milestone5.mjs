import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import {
  signIn,
  select,
  call,
  createIdentity,
  invitationMail,
  mail,
  origin,
} from '../helpers/oidc.mjs';
const f = JSON.parse(readFileSync('.runtime/m3-fixtures.json', 'utf8')),
  ops = JSON.parse(readFileSync('.runtime/m4-fixtures.json', 'utf8'));
const browser = await chromium.launch(),
  contexts = [],
  results = [];
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
async function req(c, path, status = 200, options = {}, name = path) {
  const r = await call(c, path, { tenant: f.tenant, ...options });
  const body = await r.json();
  check(name + (r.status() === status ? '' : ' (' + body.title + ')'), r.status(), status);
  return body;
}
const post = (data, key) => ({ method: 'POST', data, key });
async function consent(c, estimate, decision = 'APPROVED') {
  const message = await mail(c.identity.email, estimate.id);
  const token = message.Text.match(/#token=([A-Za-z0-9_-]{43})/)[1];
  return { token, decision, note: 'Synthetic customer decision for this exact repair scope' };
}
try {
  const owner = await actor(f.owner),
    tech = await actor(ops.technician),
    reviewer = await actor(ops.reviewer),
    vel = await actor(f.employeeA),
    precision = await actor(f.employeeB, f.precisionTenant),
    precisionOwner = await actor(f.precisionOwner, f.precisionTenant);
  let setup = existsSync('.runtime/m5-fixtures.json')
    ? JSON.parse(readFileSync('.runtime/m5-fixtures.json', 'utf8'))
    : null;
  if (!setup) {
    const identity = await createIdentity('m5-customer');
    await req(
      owner,
      `tenant/tenants/${f.tenant}/invitations`,
      201,
      post({ email: identity.email, role: 'CUSTOMER', branchIds: [] }),
    );
    const invitation = await invitationMail(identity.email);
    const c = await actor(identity, null);
    await req(c, 'tenant/invitations/accept', 200, post({ token: invitation.token }));
    await select(c, f.tenant);
    const customer = await req(
      owner,
      'customer/customers',
      201,
      post({
        name: 'M5 acceptance customer',
        email: identity.email,
        phone: '',
        country: 'India',
        city: 'Chennai',
      }),
    );
    const vehicle = await req(
      owner,
      'customer/vehicles',
      201,
      post({
        customerId: customer.id,
        registration: 'TN05' + Date.now().toString().slice(-8),
        make: 'Honda',
        model: 'City',
        branchId: f.anna.id,
      }),
    );
    setup = { customerIdentity: identity, customer, vehicle };
    writeFileSync('.runtime/m5-fixtures.json', JSON.stringify(setup, null, 2));
  }
  if (!setup.inventoryIdentity) {
    const identity = await createIdentity('m5-inventory');
    await req(
      owner,
      `tenant/tenants/${f.tenant}/invitations`,
      201,
      post({ email: identity.email, role: 'INVENTORY_MANAGER', branchIds: [f.omr.id] }),
    );
    const invitation = await invitationMail(identity.email);
    const c = await actor(identity, null);
    await req(c, 'tenant/invitations/accept', 200, post({ token: invitation.token }));
    await select(c, f.tenant);
    setup.inventoryIdentity = identity;
    writeFileSync('.runtime/m5-fixtures.json', JSON.stringify(setup, null, 2));
  }
  const inventoryActor = await actor(setup.inventoryIdentity);
  const customer = await actor(setup.customerIdentity);
  customer.identity = setup.customerIdentity;
  const current = await call(owner, 'billing/billing/settings?branchId=' + f.omr.id, {
    tenant: f.tenant,
  });
  const prior = current.ok() ? await current.json() : { version: 0 };
  await req(owner, 'billing/billing/settings', 200, {
    method: 'PUT',
    data: {
      branchId: f.omr.id,
      currency: 'INR',
      laborHourlyRate: '500.00',
      taxRate: '18',
      legalName: 'Apex Motorworks OMR',
      address: 'Synthetic local workshop, Chennai',
      taxLabel: 'Configured tax',
      registrationReference: 'LOCAL-TEST',
      paymentRequiredBeforeDelivery: true,
      version: prior.version,
    },
  });
  const part = await req(
    owner,
    'inventory/parts',
    200,
    post({
      sku: 'M5-' + randomUUID(),
      name: 'M5 acceptance oil filter',
      category: 'Filters',
      manufacturer: 'Synthetic manufacturer',
      currency: 'INR',
      purchasePrice: '70.00',
      sellingPrice: '100.00',
      active: true,
    }),
  );
  const receiveKey = randomUUID(),
    receipt = {
      branchId: f.omr.id,
      partId: part.id,
      quantity: 5,
      reason: 'Synthetic supplier receipt',
    };
  await req(inventoryActor, 'inventory/inventory/receipts', 200, post(receipt, receiveKey));
  await req(inventoryActor, 'inventory/inventory/receipts', 200, post(receipt, receiveKey));
  let stock = await req(owner, 'inventory/inventory/stock?branchId=' + f.omr.id + '&q=' + part.sku);
  check('Receipt replay creates no duplicate stock', Number(stock.content[0].onHand), 5);
  const publicPart = await req(tech, 'inventory/parts/' + part.id);
  check('Mechanic cannot see purchase cost', Object.hasOwn(publicPart, 'purchasePrice'), false);
  await req(tech, 'inventory/inventory/receipts', 403, post(receipt));
  await req(vel, 'inventory/inventory/stock?branchId=' + f.omr.id, 403);
  await req(precision, 'inventory/parts/' + part.id, 404, { tenant: f.precisionTenant });
  const readings = await req(owner, `customer/vehicles/${setup.vehicle.id}/odometer?size=1`);
  const nextOdometer = Math.max(17000, ...readings.content.map((r) => Number(r.kilometers))) + 100;
  let job = await req(
    owner,
    'workorder/check-ins',
    201,
    post({
      branchId: f.omr.id,
      customerId: setup.customer.id,
      vehicleId: setup.vehicle.id,
      odometerKilometers: nextOdometer,
      complaints: 'M5 commercial acceptance ' + Date.now(),
      serviceRequested: 'Replace filter and service vehicle',
      accessories: ['Spare wheel'],
    }),
  );
  job = await req(owner, 'workorder/work-orders/' + job.workOrderId);
  job = await req(
    owner,
    `workorder/work-orders/${job.id}/assign`,
    200,
    post({
      version: job.version,
      technicianId: ops.lastAcceptance.technicianId,
      reason: 'Assign OMR mechanic',
    }),
  );
  async function move(status) {
    job = await req(
      owner,
      `workorder/work-orders/${job.id}/transition`,
      200,
      post({ version: job.version, status, note: 'M5 acceptance ' + status }),
    );
  }
  await move('INSPECTION');
  let inspection = await req(
    tech,
    `workorder/work-orders/${job.id}/inspections`,
    200,
    post({ templateId: '00000000-0000-0000-0000-000000000410' }),
  );
  inspection = await req(tech, 'workorder/inspections/' + inspection.id, 200, {
    method: 'PATCH',
    data: {
      version: inspection.version,
      findings: inspection.findings.map((i) => ({
        itemId: i.itemId,
        condition: 'GOOD',
        technicianNotes: 'Synthetic service observation',
        severity: 'LOW',
        photoReferences: [],
      })),
    },
  });
  await req(
    tech,
    `workorder/inspections/${inspection.id}/complete`,
    200,
    post({ version: inspection.version }),
  );
  job = await req(owner, 'workorder/work-orders/' + job.id);
  const requestKey = randomUUID();
  const requestedParts = await req(
    tech,
    `workorder/work-orders/${job.id}/parts`,
    200,
    post({ description: part.sku + ' oil filter', quantity: 1 }, requestKey),
  );
  const repeatedRequest = await req(
    tech,
    `workorder/work-orders/${job.id}/parts`,
    200,
    post({ description: part.sku + ' oil filter', quantity: 1 }, requestKey),
  );
  check(
    'Parts-request retry creates no duplicate',
    repeatedRequest.parts.filter((p) => p.description === part.sku + ' oil filter').length,
    1,
  );
  const fractional = await req(
    tech,
    `workorder/work-orders/${job.id}/parts`,
    200,
    post({ description: 'Synthetic optional fluid quantity', quantity: '0.500' }),
  );
  const fractionalRequest = fractional.parts.find(
    (p) => p.description === 'Synthetic optional fluid quantity',
  );
  check('Fractional parts requests persist exactly', Number(fractionalRequest.quantity), 0.5);
  await req(owner, `workorder/work-orders/${job.id}/parts/${fractionalRequest.id}`, 200, {
    method: 'PATCH',
    data: {
      version: fractionalRequest.version,
      status: 'CANCELLED',
      note: 'Optional fluid was not required',
    },
  });
  const partsRequest = requestedParts.parts.find((p) => p.description === part.sku + ' oil filter');
  const task = await req(
    owner,
    `workorder/work-orders/${job.id}/tasks`,
    200,
    post({
      taskDescription: 'Replace M5 approved oil filter',
      taskCategory: 'SERVICE',
      priority: 'NORMAL',
      estimatedDurationMinutes: 30,
      assignedTechnicianId: ops.lastAcceptance.technicianId,
    }),
  );
  job = await req(owner, 'workorder/work-orders/' + job.id);
  await move('ESTIMATE_PENDING');
  await move('AWAITING_APPROVAL');
  const reservation = await req(
    inventoryActor,
    'inventory/inventory/reservations',
    200,
    post({ branchId: f.omr.id, partId: part.id, workOrderId: job.id, quantity: 1 }),
  );
  let estimate = await req(
    owner,
    'billing/estimates',
    200,
    post({
      branchId: f.omr.id,
      workOrderId: job.id,
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      note: 'Filter replacement with one hour of labor',
      items: [
        {
          itemType: 'PART',
          partId: part.id,
          description: 'Oil filter',
          quantity: '1',
          unitPrice: '0.01',
          discountPercent: '0',
        },
        {
          itemType: 'LABOR',
          description: 'Filter replacement labor',
          quantity: '1',
          unitPrice: '0.01',
          discountPercent: '0',
        },
      ],
    }),
  );
  check('Backend uses catalog and labor prices', Number(estimate.total), 708);
  await req(tech, 'billing/estimates/' + estimate.id, 403);
  await req(vel, 'billing/estimates/' + estimate.id, 403);
  await req(precision, 'billing/estimates/' + estimate.id, 403, { tenant: f.precisionTenant });
  await req(precisionOwner, 'billing/estimates/' + estimate.id, 404, { tenant: f.precisionTenant });
  estimate = await req(
    owner,
    `billing/estimates/${estimate.id}/submit`,
    200,
    post({ version: estimate.version, note: 'Send to verified customer' }),
  );
  const decision = await consent(customer, estimate);
  await req(owner, `billing/estimates/${estimate.id}/approve`, 403, post(decision));
  const approvalKey = randomUUID();
  await req(customer, `billing/estimates/${estimate.id}/approve`, 200, post(decision, approvalKey));
  await req(customer, `billing/estimates/${estimate.id}/approve`, 200, post(decision, approvalKey));
  job = await req(
    owner,
    `workorder/work-orders/${job.id}/commercial-approval`,
    200,
    post({ version: job.version, note: 'Verify real Billing customer consent' }),
  );
  check('Real financial approval has no development decision', job.developmentApprovalId, null);
  await move('IN_PROGRESS');
  job = await req(
    tech,
    `workorder/work-orders/${job.id}/tasks/${task.id}/start`,
    200,
    post({ version: task.version, status: 'IN_PROGRESS', note: 'Begin approved work' }),
  );
  let currentTask = job.tasks.find((t) => t.id === task.id);
  job = await req(
    tech,
    `workorder/work-orders/${job.id}/tasks/${task.id}/complete`,
    200,
    post({ version: currentTask.version, status: 'COMPLETED', note: 'Approved filter replaced' }),
  );
  const consumeKey = randomUUID(),
    consumeBody = { version: reservation.version, note: 'Installed customer-approved filter' };
  await req(
    inventoryActor,
    `inventory/inventory/reservations/${reservation.id}/consume`,
    200,
    post(consumeBody, consumeKey),
  );
  await req(
    inventoryActor,
    `inventory/inventory/reservations/${reservation.id}/consume`,
    200,
    post(consumeBody, consumeKey),
  );
  await req(
    tech,
    `workorder/work-orders/${job.id}/quality-check`,
    409,
    post({ version: job.version, reviewerId: ops.lastAcceptance.reviewerId }),
    'Unresolved mechanic request blocks quality review',
  );
  const fulfillmentKey = randomUUID(),
    fulfillment = {
      version: partsRequest.version,
      reservationId: reservation.id,
      note: 'Mechanic verified installed filter against the requested part',
    };
  job = await req(
    tech,
    `workorder/work-orders/${job.id}/parts/${partsRequest.id}/fulfill`,
    200,
    post(fulfillment, fulfillmentKey),
  );
  job = await req(
    tech,
    `workorder/work-orders/${job.id}/parts/${partsRequest.id}/fulfill`,
    200,
    post(fulfillment, fulfillmentKey),
  );
  check(
    'Installed stock resolves the mechanic parts request',
    job.parts.find((p) => p.id === partsRequest.id).status,
    'FULFILLED',
  );
  const additional = await req(
    owner,
    `workorder/work-orders/${job.id}/tasks`,
    200,
    post({
      taskDescription: 'Additional optional repair not yet approved',
      taskCategory: 'GENERAL',
      priority: 'LOW',
      estimatedDurationMinutes: 15,
      assignedTechnicianId: ops.lastAcceptance.technicianId,
    }),
  );
  await req(
    tech,
    `workorder/work-orders/${job.id}/tasks/${additional.id}/start`,
    409,
    post({
      version: additional.version,
      status: 'IN_PROGRESS',
      note: 'Must not start unapproved additional work',
    }),
  );
  job = await req(owner, `workorder/work-orders/${job.id}/tasks/${additional.id}`, 200, {
    method: 'PATCH',
    data: {
      version: additional.version,
      status: 'CANCELLED',
      note: 'Customer did not request optional repair',
    },
  });
  job = await req(
    tech,
    `workorder/work-orders/${job.id}/quality-check`,
    200,
    post({ version: job.version, reviewerId: ops.lastAcceptance.reviewerId }),
  );
  let quality = job.qualityChecks.find((q) => q.status === 'PENDING');
  job = await req(
    reviewer,
    `workorder/work-orders/${job.id}/quality-check/approve`,
    200,
    post({
      version: quality.version,
      checklist: { repairsVerified: true, findingsReviewed: true, belongingsVerified: true },
      notes: 'Separate qualified reviewer sign-off',
    }),
  );
  check('QC pass waits for commercial readiness', job.status, 'QUALITY_CHECK');
  await req(
    owner,
    `workorder/work-orders/${job.id}/ready-for-delivery`,
    409,
    post({ version: job.version, note: 'Invoice and payment missing' }),
  );
  let invoice = await req(owner, 'billing/invoices', 200, post({ estimateId: estimate.id }));
  invoice = await req(
    owner,
    `billing/invoices/${invoice.id}/issue`,
    200,
    post({ version: invoice.version, note: 'Issue immutable approved repair invoice' }),
  );
  let payment = await req(
    owner,
    'billing/payments',
    200,
    post({
      invoiceId: invoice.id,
      amount: '300.00',
      method: 'CASH',
      externalReference: 'M5-' + randomUUID(),
      note: 'First manual cash receipt',
    }),
  );
  invoice = await req(owner, 'billing/invoices/' + invoice.id);
  check('Partial payment has correct outstanding', Number(invoice.outstanding), 408);
  await req(
    owner,
    'billing/payments',
    409,
    post({
      invoiceId: invoice.id,
      amount: '500.00',
      method: 'UPI',
      externalReference: 'M5-' + randomUUID(),
      note: 'Overpayment must fail',
    }),
  );
  await req(
    owner,
    'billing/payments',
    200,
    post({
      invoiceId: invoice.id,
      amount: '408.00',
      method: 'UPI',
      externalReference: 'M5-' + randomUUID(),
      note: 'Manually recorded UPI; provider unverified',
    }),
  );
  await req(
    owner,
    `billing/payments/${payment.id}/reconcile`,
    403,
    post({ version: payment.version, note: 'Recorder cannot self reconcile' }),
  );
  await req(
    reviewer,
    `billing/payments/${payment.id}/reconcile`,
    200,
    post({ version: payment.version, note: 'Separate reviewer checked receipt evidence' }),
  );
  await req(precisionOwner, 'billing/invoices/' + invoice.id, 404, { tenant: f.precisionTenant });
  await req(precisionOwner, `billing/invoices/${invoice.id}/pdf`, 404, {
    tenant: f.precisionTenant,
  });
  const pdf = await req(owner, `billing/invoices/${invoice.id}/pdf`);
  const pdfResponse = await fetch(pdf.url);
  check('Private signed invoice PDF downloads', pdfResponse.status, 200);
  check(
    'Invoice PDF has valid header',
    Buffer.from(await pdfResponse.arrayBuffer())
      .subarray(0, 8)
      .toString(),
    '%PDF-1.4',
  );
  const unsigned = new URL(pdf.url);
  unsigned.search = '';
  check('Unsigned invoice PDF is private', (await fetch(unsigned)).status, 403);
  await req(precision, `billing/invoices/${invoice.id}/pdf`, 403, { tenant: f.precisionTenant });
  job = await req(
    owner,
    `workorder/work-orders/${job.id}/ready-for-delivery`,
    200,
    post({ version: job.version, note: 'Quality, issued invoice and payment checked' }),
  );
  await move('DELIVERED');
  await move('CLOSED');
  const timeline = await req(
    vel,
    `customer/vehicles/${setup.vehicle.id}/timeline?branchId=${f.velachery.id}`,
  );
  check(
    'Velachery sees completed OMR financial service',
    timeline.content.some((x) => x.id === job.id),
    true,
  );
  check(
    'Cross-branch history uses consumed inventory references',
    timeline.content.find((x) => x.id === job.id).parts.some((p) => p.sku === part.sku),
    true,
  );
  await req(precision, 'workorder/work-orders/' + job.id, 404, { tenant: f.precisionTenant });
  let transfer = await req(
    owner,
    'inventory/inventory/transfers',
    200,
    post({
      sourceBranchId: f.omr.id,
      destinationBranchId: f.anna.id,
      items: [{ partId: part.id, quantity: 2 }],
      note: 'Replenish Anna Nagar',
    }),
  );
  for (const action of ['approve', 'dispatch'])
    transfer = await req(
      owner,
      `inventory/inventory/transfers/${transfer.id}/${action}`,
      200,
      post({ version: transfer.version, note: 'Authorized ' + action }),
    );
  transfer = await req(
    owner,
    `inventory/inventory/transfers/${transfer.id}/receive`,
    200,
    post({
      version: transfer.version,
      items: [{ partId: part.id, quantity: 1, damagedQuantity: 0 }],
      note: 'First physical receipt',
    }),
  );
  check('Transfer remains partial', transfer.status, 'PARTIALLY_RECEIVED');
  transfer = await req(
    owner,
    `inventory/inventory/transfers/${transfer.id}/receive`,
    200,
    post({
      version: transfer.version,
      items: [{ partId: part.id, quantity: 1, damagedQuantity: 0 }],
      note: 'Final receipt',
    }),
  );
  check('Transfer completes after full receipt', transfer.status, 'COMPLETED');
  const branchReferences = await req(inventoryActor, 'tenant/stock-transfer/branches?size=100');
  check(
    'Transfer branch references exclude another tenant',
    branchReferences.content.some((b) => b.id === f.precisionBranch.id),
    false,
  );
  let incoming = await req(
    inventoryActor,
    'inventory/inventory/transfers',
    200,
    post({
      sourceBranchId: f.anna.id,
      destinationBranchId: f.omr.id,
      items: [{ partId: part.id, quantity: 1 }],
      note: 'Scoped OMR employee requests stock from Anna Nagar',
    }),
  );
  await req(
    inventoryActor,
    `inventory/inventory/transfers/${incoming.id}/approve`,
    403,
    post({ version: incoming.version, note: 'Destination employee cannot approve source stock' }),
  );
  for (const action of ['approve', 'dispatch'])
    incoming = await req(
      owner,
      `inventory/inventory/transfers/${incoming.id}/${action}`,
      200,
      post({ version: incoming.version, note: 'Source-authorized ' + action }),
    );
  incoming = await req(
    inventoryActor,
    `inventory/inventory/transfers/${incoming.id}/receive`,
    200,
    post({
      version: incoming.version,
      items: [{ partId: part.id, quantity: 1, damagedQuantity: 0 }],
      note: 'Destination employee confirms physical receipt',
    }),
  );
  check(
    'Branch-only requester completes an authorized incoming transfer',
    incoming.status,
    'COMPLETED',
  );
  const creditKey = randomUUID(),
    credit = { amount: '25.00', reason: 'Approved synthetic post-service credit' };
  await req(owner, `billing/invoices/${invoice.id}/adjustments`, 200, post(credit, creditKey));
  await req(owner, `billing/invoices/${invoice.id}/adjustments`, 200, post(credit, creditKey));
  let credited = await req(owner, 'billing/invoices/' + invoice.id);
  check('Credit exposes customer refund due', Number(credited.refundDue), 25);
  const refundKey = randomUUID(),
    refund = {
      paymentId: payment.id,
      amount: '25.00',
      externalReference: 'M5-REFUND-' + randomUUID(),
      reason: 'Manual refund against approved synthetic credit',
    };
  await req(owner, 'billing/payments/refunds', 200, post(refund, refundKey));
  await req(owner, 'billing/payments/refunds', 200, post(refund, refundKey));
  credited = await req(owner, 'billing/invoices/' + invoice.id);
  check('Refund and credit preserve settled balance', Number(credited.outstanding), 0);
  check('Refund due clears after recorded refund', Number(credited.refundDue), 0);
  await req(
    owner,
    'billing/payments/refunds',
    409,
    post({ ...refund, amount: '1000.00', externalReference: 'M5-REFUND-' + randomUUID() }),
  );
  setup.lastAcceptance = {
    jobId: job.id,
    estimateId: estimate.id,
    invoiceId: invoice.id,
    partId: part.id,
    partSku: part.sku,
    transferId: transfer.id,
  };
  writeFileSync('.runtime/m5-fixtures.json', JSON.stringify(setup, null, 2));
  writeFileSync(
    '.runtime/m5-api-results.json',
    JSON.stringify({ passed: true, checks: results.length, results }, null, 2),
  );
  console.log(`M5 API checks passed: ${results.length}`);
} catch (error) {
  writeFileSync(
    '.runtime/m5-api-results.json',
    JSON.stringify(
      { passed: false, checks: results.length, results, error: error.message },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await browser.close();
}

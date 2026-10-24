import { call, createIdentity, signIn, select, invitationMail, origin } from './oidc.mjs';
// Development fixtures use the real reviewed workflow. No database status updates or production approval bypass.
export async function completeDevelopmentJob(context, tenant, order) {
  async function request(c, path, data, method = 'POST') {
    const r = await call(c, path, { tenant, method, data });
    if (!r.ok())
      throw new Error(
        'Workshop fixture ' + path + ' failed (' + r.status() + '): ' + (await r.json()).title,
      );
    return r.json();
  }
  const identity = await createIdentity('fixture-quality-reviewer');
  await request(context, 'tenant/tenants/' + tenant + '/invitations', {
    email: identity.email,
    role: 'BRANCH_MANAGER',
    branchIds: [order.branchId],
  });
  const mail = await invitationMail(identity.email);
  const reviewer = await context.browser().newContext();
  try {
    await signIn(await reviewer.newPage(), identity);
    const accepted = await request(reviewer, 'tenant/invitations/accept', { token: mail.token });
    await select(reviewer, tenant);
    await request(
      context,
      'tenant/tenants/' + tenant + '/staff/' + accepted.membershipId + '/capabilities',
      {
        branchId: order.branchId,
        qualityReview: true,
        safetyReview: false,
        version: 0,
        attestation: 'Synthetic local fixture: separate workshop quality reviewer',
      },
      'PATCH',
    );
    const me = await context.request.get(origin + '/api/auth/me').then((r) => r.json());
    const reviewerMe = await reviewer.request.get(origin + '/api/auth/me').then((r) => r.json());
    order = await request(context, 'workorder/work-orders/' + order.id + '/assign', {
      version: order.version,
      technicianId: me.user.id,
      reason: 'Synthetic fixture service technician',
    });
    async function move(status) {
      order = await request(context, 'workorder/work-orders/' + order.id + '/transition', {
        version: order.version,
        status,
        note: 'Synthetic development fixture workflow',
      });
    }
    if (order.status === 'CREATED') await move('CHECKED_IN');
    await move('INSPECTION');
    let inspection = await request(context, 'workorder/work-orders/' + order.id + '/inspections', {
      templateId: '00000000-0000-0000-0000-000000000410',
    });
    inspection = await request(
      context,
      'workorder/inspections/' + inspection.id,
      {
        version: inspection.version,
        findings: inspection.findings.map((f) => ({
          itemId: f.itemId,
          condition: 'GOOD',
          technicianNotes: 'Synthetic fixture observation',
          severity: 'LOW',
          photoReferences: [],
        })),
      },
      'PATCH',
    );
    await request(context, 'workorder/inspections/' + inspection.id + '/complete', {
      version: inspection.version,
    });
    await move('ESTIMATE_PENDING');
    await move('AWAITING_APPROVAL');
    order = await request(context, 'workorder/work-orders/' + order.id + '/development-approval', {
      version: order.version,
      decision: 'APPROVE',
      reason: 'Explicit local fixture simulation; no financial estimate approval',
    });
    await move('IN_PROGRESS');
    let task = await request(context, 'workorder/work-orders/' + order.id + '/tasks', {
      taskDescription: 'Synthetic fixture service visit',
      taskCategory: 'GENERAL',
      priority: 'NORMAL',
      estimatedDurationMinutes: 30,
      assignedTechnicianId: me.user.id,
    });
    order = await request(
      context,
      'workorder/work-orders/' + order.id + '/tasks/' + task.id + '/start',
      { version: task.version, status: 'IN_PROGRESS', note: 'Synthetic service started' },
    );
    task = order.tasks.find((t) => t.id === task.id);
    order = await request(
      context,
      'workorder/work-orders/' + order.id + '/tasks/' + task.id + '/complete',
      { version: task.version, status: 'COMPLETED', note: 'Synthetic service completed' },
    );
    order = await request(context, 'workorder/work-orders/' + order.id + '/quality-check', {
      version: order.version,
      reviewerId: reviewerMe.user.id,
    });
    const quality = order.qualityChecks.find((q) => q.status === 'PENDING');
    order = await request(
      reviewer,
      'workorder/work-orders/' + order.id + '/quality-check/approve',
      {
        version: quality.version,
        checklist: { repairsVerified: true, findingsReviewed: true, belongingsVerified: true },
        notes: 'Synthetic fixture reviewed by separate qualified workshop employee',
      },
    );
    await move('DELIVERED');
    await move('CLOSED');
    return order;
  } finally {
    await reviewer.close();
  }
}

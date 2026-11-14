import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { call, origin, select, signIn } from '../tests/helpers/oidc.mjs';
import { completeDevelopmentJob } from '../tests/helpers/workshop.mjs';

const env = readFileSync('.env', 'utf8');
if (process.env.MOTOROS_DEV_FIXTURES !== '1' || /^IDENTITY_SMTP_PROVIDER\s*=\s*"?gmail/im.test(env))
  throw new Error('Run with MOTOROS_DEV_FIXTURES=1 against the local Mailpit development stack.');
const f = JSON.parse(readFileSync('.runtime/m3-fixtures.json', 'utf8'));
if (!f.owner.email.endsWith('@example.test'))
  throw new Error('A synthetic fixture account is required.');
const manifest = '.runtime/franchise-demo.json';
if (existsSync(manifest)) {
  console.log('Franchise demo already seeded. See ' + manifest);
  process.exit(0);
}

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {},
);
const context = await browser.newContext({ baseURL: origin });
const tid = f.tenant;
const tag = randomUUID().slice(0, 6);
const homes = [
  ['Adyar QA', 'QA-ADYAR'],
  ['Porur QA', 'QA-PORUR'],
];
const roster = [
  ['Anika Rao', 'Honda', 'City'],
  ['Arjun Kumar', 'Hyundai', 'i20'],
  ['Diya Menon', 'Tata', 'Nexon'],
  ['Ishan Roy', 'Maruti Suzuki', 'Swift'],
  ['Kavya Iyer', 'Mahindra', 'XUV300'],
  ['Meera Das', 'Toyota', 'Glanza'],
  ['Neel Nair', 'Kia', 'Sonet'],
  ['Priya Shah', 'Skoda', 'Slavia'],
  ['Rohan Singh', 'Honda', 'Amaze'],
  ['Sana Ali', 'Hyundai', 'Venue'],
  ['Varun Bose', 'Tata', 'Punch'],
  ['Zoya Patel', 'Renault', 'Kiger'],
];
const catalog = [
  ['Engine oil filter', 'Filters', 480],
  ['Cabin pollen filter', 'Filters', 690],
  ['Front brake pad set', 'Brakes', 2650],
  ['Wiper blade pair', 'Visibility', 920],
  ['Air intake filter', 'Filters', 740],
  ['Spark plug set', 'Ignition', 1450],
  ['Brake fluid 500 ml', 'Fluids', 560],
  ['Accessory drive belt', 'Engine', 1240],
];
const complaints = [
  'Periodic service and engine oil filter replacement',
  'Brake noise during low speed stops',
  'Inspect weak cabin airflow',
  'Replace worn windshield wipers',
  'Inspect a rough cold start',
  'Check accessory belt squeal',
  'Seasonal maintenance check',
  'Inspect intermittent vibration',
];
const nextDays = [];
for (let day = 2; nextDays.length < 8; day++) {
  const date = new Date(Date.now() + day * 86_400_000);
  if ([1, 2, 3, 4, 5].includes(date.getUTCDay())) nextDays.push(date.toISOString().slice(0, 10));
}
const counts = {
  branches: 0,
  customers: 0,
  vehicles: 0,
  appointments: 0,
  jobs: 0,
  estimates: 0,
  catalogParts: 0,
  stockReceipts: 0,
};

async function request(path, method = 'GET', data) {
  const response = await call(context, path, { tenant: tid, method, data });
  if (!response.ok()) {
    const { title, detail } = await response.json().catch(() => ({}));
    throw new Error(
      method + ' ' + path + ' returned ' + response.status() + ' ' + (detail || title || ''),
    );
  }
  return response.json();
}

try {
  await signIn(await context.newPage(), f.owner);
  await select(context, tid);
  const directory = await request('tenant/branches?size=100');
  const branches = [f.anna, f.velachery, f.omr].map(({ id }) =>
    directory.find((branch) => branch.id === id),
  );
  if (branches.some((branch) => !branch || branch.status !== 'ACTIVE'))
    throw new Error('Expected all three active Apex fixture branches.');
  for (const [name, branchCode] of homes)
    branches.push(
      directory.find((branch) => branch.branchCode === branchCode) ??
        (await request('tenant/branches', 'POST', { name, branchCode, city: 'Chennai' })),
    );
  counts.branches = branches.length;
  const parts = [];
  for (const [name, category, price] of catalog)
    parts.push(
      await request('inventory/parts', 'POST', {
        sku: 'DEMO-' + tag + '-' + (parts.length + 1),
        name,
        category,
        active: true,
        manufacturer: 'MotorOS Demo Supply',
        currency: 'INR',
        sellingPrice: price,
        purchasePrice: Math.floor(price * 0.6),
      }),
    );
  counts.catalogParts = parts.length;

  const demos = [];
  for (const [branchIndex, branch] of branches.entries()) {
    const current = await request('tenant/branches/' + branch.id);
    if (!Object.keys(current.operatingHours ?? {}).length) {
      const operatingHours = Object.fromEntries(
        ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'].map((day) => [
          day,
          { open: '09:00', close: '18:00' },
        ]),
      );
      await request('tenant/branches/' + branch.id, 'PATCH', {
        ...current,
        operatingHours,
        settings: { ...current.settings, appointmentCapacity: 2 },
      });
    }
    const before = await call(context, 'billing/billing/settings?branchId=' + branch.id, {
      tenant: tid,
    });
    if (before.status() === 404) {
      await request('billing/billing/settings', 'PUT', {
        branchId: branch.id,
        currency: 'INR',
        laborHourlyRate: 650,
        taxRate: 18,
        legalName: 'Apex Motorworks Demo',
        address: 'Synthetic workshop, Chennai',
        taxLabel: 'Demo GST',
        paymentRequiredBeforeDelivery: false,
        version: 0,
      });
    } else if (!before.ok()) {
      throw new Error('Cannot read branch pricing: ' + before.status());
    }
    for (const [i, part] of parts.entries()) {
      await request('inventory/inventory/receipts', 'POST', {
        branchId: branch.id,
        partId: part.id,
        quantity: 8 + ((i + branchIndex * 3) % 15),
        reason: 'Simulated opening stock',
      });
      counts.stockReceipts++;
    }
    const jobs = [];
    let sampleVehicle;
    for (const [i, [name, make, model]] of roster.entries()) {
      const customer = await request('customer/customers', 'POST', {
        name: name + ' (Demo)',
        email: 'apex-demo-' + tag + '-' + branchIndex + '-' + i + '@example.test',
        city: 'Chennai',
        country: 'India',
      });
      counts.customers++;
      const vehicle = await request('customer/vehicles', 'POST', {
        branchId: branch.id,
        customerId: customer.id,
        registration: 'DM' + tag.toUpperCase() + branchIndex + i,
        make,
        model,
        year: 2019 + (i % 7),
      });
      counts.vehicles++;
      sampleVehicle ??= vehicle.id;
      if (i < 6) {
        let appointment = await request('booking/appointments', 'POST', {
          branchId: branch.id,
          customerId: customer.id,
          vehicleId: vehicle.id,
          serviceCategoryId: '00000000-0000-0000-0000-000000000401',
          requestedStartTime: nextDays[i] + 'T08:30:00Z',
          estimatedDurationMinutes: 60,
          customerComplaint: complaints[i],
          bookingSource: 'STAFF',
        });
        if (i < 4)
          appointment = await request(
            'booking/appointments/' + appointment.id + '/confirm',
            'POST',
            {
              version: appointment.version,
              note: 'Simulated booking confirmed',
            },
          );
        counts.appointments++;
      }
      if (i >= 8) continue;
      let job;
      if (i < 6) {
        const intake = await request('workorder/check-ins', 'POST', {
          branchId: branch.id,
          customerId: customer.id,
          vehicleId: vehicle.id,
          odometerKilometers: 18000 + 4100 * i,
          complaints: complaints[i],
          serviceRequested: 'Synthetic scheduled service',
          accessories: [],
        });
        job = await request('workorder/work-orders/' + intake.workOrderId);
      } else
        job = await request('workorder/work-orders', 'POST', {
          branchId: branch.id,
          vehicleId: vehicle.id,
          customerId: customer.id,
          complaint: complaints[i],
        });
      jobs.push(job.id);
      counts.jobs++;
      if (i === 0) {
        await completeDevelopmentJob(context, tid, job);
      } else if (i < 5) {
        if (i < 3)
          await request('workorder/work-orders/' + job.id + '/transition', 'POST', {
            version: job.version,
            status: 'INSPECTION',
            note: 'Simulated inspection started',
          });
        await request('workorder/work-orders/' + job.id + '/parts', 'POST', {
          description: parts[i].name,
          quantity: 1,
        });
        await request('billing/estimates', 'POST', {
          branchId: branch.id,
          workOrderId: job.id,
          expiresAt: new Date(Date.now() + 7 * 86_400_000),
          note: 'Synthetic estimate for ' + complaints[i],
          items: [
            {
              itemType: 'PART',
              partId: parts[i].id,
              description: parts[i].name,
              quantity: '1',
              unitPrice: '0',
              discountPercent: '0',
            },
            {
              itemType: 'LABOR',
              description: 'Inspection and fitting',
              quantity: '1',
              unitPrice: '0',
              discountPercent: '0',
            },
          ],
        });
        counts.estimates++;
      }
    }
    demos.push({ id: branch.id, name: branch.name, vehicleId: sampleVehicle, jobId: jobs[1] });
    console.log('Seeded ' + branch.name);
  }
  const first = await request('customer/vehicles/' + demos[0].vehicleId);
  const returnJob = await request('workorder/work-orders', 'POST', {
    branchId: demos[2].id,
    customerId: first.customerId,
    vehicleId: first.id,
    complaint: 'Synthetic follow-up at a second Apex branch',
  });
  await completeDevelopmentJob(context, tid, returnJob);
  counts.jobs++;
  mkdirSync('.runtime', { recursive: true });
  writeFileSync(manifest, JSON.stringify({ branches: demos, counts }, null, 2) + '\n');
  console.log(JSON.stringify(counts));
} finally {
  await browser.close();
}

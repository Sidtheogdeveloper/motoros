# Milestone 12 — Customer communication assistant

Open **Notifications → AI message composer** from an authorized branch. Select the purpose and an existing appointment, job, estimate, invoice, or payment. The composer identifies the linked customer and vehicle, shows the sourced facts and a localized preview, and lets staff change the tone, language, and optional detail. Staff must approve the exact saved version and then confirm sending as a separate step. Edits require approval again.

## Supported workflows

- Appointment confirmation, reminder, and reschedule
- Vehicle check-in, inspection completion, repair progress, and collection readiness
- Estimate approval request and approved estimate explanation
- Invoice availability and recorded payment confirmation
- Service completion follow-up and optional maintenance reminder

The existing English and Tamil templates and the verified facts determine the message body. The model can suggest professional, friendly, or concise tone from the purpose, channel, and language. It receives no names, contacts, amounts, record identifiers, approval links, or message bodies. Unsupported model output or a provider outage falls back to professional tone. Staff edits use controlled options so the workflow can continue to verify every factual assertion.

## Authorization and delivery

The Intelligence gateway forwards the original user bearer. Notification independently checks assistant permission, notification management, branch membership, and the applicable source-read permission. Its machine-only lookup resolves a committed source event by tenant and branch. The source proof confirms current status and links the customer and vehicle. Customer independently confirms current vehicle ownership and resolves the contact and channel consent. Optional maintenance messages also require promotional consent.

Notification encrypts draft previews and queued content. Its Flyway migration `V6` adds short-lived staff-owned drafts, version checks, audit records, and an assistant marker on the existing delivery queue. The staff member who generated the draft can edit, approve, or queue it in that branch. The queue uses a unique request and replays an already queued request on retry. It uses the same retry and delivery history infrastructure as other notifications.

The delivery worker rechecks source facts, current consent, recipient and approval expiry before provider acceptance. Estimate approval emails use the existing secure Billing link, which is appended only at delivery. A provider acceptance is distinct from proof of delivery or reading.

## Endpoints

| Method | Intelligence endpoint |
| --- | --- |
| POST | `/api/ai/communications/draft` |
| GET | `/api/ai/communications/drafts?branchId={id}&page=0` |
| PATCH | `/api/ai/communications/drafts/{id}` |
| POST | `/api/ai/communications/drafts/{id}/approve` |
| POST | `/api/ai/communications/drafts/{id}/send` |

The Intelligence endpoints call Notification's authorized assistant endpoints. Drafts and audit data are owned by Notification. The orchestrator does not maintain a second copy. Set `AI_NOTIFICATION_URL` when the service is on a nondefault host or port.

## Verification and limits

Milestone 11's Analytics browser regression passed before implementation and after the final restart. The Milestone 12 Edge scenario generated a Tamil check-in message for a synthetic customer and vehicle, verified the facts, edited and reapproved the draft, rejected send before approval and after opt-out, queued the approved version once, and verified the staff-approved email in Mailpit. Mechanic and cross-tenant send attempts were denied.

All 58 Python tests passed. The Notification and shared Java suites passed, including stale appointment times, verified invoice amounts, blocked refund confirmation, stable approval fingerprints and provider policy. The frontend production build and type check passed, the Notification Flyway migration ran on the synthetic PostgreSQL database, and the secret scan found no matches. The checked-in Notification OpenAPI contract includes the five assistant operations.

Local email uses Mailpit and the existing development recipient restriction. SMS and WhatsApp use development captures. Production SMS and WhatsApp Business provider configuration and hosted inference are unverified. No live customer message was used for local acceptance.

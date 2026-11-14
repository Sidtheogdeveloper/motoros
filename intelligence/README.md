# MotorOS Intelligence local development

The core application still starts with `npm run dev`. AI runs as a separate, optional FastAPI process. The vehicle profile shows an unavailable state when AI is unconfigured.

## Optional Compose stack

Start the ordinary local stack first. Use an isolated Mailpit development installation with existing Milestone 3 synthetic fixtures for testing. Create an ignored `intelligence/.env.ai` file with independent random hexadecimal values:

```dotenv
AI_DB_PASSWORD=<random hex password>
AI_BFF_KEY=<random hex gateway key, at least 32 characters>
AI_PROVIDER=disabled
```

Set the same `AI_BFF_KEY` in the core frontend's process environment or ignored root `.env`. Restart the frontend to load it. The AI database password belongs only in the AI Compose environment file.

From the repository root:

```text
docker compose --env-file intelligence/.env.ai -f intelligence/compose.yaml up --build -d
curl http://127.0.0.1:8089/healthz
```

The optional stack has its own local database and persistent volume. It runs Alembic before starting the orchestrator. The orchestrator subscribes its dedicated history queue to the local Customer and Work Order topics on port 4566. Set `AI_SQS_ENDPOINT` if the default `http://host.docker.internal:4566` is unreachable from Docker. For a direct host run, set `AI_HISTORY_LOCAL_EVENTS=true` and `AI_SQS_ENDPOINT=http://127.0.0.1:4566`. Only the orchestrator binds a loopback port. Configure `AI_CUSTOMER_URL` and `AI_TENANT_URL` if the container cannot reach the host APIs through `host.docker.internal`. On hosts without Docker Desktop, those names and host access require explicit setup. The AI process can also run directly on the host using an AI-owned PostgreSQL database:

```text
cd intelligence/ai-orchestrator
python -m pip install ".[test]"
python -m alembic upgrade head
python -m uvicorn motoros_ai.app:app --host 127.0.0.1 --port 8089 --no-access-log --limit-concurrency 16
```

Provide `AI_DATABASE_URL` as a `postgresql+psycopg://` URL through the process environment. Run cache retention cleanup from the orchestrator environment with `python -m motoros_ai.maintenance`.

## Hosted NVIDIA Nemotron

NVIDIA lists Nemotron 3 Ultra as a free prototype endpoint. MotorOS uses it to select numbered evidence, then validates the selection and renders the source records locally. [NVIDIA model and API example](https://build.nvidia.com/nvidia/nemotron-3-ultra-550b-a55b?nim=hosted)

Start with synthetic records. When enabled, the hosted endpoint receives evidence text such as workshop notes, which may contain personal information. The provider credential belongs only to the orchestrator.

Set these non-secret options in the ignored `intelligence/.env.ai`:

```dotenv
AI_PROVIDER=nvidia
AI_ALLOW_NVIDIA=true
AI_MODEL=nvidia/nemotron-3-ultra-550b-a55b
```

From PowerShell at the repository root, enter a fresh key at the hidden prompt and rebuild the optional stack:

```powershell
$motorosNvidiaSecret = Read-Host 'NVIDIA API key' -AsSecureString
try {
  $env:NVIDIA_API_KEY = [System.Net.NetworkCredential]::new('', $motorosNvidiaSecret).Password
  docker compose --env-file intelligence/.env.ai -f intelligence/compose.yaml up --build -d
} finally {
  Remove-Item Env:NVIDIA_API_KEY -ErrorAction SilentlyContinue
  $motorosNvidiaSecret.Dispose()
}
```

The running orchestrator retains its configured credential. Supply it again when recreating the container. The core frontend still uses only the shared BFF gateway key. Open a vehicle profile, choose **Intelligence**, and select **Generate AI summary**.

## Other inference providers and verification

For a separately installed local Ollama instance, set `AI_PROVIDER=ollama`, `AI_MODEL` to an installed model, and `AI_OLLAMA_URL` to its private endpoint. Containerized Ollama routing is an operator setting. Use synthetic data when evaluating models.

Bedrock's adapter uses Converse. It requires `AI_PROVIDER=bedrock`, `AI_ALLOW_BEDROCK=true`, a configured `AI_MODEL` identical to `AI_BEDROCK_APPROVED_MODEL`, and workload credentials. The local Compose definition does not wire Bedrock opt-in or AWS credentials. Confirm Converse compatibility, in-region availability, IAM, routing and data handling before enabling Bedrock. The default region is `ap-south-1`. [AWS Converse API](https://docs.aws.amazon.com/bedrock/latest/userguide/conversation-inference.html)

Run `python -m pytest -q` from `ai-orchestrator` for deterministic fixtures. For the live local browser gate, configure Ollama or NVIDIA and start a separate Mailpit stack. Set `MOTOROS_DEV_FIXTURES=1` and run `npm run fixtures:m3` and `node scripts/milestone8-fixtures.mjs` to prepare completed visits in Anna Nagar and OMR. After fixture events settle, run the browser check below. For NVIDIA, set `MOTOROS_TEST_AI_PROVIDER=nvidia`. Then opt in with `MOTOROS_TEST_LOCAL_AI=1` and run `npm run test:e2e -- intelligence-history.spec.ts` from the repository root.

## Mechanic Copilot

Open a job card and choose **Copilot**. The brand owner can open **Manage approved workshop documents** to index a licensed PDF or text file, replace it with a new version, or remove it. Use synthetic jobs and documents when evaluating a hosted provider. Conversations are private to the signed-in staff member. Set `AI_COPILOT_RETENTION_DAYS` to change the default of 30 days and run the maintenance command to physically remove expired conversations.

With the isolated Mailpit stack, M3 fixtures and a configured local or hosted provider, set `MOTOROS_TEST_LOCAL_AI=1` and run `npm run test:e2e -- mechanic-copilot.spec.ts` from the repository root.

## Repair estimate drafting

Sign in as a service advisor or workshop owner with estimate creation, work-order read and inventory read access. Open a job with a linked customer and choose **Generate estimate draft with AI** under **AI estimate assistant**. Select verified parts, confirm quantities and enter labor hours. **Calculate and save Billing draft** opens the standard Billing editor, where **Recalculate and save** uses current prices. Review the amounts before using **Send to customer for approval**. Selecting an existing draft replaces its lines; submitted estimates require a revision.

Run Alembic to revision `0004_estimates` before using the assistant. The orchestrator reads Booking, Inventory and Billing through `AI_BOOKING_URL`, `AI_INVENTORY_URL` and `AI_BILLING_URL`. The Compose defaults resolve to host ports 8084, 8085 and 8086. With no model enabled, the assistant still returns matching catalog evidence and manual review prompts. An estimate inference request contains only numbered match signals, not raw workshop or customer data.

To exercise the end-to-end flow, use the isolated synthetic Mailpit stack with M3 fixtures, set `MOTOROS_TEST_ESTIMATE_LOCAL=1`, and run `npm run test:e2e -- estimate-intelligence.spec.ts`. Do not run fixture submission against a realm configured to send through a real mail provider. See the [Milestone 10 report](../docs/milestones/MILESTONE_10_REPORT.md).

## Analytics Intelligence

Open **Reporting** as a brand owner or an assigned regional or branch manager. Start with a suggested question or ask about bookings, repairs, invoice value, recorded collections, estimates, parts or repeat customers. Use **By month** or **By branch** to follow up, then inspect a chart value or export the authorized table. Dates are UTC and the end is exclusive. “Revenue” defaults to recorded payments less refunds.

The orchestrator reaches the existing Analytics Service through `AI_ANALYTICS_URL`. Run the Java migrations and Alembic before opening the workspace. Analytics works with inference disabled. The chart and financial calculations use the Analytics Service's verified projections. Legacy rows receive the newly required business dates through the existing reconciliation workers.

For local browser acceptance, start the isolated Mailpit stack with synthetic Milestone 3 and 8 fixtures, set `MOTOROS_TEST_ANALYTICS_LOCAL=1`, and run `npm run test:e2e -- analytics-intelligence.spec.ts`. The test creates a synthetic branch manager invitation in Mailpit. See the [Milestone 11 report](../docs/milestones/MILESTONE_11_REPORT.md).

## Customer communication assistant

Open **Notifications → AI message composer** as authorized workshop staff. Select a record and message type, review the linked customer and vehicle, then choose English or Tamil and a tone. Save any edits, approve the exact preview, and explicitly confirm sending. The status appears in both the composer and notification history.

Notification owns the drafts and consent-aware delivery. Apply its Flyway migration before use. Set `AI_NOTIFICATION_URL` if Notification is not on its default host or port. Inference is optional. Local email uses Mailpit and synthetic addresses, and local SMS and WhatsApp use development captures.

For browser acceptance, use the isolated synthetic stack and set `MOTOROS_TEST_COMMUNICATION_LOCAL=1` before running `npm run test:e2e -- communication-assistant.spec.ts`. See the [Milestone 12 report](../docs/milestones/MILESTONE_12_REPORT.md).

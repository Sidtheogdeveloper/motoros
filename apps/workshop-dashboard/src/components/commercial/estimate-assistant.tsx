'use client';

import { useRef, useState, type FormEvent } from 'react';
import { Button } from '../ui/button';

type Source = { id: string; kind: string; label: string };
type Revision = { id: string; version: number; revision: number; status: string };
type Draft = {
  estimateDraftId: string;
  mode: 'model_ranked' | 'evidence_only';
  suggestedItems: {
    partId: string;
    description: string;
    quantity: string | null;
    available: string | null;
    sku: string;
    source: Source;
  }[];
  requiredReviewItems: string[];
  missingPricingInformation: string[];
  warnings: string[];
  sourceReferences: Source[];
  serviceDescriptions: { id: string; name: string }[];
  existingEstimates: Revision[];
  explanation: string;
};
type Line = {
  key: string;
  partId: string | null;
  description: string;
  quantity: string;
  selected: boolean;
};

export function EstimateAssistant({ jobId, tenant }: { jobId: string; tenant: string }) {
  const requestId = useRef<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [note, setNote] = useState('');
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function request<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch('/api/ai/estimates/' + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-MotorOS-Expected-Tenant': tenant },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
    const payload = await response.json();
    if (!response.ok)
      throw new Error(
        typeof payload.title === 'string'
          ? payload.title
          : 'Review the selected items and use a positive quantity with up to three decimal places.',
      );
    return payload;
  }

  async function generate(refresh: boolean) {
    setBusy(true);
    setError('');
    if (refresh) requestId.current = null;
    requestId.current ??= crypto.randomUUID();
    try {
      const proposal = await request<Draft>('draft', {
        workOrderId: jobId,
        requestId: requestId.current,
      });
      setDraft(proposal);
      setTarget('');
      setNote('');
      setLines(
        proposal.suggestedItems.map((item) => ({
          key: item.partId,
          partId: item.partId,
          description: item.description,
          quantity: item.quantity ?? '',
          selected: false,
        })),
      );
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not prepare the draft.');
    } finally {
      setBusy(false);
    }
  }

  function change(key: string, fields: Partial<Line>) {
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...fields } : line)),
    );
  }

  async function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || busy) return;
    const items = lines
      .filter((line) => line.selected)
      .map(({ partId, description, quantity }) => ({ partId, description, quantity }));
    if (!items.length) return;
    const revision = draft.existingEstimates.find((item) => item.id === target);
    setBusy(true);
    setError('');
    try {
      const result = await request<{ id: string }>('drafts/' + draft.estimateDraftId + '/apply', {
        items,
        note,
        ...(revision ? { estimateId: revision.id, version: revision.version } : {}),
      });
      window.location.assign('/estimates/' + result.id);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not save the estimate in Billing.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="notice intelligence-entry"
      aria-label="AI estimate assistant"
      aria-busy={busy}
    >
      <h3>AI estimate assistant</h3>
      <p>
        Review workshop evidence, select catalog parts, and send a draft to Billing for pricing.
      </p>
      {error && <p role="alert">{error}</p>}
      {!draft ? (
        <Button type="button" disabled={busy} onClick={() => void generate(false)}>
          {busy ? 'Checking workshop records…' : 'Generate estimate draft with AI'}
        </Button>
      ) : (
        <>
          <p role="status">
            {draft.mode === 'evidence_only'
              ? 'Showing verified evidence matches.'
              : 'Showing AI-ranked evidence matches.'}{' '}
            Choose each line you want to keep.
          </p>
          <form onSubmit={apply} className="stack">
            {lines.map((line) => {
              const item = draft.suggestedItems.find((part) => part.partId === line.partId);
              return (
                <fieldset key={line.key}>
                  <legend>{item?.description ?? 'Labor'}</legend>
                  <label>
                    <input
                      type="checkbox"
                      checked={line.selected}
                      onChange={(event) => change(line.key, { selected: event.target.checked })}
                    />{' '}
                    Include {item?.description ?? 'labor'}
                  </label>
                  {item && (
                    <p className="muted">
                      {item.sku} · {item.source.label} · {item.available ?? 'Unknown'} in branch
                      stock. Catalog price verified by Billing on save.
                    </p>
                  )}
                  {line.selected && (
                    <>
                      <label>
                        Line description
                        <input
                          required
                          value={line.description}
                          maxLength={500}
                          onChange={(event) =>
                            change(line.key, { description: event.target.value })
                          }
                        />
                      </label>
                      <label>
                        {item ? 'Part quantity' : 'Labor hours'}
                        <input
                          type="number"
                          required
                          step="0.001"
                          min="0.001"
                          max="10000"
                          value={line.quantity}
                          onChange={(event) => change(line.key, { quantity: event.target.value })}
                        />
                      </label>
                    </>
                  )}
                </fieldset>
              );
            })}
            {draft.suggestedItems.length === 0 && (
              <p>
                No matching parts were found. Review the evidence and add labor or continue in
                Billing.
              </p>
            )}
            <Button
              type="button"
              variant="outline"
              disabled={busy || lines.length >= 20}
              onClick={() =>
                setLines((current) => [
                  ...current,
                  {
                    key: crypto.randomUUID(),
                    partId: null,
                    description: '',
                    quantity: '',
                    selected: true,
                  },
                ])
              }
            >
              Add labor
            </Button>
            <details>
              <summary>Sources and items to verify</summary>
              <ul>
                {draft.sourceReferences.map((source, index) => (
                  <li key={source.id + ':' + index}>
                    {source.label} <span className="muted">({source.kind})</span>
                  </li>
                ))}
              </ul>
              {draft.serviceDescriptions.map((service) => (
                <p key={service.id}>
                  {service.name} · Booking catalog match; confirm scope and pricing.
                </p>
              ))}
              <ul>
                {[
                  ...draft.requiredReviewItems,
                  ...draft.missingPricingInformation,
                  ...draft.warnings,
                ].map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </details>
            <details>
              <summary>Customer explanation preview</summary>
              <p>{draft.explanation}</p>
              <Button type="button" variant="outline" onClick={() => setNote(draft.explanation)}>
                Use as estimate note
              </Button>
            </details>
            <label>
              Estimate note
              <textarea
                value={note}
                maxLength={2000}
                onChange={(event) => setNote(event.target.value)}
              />
            </label>
            {draft.existingEstimates.length > 0 && (
              <label>
                Billing draft destination
                <select value={target} onChange={(event) => setTarget(event.target.value)}>
                  <option value="">Create a new estimate draft</option>
                  {draft.existingEstimates
                    .filter((revision) => revision.status === 'DRAFT')
                    .map((revision) => (
                      <option key={revision.id} value={revision.id}>
                        Replace lines in revision {revision.revision} (version {revision.version})
                      </option>
                    ))}
                </select>
              </label>
            )}
            {target && (
              <p>
                The selected lines will replace the existing draft lines. Submitted revisions are
                protected.
              </p>
            )}
            <div className="actions">
              <Button type="submit" disabled={busy || !lines.some((line) => line.selected)}>
                {busy ? 'Saving in Billing…' : 'Calculate and save Billing draft'}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => void generate(true)}
              >
                Refresh evidence
              </Button>
            </div>
          </form>
        </>
      )}
    </section>
  );
}

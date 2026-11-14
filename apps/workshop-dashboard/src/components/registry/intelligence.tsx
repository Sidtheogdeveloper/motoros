'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Issue, useAccount, type Branch } from './shared';

type Summary = {
  summaryId: string | null;
  helpful: boolean | null;
  modelIdentifier: string;
  generatedAt: string;
  response: {
    vehicleOverview: string;
    recordedVisits: number;
    repeatedComplaints: { text: string; sourceIds: string[] }[];
    highlights: { id: number; category: string; text: string; resourceId: string }[];
  };
  sourceReferences: { resourceId: string; branch: string; date: string }[];
  warnings: string[];
  usageMetadata: { cacheHit: boolean };
};

export function VehicleIntelligence({ id, branches }: { id: string; branches: Branch[] }) {
  const { activeTenant } = useAccount();
  const active = branches.filter((branch) => branch.status === 'ACTIVE');
  const [selected, select] = useState('');
  const branch = active.find((entry) => entry.id === selected)?.id || active[0]?.id;

  return (
    <section className="panel registry-summary">
      <span className="eyebrow">MOTOROS INTELLIGENCE</span>
      <h2>Vehicle health &amp; service history</h2>
      <label>
        Viewing from branch
        <select value={branch || ''} onChange={(event) => select(event.target.value)}>
          {active.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </select>
      </label>
      {branch && activeTenant ? (
        <HistorySummary
          key={`${activeTenant}/${id}/${branch}`}
          id={id}
          tenant={activeTenant}
          branch={branch}
        />
      ) : (
        <p>No active authorized branch.</p>
      )}
    </section>
  );
}

function HistorySummary({ id, tenant, branch }: { id: string; tenant: string; branch: string }) {
  const [attempt, generate] = useState(0);
  const [summary, setSummary] = useState<Summary>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [voting, setVoting] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState('');

  async function vote(helpful: boolean) {
    const summaryId = summary?.summaryId;
    if (!summaryId) return;
    setVoting(true);
    setFeedbackMessage('');
    try {
      const query = new URLSearchParams({ branchId: branch, summaryId, helpful: String(helpful) });
      const response = await fetch(`/api/ai/vehicles/${id}/history-feedback?${query}`, {
        method: 'POST',
        headers: { 'X-MotorOS-Expected-Tenant': tenant },
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.title || 'Feedback could not be saved.');
      setSummary((current) =>
        current?.summaryId === summaryId ? { ...current, helpful: result.helpful } : current,
      );
      setFeedbackMessage('Feedback saved.');
    } catch (failure) {
      setFeedbackMessage(
        failure instanceof Error ? failure.message : 'Feedback could not be saved.',
      );
    } finally {
      setVoting(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    const method = attempt > 0 ? 'POST' : 'GET';
    const action = attempt > 0 ? 'history-summary' : 'history-summaries';
    setLoading(true);
    setError('');
    fetch(`/api/ai/vehicles/${id}/${action}?branchId=${encodeURIComponent(branch)}`, {
      method,
      headers: { 'X-MotorOS-Expected-Tenant': tenant },
      signal: controller.signal,
      cache: 'no-store',
    })
      .then(async (response) => {
        const data = await response.json();
        if (controller.signal.aborted) return;
        if (response.status === 401) window.location.assign('/session-expired');
        if (response.status === 409 && data.code === 'TENANT_CONTEXT_CHANGED')
          window.location.reload();
        if (!response.ok) throw new Error(data.title || 'History summary unavailable.');
        setSummary(method === 'GET' ? data.summaries[0] : data);
      })
      .catch((failure) => {
        if (!controller.signal.aborted) {
          setError(failure.message);
          setSummary(undefined);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [attempt, branch, id, tenant]);

  const sections = [
    { title: 'Reported problems', categories: ['Reported complaint'] },
    { title: 'Previous repairs and parts', categories: ['Completed repair', 'Recorded part use'] },
    { title: 'Mileage observations', categories: ['Odometer'] },
    { title: 'Technician observations', categories: ['Technician observation'] },
    { title: 'Recommendations to verify', categories: ['Recorded recommendation'] },
  ];
  const anchor = (resource: string) => `summary-source-${resource}`;
  return (
    <>
      <p>Review highlights from completed visits alongside their source records.</p>
      <Button
        disabled={loading || voting}
        onClick={() => {
          setFeedbackMessage('');
          generate((value) => value + 1);
        }}
      >
        {summary ? 'Check for updated summary' : 'Generate AI summary'}
      </Button>
      <Issue error={error} loading={loading} />
      {summary && !loading && (
        <div>
          <h3>{summary.response.vehicleOverview || 'Vehicle overview'}</h3>
          <p>{summary.response.recordedVisits} completed visits reviewed.</p>
          <p>
            {summary.modelIdentifier === 'none' ? 'No model called' : summary.modelIdentifier} ·{' '}
            {new Date(summary.generatedAt).toLocaleString()}
            {summary.usageMetadata.cacheHit && ' · cached selection'}
          </p>
          {sections.map((section) => {
            const items = summary.response.highlights.filter((item) =>
              section.categories.includes(item.category),
            );
            if (!items.length) return null;
            return (
              <div key={section.title}>
                <h3>{section.title}</h3>
                {section.title === 'Recommendations to verify' && (
                  <p>Check whether these recorded concerns still need inspection.</p>
                )}
                <ul>
                  {items.map((item) => (
                    <li key={item.id}>
                      <strong>{item.category}</strong> {item.text}{' '}
                      <a href={`#${anchor(item.resourceId)}`}>Source</a>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          {summary.response.repeatedComplaints.length > 0 && (
            <>
              <h3>Repeated recorded complaints</h3>
              <ul>
                {summary.response.repeatedComplaints.map((complaint) => (
                  <li key={complaint.text}>
                    {complaint.text}{' '}
                    {complaint.sourceIds.map((source, index) => (
                      <a key={source} href={`#${anchor(source)}`}>
                        {' '}
                        Visit {index + 1}{' '}
                      </a>
                    ))}
                  </li>
                ))}
              </ul>
            </>
          )}
          <h3>Missing information and review notes</h3>
          {summary.warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
          {summary.summaryId && (
            <div role="group" aria-label="Summary feedback">
              <Button
                variant="ghost"
                disabled={voting}
                aria-pressed={summary.helpful === true}
                onClick={() => void vote(true)}
              >
                Helpful
              </Button>
              <Button
                variant="ghost"
                disabled={voting}
                aria-pressed={summary.helpful === false}
                onClick={() => void vote(false)}
              >
                Not helpful
              </Button>
              <p role="status">{feedbackMessage}</p>
            </div>
          )}
          {summary.sourceReferences.length > 0 && (
            <>
              <h3>Source records</h3>
              <ul>
                {summary.sourceReferences.map((source, index) => (
                  <li key={source.resourceId} id={anchor(source.resourceId)}>
                    {source.branch} · {new Date(source.date).toLocaleDateString()} ·{' '}
                    <a
                      href={`/vehicles/${id}/timeline?historyBranch=${branch}&historyPage=${Math.floor(index / 20)}#service-record-${source.resourceId}`}
                    >
                      Open service record
                    </a>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
      <a href={`/vehicles/${id}/timeline`}>Open authorized service timeline</a>
    </>
  );
}

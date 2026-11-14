'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '../ui/button';

type Branch = { id: string; name: string };
type Row = { key: string; label: string; currency: string | null; value: string };
type Spec = {
  metric: string;
  groupBy: string;
  branchIds: string[];
  currency: string | null;
  dateRange: { start: string; end: string };
};
type Result = {
  queryId: string;
  title: string;
  answer: string;
  definition: string;
  explanation: string;
  rows: Row[];
  chart: { type: 'kpi' | 'line' | 'bar' };
  spec: Spec;
  unit: string;
  asOf: string;
  freshness: { branchId: string; producer: string; projectedAt: string }[];
  staleBranchIds: string[];
  limitations: string[];
};
type History = {
  queries: { id: string; question: string; spec: Spec }[];
  nextOffset: number | null;
};
const suggestions = [
  'Which branch generated the most revenue last month?',
  'Compare service volume across all branches',
  'Show monthly revenue trends this year',
  'How many invoices remain unpaid?',
  'What percentage of estimates are approved?',
  'What are our most frequently replaced parts?',
];

function chartValues(rows: Row[]) {
  const values = rows.map((row) => Number(row.value));
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const y = (value: number) => 166 - ((value - min) / (max - min || 1)) * 140;
  return { values, y };
}

function MetricChart({ rows, kind, unit }: { rows: Row[]; kind: 'line' | 'bar'; unit: string }) {
  const [series, setSeries] = useState(rows[0]?.currency ?? '');
  const [focus, setFocus] = useState(0);
  const currencies = [...new Set(rows.map((row) => row.currency ?? ''))];
  const visible = rows.filter((row) => (row.currency ?? '') === series);
  const current = visible[focus] ?? visible[0];
  const { values, y } = chartValues(visible);
  const x = (i: number) => 34 + ((i + 0.5) * 532) / visible.length;
  const width = Math.min(52, 340 / visible.length);
  return (
    <div className="stack">
      {currencies.length > 1 && (
        <label>
          Chart currency
          <select
            value={series}
            onChange={(event) => {
              setSeries(event.target.value);
              setFocus(0);
            }}
          >
            {currencies.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
      )}
      <svg
        viewBox="0 0 600 190"
        width="100%"
        role="img"
        aria-label={kind === 'line' ? 'Monthly line chart' : 'Comparison bar chart'}
        style={{ color: 'var(--accent, #f88032)', maxWidth: 760 }}
      >
        <path d={'M 30 ' + y(0) + ' H 570'} stroke="currentColor" opacity="0.55" />
        {visible.map((row, i) => {
          const pos = y(values[i]);
          const previous = visible[i - 1];
          const adjacent = previous && monthIndex(row.key) - monthIndex(previous.key) === 1;
          return (
            <g key={row.key} fill="currentColor" opacity={row.key === current?.key ? 1 : 0.65}>
              <title>
                {row.label} · {row.value} {row.currency ?? unit}
              </title>
              {kind === 'line' ? (
                <>
                  {adjacent && (
                    <line
                      x1={x(i - 1)}
                      y1={y(values[i - 1])}
                      x2={x(i)}
                      y2={pos}
                      stroke="currentColor"
                      strokeWidth="2"
                    />
                  )}
                  <circle cx={x(i)} cy={pos} r={row.key === current?.key ? 6 : 3.5} />
                </>
              ) : (
                <rect
                  x={x(i) - width / 2}
                  y={Math.min(pos, y(0))}
                  width={width}
                  height={Math.max(1, Math.abs(y(0) - pos))}
                  rx="2"
                />
              )}
            </g>
          );
        })}
      </svg>
      <label>
        Inspect a chart value
        <select value={focus} onChange={(event) => setFocus(Number(event.target.value))}>
          {visible.map((row, i) => (
            <option value={i} key={row.key}>
              {row.label}
            </option>
          ))}
        </select>
      </label>
      {current && (
        <p aria-live="polite">
          {current.label} ·{' '}
          <strong>
            {current.value} {current.currency ?? unit}
          </strong>
        </p>
      )}
    </div>
  );
}

function monthIndex(value: string) {
  const [year, month] = value.split('-').map(Number);
  return year * 12 + month;
}

function exportResult(result: Result) {
  function cell(value: string) {
    const safe = /^[\s]*[=+\-@]/.test(value) ? "'" + value : value;
    return '"' + safe.replaceAll('"', '""') + '"';
  }
  const rows = result.rows.map((row) =>
    [
      cell(row.label),
      /^-?\d+(?:\.\d+)?$/.test(row.value) ? row.value : cell(row.value),
      cell(row.currency ?? result.unit),
      cell(result.spec.dateRange.start),
      cell(result.spec.dateRange.end),
    ].join(','),
  );
  const url = URL.createObjectURL(
    new Blob([['Group,Value,Unit,Start UTC,End UTC exclusive', ...rows].join('\r\n')], {
      type: 'text/csv;charset=utf-8',
    }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = 'motoros-' + result.spec.metric + '.csv';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function AnalyticsIntelligence({
  tenant,
  branches,
}: {
  tenant: string;
  branches: Branch[];
}) {
  const [question, setQuestion] = useState('');
  const [branch, setBranch] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [history, setHistory] = useState<History | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [lastQuestion, setLastQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyRevision, setHistoryRevision] = useState(0);
  const labels = Object.fromEntries(branches.map(({ id, name }) => [id, name]));

  useEffect(() => {
    if (!historyOpen) return;
    const controller = new AbortController();
    fetch('/api/ai/analytics/query-history', {
      headers: { 'X-MotorOS-Expected-Tenant': tenant },
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.title || 'Query history is unavailable.');
        setHistory(payload);
        setHistoryError('');
      })
      .catch((error: Error) => {
        if (error.name !== 'AbortError') setHistoryError(error.message);
      });
    return () => controller.abort();
  }, [historyOpen, historyRevision, tenant]);

  async function loadMore(offset: number) {
    setHistoryBusy(true);
    setHistoryError('');
    try {
      const response = await fetch('/api/ai/analytics/query-history?offset=' + offset, {
        headers: { 'X-MotorOS-Expected-Tenant': tenant },
        cache: 'no-store',
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.title || 'Query history is unavailable.');
      setHistory((previous) => ({
        ...payload,
        queries: [...(previous?.queries ?? []), ...payload.queries],
      }));
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : 'Query history is unavailable.');
    } finally {
      setHistoryBusy(false);
    }
  }

  async function ask(value: string, previous?: string, useControls = true) {
    if (busy || !value.trim()) return;
    setBusy(true);
    setError('');
    setResult(null);
    setLastQuestion(value);
    try {
      const response = await fetch('/api/ai/analytics/query', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json', 'X-MotorOS-Expected-Tenant': tenant },
        body: JSON.stringify({
          question: value,
          ...(previous ? { previousQueryId: previous } : {}),
          ...(useControls && branch ? { branchIds: [branch] } : {}),
          ...(useControls && start ? { start } : {}),
          ...(useControls && end ? { end } : {}),
        }),
      });
      const payload = await response.json();
      if (response.status === 401) window.location.assign('/session-expired');
      if (!response.ok) throw new Error(payload.title || 'Analytics Intelligence is unavailable.');
      setResult(payload);
      setHistoryRevision((value) => value + 1);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Analytics Intelligence is unavailable.');
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void ask(question, result?.queryId);
  }

  return (
    <section
      id="analytics-intelligence"
      className="panel operation-card stack"
      aria-label="Analytics Intelligence"
    >
      <h2>Analytics Intelligence</h2>
      <p>
        Ask about workshop activity, billing, parts, or returning customers across your authorized
        branches.
      </p>
      <form onSubmit={submit} className="stack">
        <label>
          Ask a business question
          <input
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            maxLength={300}
            required
            minLength={3}
            placeholder="Which branch generated the most revenue last month?"
          />
        </label>
        <div className="button-row">
          <label>
            Reporting branch
            <select value={branch} onChange={(event) => setBranch(event.target.value)}>
              <option value="">All authorized branches</option>
              {branches.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Start date (UTC)
            <input type="date" value={start} onChange={(event) => setStart(event.target.value)} />
          </label>
          <label>
            End date (exclusive)
            <input type="date" value={end} onChange={(event) => setEnd(event.target.value)} />
          </label>
        </div>
        <Button disabled={busy}>{busy ? 'Reading verified metrics…' : 'Ask Analytics'}</Button>
      </form>
      <details open={!result || undefined}>
        <summary>Suggested questions</summary>
        <div className="button-row">
          {suggestions.map((item) => (
            <Button
              key={item}
              variant="outline"
              disabled={busy}
              onClick={() => {
                setQuestion(item);
                setStart('');
                setEnd('');
                void ask(item, undefined, false);
              }}
            >
              {item}
            </Button>
          ))}
        </div>
      </details>
      {busy && <p role="status">Checking the authorized reporting projections…</p>}
      {error && <p role="alert">{error}</p>}
      {result && (
        <section className="operation-card stack" aria-label="Analytics answer">
          <p className="muted">{lastQuestion}</p>
          <h3>{result.title}</h3>
          <p aria-live="polite">{result.answer}</p>
          <p>{result.definition}</p>
          <p className="muted">{result.explanation}</p>
          <p>
            UTC dates: {result.spec.dateRange.start} to {result.spec.dateRange.end} (exclusive)
          </p>
          <p>Branches: {result.spec.branchIds.map((id) => labels[id] ?? id).join(', ')}</p>
          {result.spec.currency && <p>Currency filter: {result.spec.currency}</p>}
          <p>Snapshot requested: {new Date(result.asOf).toLocaleString()}</p>
          {result.staleBranchIds.length > 0 && (
            <p role="status">
              Projection freshness warning: no update within 24 hours for at least one required
              source in {result.staleBranchIds.map((id) => labels[id] ?? id).join(', ')}.
            </p>
          )}
          <details>
            <summary>Source freshness and limitations</summary>
            <ul>
              {result.freshness.map((item) => (
                <li key={item.branchId + item.producer}>
                  {labels[item.branchId] ?? item.branchId} · {item.producer} ·{' '}
                  {new Date(item.projectedAt).toLocaleString()}
                </li>
              ))}
              {result.limitations.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </details>
          {result.rows.length > 0 && (
            <>
              {result.chart.type === 'kpi' ? (
                <div className="button-row">
                  {result.rows.map((row) => (
                    <p className="notice" key={row.key + row.currency}>
                      <strong>{row.value}</strong> {row.currency ?? result.unit}
                    </p>
                  ))}
                </div>
              ) : (
                <MetricChart
                  key={result.queryId}
                  rows={result.rows}
                  kind={result.chart.type}
                  unit={result.unit}
                />
              )}
              <div className="table-scroll">
                <table>
                  <caption>Authorized result values</caption>
                  <thead>
                    <tr>
                      <th>Group</th>
                      <th>Value</th>
                      <th>Unit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((row) => (
                      <tr key={row.key + row.currency}>
                        <th scope="row">{row.label}</th>
                        <td>{row.value}</td>
                        <td>{row.currency ?? result.unit}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Button variant="outline" onClick={() => exportResult(result)}>
                Export results as CSV
              </Button>
            </>
          )}
          <div className="button-row">
            {['Last month', 'By branch', 'By month'].map((follow) => (
              <Button
                key={follow}
                variant="outline"
                onClick={() => void ask(follow, result.queryId, false)}
              >
                {follow}
              </Button>
            ))}
          </div>
        </section>
      )}
      <details onToggle={(event) => setHistoryOpen(event.currentTarget.open)}>
        <summary>My query history</summary>
        {historyError && <p role="alert">{historyError}</p>}
        {!history && !historyError && <p>Loading your queries…</p>}
        {history?.queries.length === 0 && <p>No recent queries.</p>}
        {history?.queries.map((item) => (
          <p key={item.id}>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setQuestion(item.question);
                void ask('Run again', item.id, false);
              }}
            >
              {item.question}
            </Button>{' '}
            {item.spec.dateRange.start} to {item.spec.dateRange.end}
          </p>
        ))}
        {history?.nextOffset != null && (
          <Button
            variant="outline"
            disabled={historyBusy}
            onClick={() => void loadMore(history.nextOffset!)}
          >
            More queries
          </Button>
        )}
      </details>
    </section>
  );
}

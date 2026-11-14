'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { useAccount } from '../registry/shared';

type Source = {
  category: string;
  text: string;
  kind: 'job' | 'history' | 'document';
  resourceId: string;
  title?: string;
  version?: number;
  page?: number;
  passage?: number;
  branch?: string;
  historyPage?: number;
};
type Turn = {
  number: number;
  question: string;
  answer: string;
  sufficiency: string;
  sources: Source[];
  inspectionChecklist: Source[];
  warnings: string[];
  helpful: boolean | null;
};
type Conversation = { id: string; updated_at: string; turns: number };
type Document = { id: string; title: string; kind: string; version: number };

function requester(tenant: string) {
  return async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const response = await fetch('/api/ai/' + path, {
      method,
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'X-MotorOS-Expected-Tenant': tenant },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json();
    if (response.status === 401) window.location.assign('/session-expired');
    if (response.status === 409 && data.code === 'TENANT_CONTEXT_CHANGED') window.location.reload();
    if (!response.ok) throw new Error(data.title || 'The request could not be completed.');
    return data;
  };
}

const prompts = [
  'What previous repairs are documented?',
  'Which parts were used in past repairs?',
  'What inspection concerns should I review?',
];

export function MechanicCopilot({
  jobId,
  vehicleId,
  branchId,
}: {
  jobId: string;
  vehicleId: string;
  branchId: string;
}) {
  const me = useAccount();
  const tenant = me.activeTenant!;
  const request = requester(tenant);
  const [question, setQuestion] = useState('');
  const [conversation, setConversation] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [history, setHistory] = useState<Conversation[]>([]);
  const [historyOffset, setHistoryOffset] = useState<number | null>(null);
  const [turnOffset, setTurnOffset] = useState<number | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [archived, setArchived] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  async function loadHistory(offset: number, includeArchived = showArchived) {
    const result = await request<{ conversations: Conversation[]; nextOffset: number | null }>(
      `copilot/conversations?jobId=${jobId}&offset=${offset}&archived=${includeArchived}`,
    );
    setHistory((current) =>
      offset ? [...current, ...result.conversations] : result.conversations,
    );
    setHistoryOffset(result.nextOffset);
  }

  useEffect(() => {
    let active = true;
    requester(tenant)<{ conversations: Conversation[]; nextOffset: number | null }>(
      `copilot/conversations?jobId=${jobId}`,
    )
      .then((result) => {
        if (active) {
          setHistory(result.conversations);
          setHistoryOffset(result.nextOffset);
        }
      })
      .catch((failure: Error) => {
        if (active) setError(failure.message);
      });
    return () => {
      active = false;
    };
  }, [jobId, tenant]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Copilot request failed.');
    } finally {
      setBusy(false);
    }
  }

  async function open(id: string, offset = 0) {
    const result = await request<{ turns: Turn[]; archived: boolean; nextOffset: number | null }>(
      `copilot/conversations/${id}?jobId=${jobId}&offset=${offset}`,
    );
    setConversation(id);
    setArchived(result.archived);
    setTurns((current) => (offset ? [...result.turns, ...current] : result.turns));
    setTurnOffset(result.nextOffset);
  }

  function startNew() {
    setConversation('');
    setTurns([]);
    setTurnOffset(null);
    setArchived(false);
    setError('');
    setNotice('');
  }

  function ask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run(async () => {
      const result = await request<{ conversationId: string; turn: Turn }>('copilot/chat', 'POST', {
        jobId,
        question,
        conversationId: conversation || null,
      });
      setConversation(result.conversationId);
      setTurns((current) => [...current, result.turn]);
      setQuestion('');
      await loadHistory(0);
    });
  }

  return (
    <section className="panel operation-card">
      <span className="eyebrow">MOTOROS INTELLIGENCE</span>
      <h2>Ask MotorOS Copilot</h2>
      <p>
        AI selects evidence from authorized service records, completed inspections, and approved
        workshop documents.
      </p>
      <div className="operations-tools">
        <Button variant="outline" disabled={busy} onClick={startNew}>
          New conversation
        </Button>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const next = !showArchived;
              await loadHistory(0, next);
              setShowArchived(next);
            })
          }
        >
          {showArchived ? 'Show active conversations' : 'Show archived conversations'}
        </Button>
        {conversation && !archived && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await request(
                  `copilot/conversations/${conversation}/archive?jobId=${jobId}`,
                  'POST',
                );
                startNew();
                await loadHistory(0);
              })
            }
          >
            Archive conversation
          </Button>
        )}
      </div>
      {history.length > 0 && (
        <label>
          Conversation history
          <select
            disabled={busy}
            value={history.some((item) => item.id === conversation) ? conversation : ''}
            onChange={(event) => {
              const id = event.target.value;
              if (id) void run(() => open(id));
            }}
          >
            <option value="">Select a conversation</option>
            {history.map((item) => (
              <option key={item.id} value={item.id}>
                {new Date(item.updated_at).toLocaleString()} · {item.turns} turns
              </option>
            ))}
          </select>
        </label>
      )}
      {historyOffset !== null && (
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => void run(() => loadHistory(historyOffset))}
        >
          More conversations
        </Button>
      )}
      {turnOffset !== null && (
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => void run(() => open(conversation, turnOffset))}
        >
          Older messages
        </Button>
      )}
      {turns.map((turn) => (
        <article className="repair-task" key={turn.number}>
          <h3>{turn.question}</h3>
          <p>
            <strong>
              {turn.sufficiency === 'supported' ? 'Evidence found' : 'Insufficient evidence'}
            </strong>
          </p>
          <p>{turn.answer}</p>
          {turn.sources.map((source, index) => (
            <div key={index} className="panel operation-card">
              <strong>{source.title || source.category}</strong>
              <p>{source.text}</p>
              {source.kind === 'document' ? (
                <small>
                  Version {source.version} · {source.page ? `Page ${source.page} · ` : ''}Passage{' '}
                  {source.passage}
                </small>
              ) : (
                <a
                  href={
                    source.kind === 'job'
                      ? `/jobs/${source.resourceId}`
                      : `/vehicles/${vehicleId}/timeline?historyBranch=${branchId}&historyPage=${source.historyPage ?? 0}#service-record-${source.resourceId}`
                  }
                >
                  {source.branch ? `Open ${source.branch} service record` : 'Open work order'}
                </a>
              )}
            </div>
          ))}
          {turn.inspectionChecklist.length > 0 && (
            <>
              <h4>Recorded items to verify</h4>
              <ul>
                {turn.inspectionChecklist.map((source, index) => (
                  <li key={index}>{source.text}</li>
                ))}
              </ul>
            </>
          )}
          {turn.warnings.map((warning) => (
            <p key={warning}>
              <small>{warning}</small>
            </p>
          ))}
          <div className="operations-tools">
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await navigator.clipboard.writeText(turn.answer);
                  setNotice('Answer copied.');
                })
              }
            >
              Copy response
            </Button>
            {[true, false].map((helpful) => (
              <Button
                key={String(helpful)}
                variant="ghost"
                disabled={busy}
                aria-pressed={turn.helpful === helpful}
                onClick={() =>
                  void run(async () => {
                    await request(
                      `copilot/conversations/${conversation}/feedback?jobId=${jobId}&number=${turn.number}&helpful=${helpful}`,
                      'POST',
                    );
                    setTurns((current) =>
                      current.map((item) =>
                        item.number === turn.number ? { ...item, helpful } : item,
                      ),
                    );
                    setNotice('Feedback saved.');
                  })
                }
              >
                {helpful ? 'Helpful' : 'Not helpful'}
              </Button>
            ))}
          </div>
        </article>
      ))}
      {!archived && (
        <form onSubmit={ask}>
          <div className="operations-tools">
            {prompts.map((prompt) => (
              <Button
                type="button"
                key={prompt}
                variant="outline"
                disabled={busy}
                onClick={() => setQuestion(prompt)}
              >
                {prompt}
              </Button>
            ))}
          </div>
          <label>
            Ask about this job
            <textarea
              required
              minLength={3}
              maxLength={1000}
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              disabled={busy}
            />
          </label>
          <Button disabled={busy || question.trim().length < 3}>Ask Copilot</Button>
        </form>
      )}
      <p role="status">{busy ? 'Working…' : notice}</p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {me.context?.role === 'BRAND_OWNER' && <WorkshopLibrary tenant={tenant} />}
    </section>
  );
}

function WorkshopLibrary({ tenant }: { tenant: string }) {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [replace, setReplace] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const selected = documents.find((document) => document.id === replace);

  useEffect(() => {
    let active = true;
    requester(tenant)<{ documents: Document[] }>('documents')
      .then((result) => {
        if (active) setDocuments(result.documents);
      })
      .catch((failure: Error) => {
        if (active) setError(failure.message);
      });
    return () => {
      active = false;
    };
  }, [tenant]);

  async function run(action: () => Promise<void>, message: string) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
      setDocuments((await requester(tenant)<{ documents: Document[] }>('documents')).documents);
      setReplace('');
      setNotice(message);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Library request failed.');
    } finally {
      setBusy(false);
    }
  }

  function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const file = fields.get('file');
    if (!(file instanceof File) || !file.size || file.size > 1_048_576) {
      setError('Choose a PDF or text file up to 1 MiB.');
      return;
    }
    void run(async () => {
      const content = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1]);
        reader.onerror = () => reject(new Error('Could not read the selected file.'));
        reader.readAsDataURL(file);
      });
      await requester(tenant)('documents', 'POST', {
        title: fields.get('title'),
        kind: fields.get('kind'),
        format: file.name.toLowerCase().endsWith('.pdf') ? 'pdf' : 'text',
        approved: fields.get('approved') === 'on',
        content,
        documentId: selected?.id,
        version: selected?.version,
      });
      form.reset();
    }, 'Document indexed.');
  }

  return (
    <details>
      <summary>Manage approved workshop documents</summary>
      <p>
        Upload licensed material approved for Copilot and available to authorized workshop staff in
        this brand.
      </p>
      <ul>
        {documents.map((document) => (
          <li key={document.id}>
            {document.title} · v{document.version}{' '}
            <Button variant="ghost" disabled={busy} onClick={() => setReplace(document.id)}>
              Replace
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                if (window.confirm('Remove this document from Copilot?'))
                  void run(
                    () =>
                      requester(tenant)(
                        `documents/${document.id}?version=${document.version}`,
                        'DELETE',
                      ).then(() => {}),
                    'Document removed.',
                  );
              }}
            >
              Remove
            </Button>
          </li>
        ))}
      </ul>
      <form key={replace} onSubmit={upload}>
        <label>
          Document title{' '}
          <input name="title" required maxLength={160} defaultValue={selected?.title} />
        </label>
        <label>
          Document type
          <select name="kind" defaultValue={selected?.kind || 'manual'}>
            <option value="manual">Technical manual</option>
            <option value="sop">Workshop SOP</option>
            <option value="supplier">Supplier document</option>
            <option value="maintenance">Maintenance guide</option>
            <option value="troubleshooting">Troubleshooting guide</option>
          </select>
        </label>
        <label>
          PDF or text file <input type="file" name="file" accept=".pdf,.txt,.md" required />
        </label>
        <label>
          <input name="approved" type="checkbox" required /> Approved for Copilot and licensed for
          this use
        </label>
        <Button disabled={busy}>{selected ? 'Index replacement' : 'Index document'}</Button>
        {selected && (
          <Button type="button" variant="ghost" onClick={() => setReplace('')}>
            Cancel replacement
          </Button>
        )}
      </form>
      <p role="status">{busy ? 'Updating library…' : notice}</p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </details>
  );
}

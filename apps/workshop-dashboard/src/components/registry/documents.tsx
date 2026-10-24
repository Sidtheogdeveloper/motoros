'use client';
import { useState, type FormEvent } from 'react';
import { FileText } from 'lucide-react';
import { allowed } from '@/lib/account';
import { send } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  useAccount,
  useData,
  Issue,
  Pager,
  BranchSelect,
  type Row,
  type Page,
  type Branch,
} from './shared';
export function DocumentPanel({
  kind,
  id,
  branches,
}: {
  kind: 'customers' | 'vehicles';
  id: string;
  branches: Branch[];
}) {
  const me = useAccount(),
    [page, setPage] = useState(0),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false);
  const result = useData<Page>(`customer/${kind}/${id}/documents?page=${page}&size=20`);
  async function upload(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    const form = e.currentTarget,
      f = new FormData(form),
      file = f.get('file') as File;
    try {
      if (!file || !file.size || file.size > 10485760)
        throw new Error('Select a PDF, PNG or JPEG up to 10 MB.');
      const digest = Array.from(
        new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())),
      )
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      const grant = await send<{
        url: string;
        headers: Record<string, string>;
        documentId: string;
      }>(
        `customer/${kind}/${id}/documents/uploads`,
        {
          fileName: file.name,
          contentType: file.type,
          byteSize: file.size,
          sha256: digest,
          branchId: f.get('branchId'),
          visibility: kind === 'customers' ? 'CUSTOMER_PRIVATE' : f.get('visibility'),
        },
        'POST',
        me.activeTenant!,
      );
      const response = await fetch(grant.url, {
        method: 'PUT',
        headers: grant.headers,
        body: file,
        credentials: 'omit',
      });
      if (!response.ok) throw new Error('Storage rejected upload. Request a new upload and retry.');
      await send(
        `customer/documents/${grant.documentId}/complete`,
        { version: 0 },
        'POST',
        me.activeTenant!,
      );
      result.reload();
      setNotice('Document validated and published.');
      form.reset();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function download(doc: Row) {
    try {
      const grant = await send<{
        url: string;
      }>(`customer/documents/${doc.id}/download`, {}, 'POST', me.activeTenant!);
      const response = await fetch(grant.url, { credentials: 'omit', cache: 'no-store' });
      if (!response.ok) throw new Error('Download expired or unavailable. Request a new download.');
      const local = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = local;
      link.download = doc.fileName || 'document';
      link.click();
      setTimeout(() => URL.revokeObjectURL(local), 1000);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function archive(doc: Row) {
    if (!window.confirm('Archive this document? New download grants will stop.')) return;
    try {
      await send(
        `customer/documents/${doc.id}/archive`,
        { version: doc.version },
        'POST',
        me.activeTenant!,
      );
      result.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <section className="panel registry-summary">
      <h2>Private documents</h2>
      <p>
        PDF, PNG and JPEG · up to 10 MB · checksummed uploads · short-lived authorized downloads
      </p>
      <Issue error={result.error || error} loading={result.loading} />
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {result.data?.content.map((doc) => (
        <div className="registry-line" key={doc.id}>
          <FileText size={20} />
          <div>
            <strong>{doc.fileName}</strong>
            <small className="cell-subline">
              {Math.ceil((doc.byteSize || 0) / 1024)} KB · {doc.visibility}
            </small>
          </div>
          <Button variant="outline" onClick={() => download(doc)}>
            Download
          </Button>
          {allowed(me, 'DOCUMENT_WRITE') && (
            <Button variant="ghost" onClick={() => archive(doc)}>
              Archive
            </Button>
          )}
        </div>
      ))}
      {result.data && !result.data.content.length && <p>No accessible documents.</p>}
      <Pager page={page} setPage={setPage} result={result.data} />
      {allowed(me, 'DOCUMENT_WRITE') && (
        <form onSubmit={upload} className="registry-inline-form">
          <label>
            Document file
            <input name="file" type="file" required accept="application/pdf,image/png,image/jpeg" />
          </label>
          <BranchSelect branches={branches} />
          {kind === 'vehicles' && (
            <label>
              Document visibility
              <select name="visibility">
                <option value="TECHNICAL">Technical — authorized vehicle staff</option>
                <option value="CUSTOMER_PRIVATE">
                  Customer private — contact-access staff only
                </option>
              </select>
            </label>
          )}
          <Button disabled={busy}>{busy ? 'Validating upload…' : 'Upload document'}</Button>
        </form>
      )}
    </section>
  );
}

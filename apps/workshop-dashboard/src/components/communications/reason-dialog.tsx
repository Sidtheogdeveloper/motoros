'use client';

import { useState, type FormEvent } from 'react';
import { FormDialog } from '../registry/shared';
import { Button } from '../ui/button';

export function ReasonDialog({
  title,
  onClose,
  onConfirm,
}: {
  title: string;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const reason = String(new FormData(event.currentTarget).get('reason') || '').trim();
    if (reason.length < 10) {
      setError('Enter at least 10 characters.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onConfirm(reason);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'The action could not be completed.');
    } finally {
      setBusy(false);
    }
  }

  const close = () => {
    if (!busy) onClose();
  };
  return (
    <FormDialog title={title} onClose={close}>
      <form onSubmit={submit} aria-busy={busy}>
        <label>
          Reason for this action
          <textarea name="reason" required minLength={10} maxLength={500} autoFocus />
        </label>
        <p className="muted">The reason is saved in the audit history.</p>
        {error && <p role="alert">{error}</p>}
        <div className="dialog-actions">
          <Button type="button" variant="outline" disabled={busy} onClick={close}>
            Cancel
          </Button>
          <Button disabled={busy}>{busy ? 'Saving…' : title}</Button>
        </div>
      </form>
    </FormDialog>
  );
}

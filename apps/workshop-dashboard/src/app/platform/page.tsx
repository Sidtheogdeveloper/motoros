'use client';
import { Brand } from '@/components/brand';

import { useEffect, useState } from 'react';
import { account, type Account } from '@/lib/account';
import { api, send } from '@/lib/api';
import { Button } from '@/components/ui/button';
type Tenant = { id: string; name: string; status: string; version: number };
export default function Platform() {
  const [me, setMe] = useState<Account | null>(null);
  const [rows, setRows] = useState<Tenant[]>([]);
  const [error, setError] = useState('');
  async function load() {
    try {
      const person = await account();
      setMe(person);
      if (person.user.platformAdmin) setRows(await api<Tenant[]>('tenant/platform/tenants'));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function status(row: Tenant) {
    const status = row.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
    if (
      !window.confirm(
        `${status === 'ACTIVE' ? 'Reactivate' : 'Suspend'} ${row.name}? This changes access for every member of this brand.`,
      )
    )
      return;
    try {
      await send(`tenant/platform/tenants/${row.id}/status`, { status, version: row.version });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <main className="account-page">
      <a href="/" className="brand">
        <Brand />
      </a>
      <h1>Platform administration.</h1>
      <p>These controls change brand availability. They do not grant access to customer records.</p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {me?.user.platformAdmin ? (
        <div className="panel table-wrap">
          <table>
            <thead>
              <tr>
                <th>Brand</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.name}</td>
                  <td>{row.status}</td>
                  <td>
                    <Button variant="outline" onClick={() => status(row)}>
                      {row.status === 'ACTIVE' ? 'Suspend' : 'Reactivate'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p>Platform administrator access is required.</p>
      )}
    </main>
  );
}

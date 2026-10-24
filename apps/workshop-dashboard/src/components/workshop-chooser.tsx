'use client';
import { useState } from 'react';
import { Building2, ArrowRight, Plus, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { switchBrand, signOut, type Account } from '@/lib/account';
export function WorkshopChooser({ me }: { me: Account }) {
  const [error, setError] = useState('');
  return (
    <main className="account-page">
      <a href="/" className="brand">
        motor<span>os</span>
      </a>
      <span className="eyebrow">YOUR CONNECTED WORKSHOPS</span>
      <h1>{me.memberships.length ? 'Choose your workspace.' : 'Welcome to MotorOS.'}</h1>
      <p>Signed in as {me.user.email}. Workshop access follows your current memberships.</p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="chooser-grid">
        {me.memberships
          .filter((m) => m.tenantStatus === 'ACTIVE')
          .map((m) => (
            <button
              className="vehicle-card"
              key={m.id}
              onClick={() => switchBrand(m.tenantId).catch((e) => setError(e.message))}
            >
              <Building2 size={28} />
              <strong>{m.name}</strong>
              <small>{m.role.replaceAll('_', ' ')}</small>
              <span className="vehicle-link">
                Open workspace <ArrowRight size={15} />
              </span>
            </button>
          ))}
      </div>
      <div className="chooser-actions">
        <Button asChild>
          <a href="/onboarding">
            <Plus size={16} />
            Create workshop
          </a>
        </Button>
        <Button asChild variant="outline">
          <a href="/profile">Your profile</a>
        </Button>
        <Button variant="ghost" onClick={() => signOut().catch((e) => setError(e.message))}>
          <LogOut size={16} />
          Sign out
        </Button>
      </div>
    </main>
  );
}

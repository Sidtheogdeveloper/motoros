import { Button } from '@/components/ui/button';
export default function Page() {
  return (
    <main className="account-page narrow">
      <a className="brand" href="/login">
        motor<span>os</span>
      </a>
      <span className="eyebrow">IDENTITY & ACCESS</span>
      <h1>Your session has expired.</h1>
      <p>Sign in again to restore authorized access. Your workshop records are safely stored.</p>
      <Button asChild>
        <a href="/api/auth/login">Sign in again</a>
      </Button>
    </main>
  );
}

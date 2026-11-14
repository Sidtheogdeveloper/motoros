import { Brand } from '@/components/brand';
import { Button } from '@/components/ui/button';
export default function Page() {
  return (
    <main className="session-recovery">
      <a className="brand" href="/login">
        <Brand />
      </a>
      <section className="panel" aria-labelledby="session-expired-title">
        <span className="eyebrow">IDENTITY & ACCESS</span>
        <h1 id="session-expired-title">Your session has expired.</h1>
        <p>Sign in again to restore authorized access. Your workshop records are safely stored.</p>
        <Button asChild>
          <a href="/api/auth/login">Sign in again</a>
        </Button>
      </section>
    </main>
  );
}

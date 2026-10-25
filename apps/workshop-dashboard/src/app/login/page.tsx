import { Brand } from '@/components/brand';
import { ArrowUpRight, ShieldCheck, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <main className="login">
      <section className="login-story">
        <a className="brand" href="/login">
          <Brand />
          <small>WORKSHOP OPERATING SYSTEM</small>
        </a>
        <div>
          <span className="eyebrow">BUILT FOR THE WORKSHOP FLOOR</span>
          <h1>
            Good work.
            <br />
            Great operations.
          </h1>
          <p>
            One workspace for your people, your vehicles,
            <br />
            and every job that moves your business forward.
          </p>
          <div className="story-line">
            <Wrench size={20} />
            <span>Connected workshops. Carefully controlled access.</span>
          </div>
        </div>
        <footer>
          <span>MotorOS / Connected workspace</span>
          <span>02 — IDENTITY & ACCESS</span>
        </footer>
      </section>
      <section className="login-form">
        <div className="form-wrap">
          <span className="eyebrow">YOUR WORKSHOP, CONNECTED</span>
          <h2>Welcome back.</h2>
          <p>Sign in securely to continue to your workshops.</p>
          {error && (
            <p role="alert" className="error">
              {error === 'identity-unavailable'
                ? 'The identity service is unavailable. Check local services and retry.'
                : 'Sign-in did not complete. Please start again.'}
            </p>
          )}
          <Button asChild>
            <a href="/api/auth/login">
              Sign in securely <ArrowUpRight size={17} />
            </a>
          </Button>
          <div className="form-switch">
            New to MotorOS? <a href="/register">Create your account</a>
          </div>
          <div className="form-switch">
            <a href="/password-recovery">Forgot your password?</a>
          </div>
          <div className="local-note">
            <ShieldCheck size={17} />
            <span>Protected sign-in · Server-managed sessions</span>
          </div>
        </div>
      </section>
    </main>
  );
}

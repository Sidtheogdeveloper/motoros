import { Brand } from '@/components/brand';
import { Button } from '@/components/ui/button';
export default function Page() {
  return (
    <main className="account-page narrow">
      <a className="brand" href="/login">
        <Brand />
      </a>
      <span className="eyebrow">IDENTITY & ACCESS</span>
      <h1>Recover your account.</h1>
      <p>
        Continue to the secure sign-in page and choose “Forgot password?”. Your identity provider
        sends a reset link to your registered email. MotorOS never receives your password.
      </p>
      <Button asChild>
        <a href="/api/auth/login">Open secure sign-in</a>
      </Button>
    </main>
  );
}

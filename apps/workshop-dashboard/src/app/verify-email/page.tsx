import { Brand } from '@/components/brand';
import { Button } from '@/components/ui/button';
export default function Page() {
  return (
    <main className="account-page narrow">
      <a className="brand" href="/login">
        <Brand />
      </a>
      <span className="eyebrow">IDENTITY & ACCESS</span>
      <h1>Verify your email.</h1>
      <p>
        Open the verification message from your identity provider. In local development, messages
        arrive in Mailpit. Complete verification, then sign in again.
      </p>
      <Button asChild>
        <a href="/api/auth/login">Continue to sign in</a>
      </Button>
    </main>
  );
}

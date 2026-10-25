import { Brand } from '@/components/brand';
import { Button } from '@/components/ui/button';
export default function Page() {
  return (
    <main className="account-page narrow">
      <a className="brand" href="/login">
        <Brand />
      </a>
      <span className="eyebrow">IDENTITY & ACCESS</span>
      <h1>Create your MotorOS account.</h1>
      <p>
        Your identity provider securely handles registration, password protection and email
        verification. After verification, create a workshop or accept an invitation.
      </p>
      <Button asChild>
        <a href="/api/auth/login?flow=register">Continue to registration</a>
      </Button>
    </main>
  );
}

import { Button } from '@/components/ui/button';
export default function Page() {
  return (
    <main className="account-page narrow">
      <a className="brand" href="/login">
        motor<span>os</span>
      </a>
      <span className="eyebrow">IDENTITY & ACCESS</span>
      <h1>Access is restricted.</h1>
      <p>
        Your current membership does not permit this operation. Ask a workshop owner to review your
        role or branch assignments.
      </p>
      <Button asChild>
        <a href="/">Choose a workshop</a>
      </Button>
    </main>
  );
}

import type { Metadata } from 'next';
import { session } from '@/lib/session';
import { Workspace } from '@/components/workspace';
import { LandingPage } from '@/components/landing-page';
export const metadata: Metadata = {
  title: 'MotorOS — Keep your workshop moving',
  description:
    'Connect bookings, customers, vehicles, job cards, inventory and billing in one workshop operating system, with controlled access across branches.',
};
export default async function Page() {
  if (!(await session())) return <LandingPage />;
  return <Workspace />;
}

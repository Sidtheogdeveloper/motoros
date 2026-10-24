import { redirect } from 'next/navigation';
import { session } from '@/lib/session';
export default async function Layout({ children }: { children: React.ReactNode }) {
  if (!(await session())) redirect('/login');
  return children;
}

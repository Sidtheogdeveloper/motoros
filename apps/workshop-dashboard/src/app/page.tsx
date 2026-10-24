import { redirect } from 'next/navigation';
import { session } from '@/lib/session';
import { Workspace } from '@/components/workspace';
export default async function Page() {
  if (!(await session())) redirect('/login');
  return <Workspace />;
}

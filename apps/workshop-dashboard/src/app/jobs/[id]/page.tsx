import { OperationsPage } from '@/components/operations';
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const [{ id }, { tab }] = await Promise.all([params, searchParams]);
  return <OperationsPage view="jobs" id={id} openCopilot={tab === 'copilot'} />;
}

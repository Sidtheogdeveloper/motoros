import { RegistryPage } from '@/components/registry';
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const [{ id }, { tab }] = await Promise.all([params, searchParams]);
  return <RegistryPage kind="vehicles" id={id} openIntelligence={tab === 'intelligence'} />;
}

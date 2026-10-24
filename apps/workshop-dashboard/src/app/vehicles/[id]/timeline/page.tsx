import { RegistryPage } from '@/components/registry';
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RegistryPage kind="vehicles" id={id} timeline />;
}

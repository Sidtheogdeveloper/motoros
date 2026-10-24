import { Management } from '@/components/management';
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <Management mode="branch" branchId={(await params).id} />;
}

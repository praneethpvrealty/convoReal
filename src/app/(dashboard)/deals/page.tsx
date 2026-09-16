import { redirect } from 'next/navigation';

export default function DealsIndexPage() {
  redirect('/automations?tab=pipelines');
}

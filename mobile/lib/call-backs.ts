import { apiFetch } from '@/lib/api';

export interface CallBack {
  id: string;
  title: string;
  start_time: string;
  agenda?: string | null;
  contact?: {
    id: string;
    name?: string | null;
    phone?: string | null;
  } | null;
}

/** Under `appointments` so every event save or status change that
 *  invalidates the calendar refreshes the call backs too. */
export const CALL_BACKS_QUERY_KEY = ['appointments', 'call-backs'];

export async function fetchCallBacks(): Promise<CallBack[]> {
  const res = await apiFetch<{ data: CallBack[] }>(
    '/api/appointments/call-backs'
  );
  return res.data ?? [];
}

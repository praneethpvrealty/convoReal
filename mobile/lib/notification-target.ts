import type { Href } from 'expo-router';

export interface NotificationTargetRow {
  type: string;
  entity_type: string | null;
  entity_id: string | null;
  link: string | null;
}

/** Map a web deep link stored on the row to the mobile route, or null
 *  when the row points nowhere the app can open. */
export function notificationTarget(n: NotificationTargetRow): Href | null {
  if (n.entity_type === 'requirement_account_share' && n.entity_id) {
    return {
      pathname: '/(app)/shared-requirement/[id]',
      params: {
        id: n.entity_id,
        box: n.type === 'requirement_response' ? 'sent' : 'received',
      },
    };
  }
  if (n.type === 'location_request' || n.type === 'document_request') {
    return '/(app)/dashboard';
  }
  if (n.type === 'portal_listing_expiry') {
    return n.entity_type === 'property' && n.entity_id
      ? `/(app)/property/${n.entity_id}`
      : '/(app)/(tabs)/properties';
  }
  if (n.entity_type === 'conversation' && n.entity_id) {
    return `/(app)/conversation/${n.entity_id}`;
  }
  if (n.entity_type === 'contact' && n.entity_id) {
    return `/(app)/contact/${n.entity_id}`;
  }
  if (n.entity_type === 'property' && n.entity_id) {
    return `/(app)/property/${n.entity_id}`;
  }
  if (n.link?.startsWith('/calendar') || n.type.startsWith('appointment_')) {
    return '/(app)/(tabs)/calendar';
  }
  const conv = n.link?.match(/conversation=([0-9a-f-]+)/i)?.[1];
  if (conv) return `/(app)/conversation/${conv}`;
  return null;
}

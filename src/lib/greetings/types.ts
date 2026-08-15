export interface OccasionGreeting {
  id: string;
  account_id: string;
  created_by: string;
  occasion_id: string | null;
  occasion_label: string;
  message_text: string;
  image_path: string | null;
  status: 'draft' | 'sent';
  broadcast_id: string | null;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
}

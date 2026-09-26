export interface JourneyLifecycleRow {
  mode: 'buyer' | 'property';
  subject_id: string;
  lifecycle_status: 'active' | 'completed' | 'paused' | 'not_proceeding';
  archived_at: string | null;
}

/** A journey the overview still shows as active: no state row, or an
 *  active, unarchived one. Closed and archived journeys are not live. */
export function isLiveJourneyState(
  state:
    | Pick<JourneyLifecycleRow, 'lifecycle_status' | 'archived_at'>
    | undefined
    | null
): boolean {
  if (!state) return true;
  return state.lifecycle_status === 'active' && !state.archived_at;
}

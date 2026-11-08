// Food logs and edits that have not reached the server yet (#47). The queue itself is shared with water.
import { createPendingQueue } from '@/lib/pending-queue';

export { ENTRY_GONE, SYNC_FAILED, SYNC_REFUSED, type PendingOp } from '@/lib/pending-queue';
export const { loadPending, enqueue, discard, flushPending, takeNotices, clear: clearFoodPending } = createPendingQueue('food_entries', 'food-pending');

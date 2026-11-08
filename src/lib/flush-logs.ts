import { flushPending as flushFoodPending } from '@/lib/food/pending';
import { waterQueue } from '@/lib/water/entries';

// Food and water logged offline otherwise sync only when their own screen opens. Screens that show their totals
// (Summary, a group) send them first, so those totals include them. A failure leaves them queued for the next try.
export const flushLocalLogs = (uid: string) => Promise.allSettled([flushFoodPending(uid), waterQueue.flushPending(uid)]);

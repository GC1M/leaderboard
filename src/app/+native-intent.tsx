import { importRouteFor } from '@/lib/workout-import/route';

// A CSV shared to Leaderboard (Export in Strong, Hevy and so on, then Leaderboard in the share sheet) opens the app
// with a file:// URL instead of a route. Send it to the import preview; every other link is left alone.
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  try {
    return importRouteFor(path) ?? path;
  } catch {
    return path;
  }
}

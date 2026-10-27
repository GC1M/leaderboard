// Kept apart from the parsers so the native-intent hook loads nothing else at startup.
export const importRouteFor = (url: string) =>
  /^file:\/\//i.test(url) ? `/workouts/import?file=${encodeURIComponent(url)}` : null;

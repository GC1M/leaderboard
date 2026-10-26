// Everything the app writes to Apple Health carries these keys. They let a retry or another device replace the same
// sample instead of adding a copy, let deletes target only our own samples, and let the importer ignore them.
export const APP_RECORD_KEY = 'LeaderboardRecordId';

export const syncIdentifier = (kind: string, recordId: string) => `leaderboard:${kind}:${recordId}`;

// Pass as `metadata` when saving a sample. HealthKit replaces a sample with the same sync identifier only when the
// version is higher, so a bumped version is how an edit re-saves.
export const exportMetadata = (kind: string, recordId: string, version: number) => ({
  HKMetadataKeySyncIdentifier: syncIdentifier(kind, recordId),
  HKMetadataKeySyncVersion: version,
  [APP_RECORD_KEY]: `${kind}:${recordId}`,
});

export const isOwnExport = (metadata: { [key: string]: unknown } | undefined | null) => metadata?.[APP_RECORD_KEY] !== undefined;

// Statistics/sample filter that leaves out our own exports, so exported steps are never imported back.
export const EXCLUDE_OWN_EXPORTS = { NOT: [{ metadata: { withMetadataKey: APP_RECORD_KEY } }] };

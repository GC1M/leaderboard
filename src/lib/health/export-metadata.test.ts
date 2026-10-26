import { APP_RECORD_KEY, EXCLUDE_OWN_EXPORTS, exportMetadata, isOwnExport, syncIdentifier } from './export-metadata';

test('export metadata carries a stable sync identifier, the version, and our record key', () => {
  expect(exportMetadata('weight', 'r1', 4)).toEqual({
    HKMetadataKeySyncIdentifier: 'leaderboard:weight:r1', HKMetadataKeySyncVersion: 4, [APP_RECORD_KEY]: 'weight:r1',
  });
  expect(syncIdentifier('weight', 'r1')).toBe(exportMetadata('weight', 'r1', 9).HKMetadataKeySyncIdentifier);
});

test('only samples tagged with our record key count as our exports', () => {
  expect(isOwnExport(exportMetadata('weight', 'r1', 1))).toBe(true);
  expect(isOwnExport({ HKMetadataKeySyncIdentifier: 'other-app:1' })).toBe(false);
  expect(isOwnExport(undefined)).toBe(false);
  expect(EXCLUDE_OWN_EXPORTS.NOT[0].metadata.withMetadataKey).toBe(APP_RECORD_KEY);
});

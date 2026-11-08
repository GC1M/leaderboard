// QA (#64): adding Android must not change the module name JS loads or the Apple (Vision) implementation iOS links.
const { readFileSync } = jest.requireActual('fs') as { readFileSync: (path: string, encoding: string) => string };
const read = (f: string) => readFileSync(`${process.cwd()}/modules/leaderboard-text-recognizer/${f}`, 'utf8');

test('the Apple platform still points at the Vision module under the name JS requires', () => {
  const config = JSON.parse(read('expo-module.config.json'));
  expect(config.platforms).toContain('apple');
  expect(config.apple.modules).toEqual(['LeaderboardTextRecognizerModule']);
  const swift = read('apple/LeaderboardTextRecognizerModule.swift');
  expect(swift).toContain('Name("LeaderboardTextRecognizer")');
  expect(swift).toMatch(/import Vision/);
  expect(read('apple/LeaderboardTextRecognizer.podspec')).not.toMatch(/MLKit|GoogleMLKit/i);
  expect(read('../../src/lib/food/photo.ts')).toContain("requireOptionalNativeModule<Recognizer>('LeaderboardTextRecognizer')");
});

import { normalizePhone } from './phone';

test.each([
  ['(555) 555-0100', '+15555550100'],
  ['(415) 212-7777', '+14152127777'],
  ['415-212-7777', '+14152127777'],
  ['1 415 212 7777', '+14152127777'],
  ['+1 415.212.7777', '+14152127777'],
  ['+44 20 7946 0958', '+442079460958'],
])('normalizes %s', (input, expected) => {
  expect(normalizePhone(input)).toBe(expected);
});

test.each(['', 'abc', '12345', '+123', '0152127777', '+0 415 212 7777', '415 212 7777 99', 'a@b.co'])(
  'rejects %s',
  (input) => {
    expect(normalizePhone(input)).toBeNull();
  },
);

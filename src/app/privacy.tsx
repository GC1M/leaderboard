import { Text, View } from 'react-native';

import { Screen, styles } from '@/components/ui';
import { useTheme } from '@/theme';

// Keep in step with what the app actually stores and shares.
const SECTIONS: { title: string; body: string[] }[] = [
  {
    title: 'What Leaderboard reads from Apple Health',
    body: [
      'Only what you allow on your iPhone, and only steps, sleep, weight, and workouts. It never reads your location, heart rate, or anything else.',
      'Steps: a daily total for each day. Sleep: how long you were asleep each night, and when that sleep started and ended. Weight: each reading and when it was taken. Workouts: the activity type, start and end time, duration, and distance or energy when recorded.',
      'The first import looks back 90 days for steps and sleep, and at all your weight readings. After that, imports run only while the app is open.',
    ],
  },
  {
    title: 'What Leaderboard saves to Apple Health',
    body: [
      'Only entries you create in this app, and only when you turn on "Also save to Apple Health" for that entry. You allow each type separately on your iPhone: workouts, weight, sleep, and steps.',
      'Workouts: the activity type, start and end time, and duration, plus distance or energy only if you recorded them. Your exercises, sets, loads, and notes stay in this app. Weight: the reading and when it was taken. Sleep: when you went to sleep and woke. Steps: steps you entered by hand.',
      'It never writes back anything it imported from Apple Health, and it never changes entries made by other apps. If you edit or delete an entry here, the copy it saved to Health is updated or removed.',
    ],
  },
  {
    title: 'What is stored on our server',
    body: [
      'Your account: the name you choose, the email, phone number, or Apple or Google account you sign in with, and your time zone (so days line up with your local calendar).',
      'Your groups, and the steps, sleep, and weight above, plus anything you enter by hand. Workouts you log or import, with your exercises, sets, and notes, and your workout templates, are stored for you only. Each day records whether it came from Apple Health or manual entry.',
      'The data is stored in a Supabase database. It is not sold, not used for advertising, and not shared with anyone else.',
    ],
  },
  {
    title: 'What is stored on this iPhone',
    body: [
      'Your sign-in session, kept in the iPhone keychain, and an encrypted record of what has already been imported, so each import only sends changes.',
    ],
  },
  {
    title: 'What your groups see',
    body: [
      'You choose what each group sees, separately for steps, sleep, weight, and workouts, in Group Info. Steps are shared when you join a group, and you can turn that off. Sleep, weight, and workouts are never shared unless you turn them on.',
      'Steps: your daily totals and whether a day was entered by hand. Sleep: how long you slept each night, not when. Weight: your latest reading and its date, and progress toward a weight goal. Your other weight readings are never shown. Workouts: how many you did each week and your total time, nothing about which exercises you did.',
      'Group members can see your name and which metrics you share. A group owner can delete a step count you entered by hand today, and nothing else of yours.',
    ],
  },
  {
    title: 'Stopping and deleting',
    body: [
      'Stop Health Imports (on Summary) stops reading Apple Health. Data already uploaded stays until you delete it.',
      'Delete Imported Health Data (in Profile) stops imports and deletes every step, sleep, and weight record that came from Apple Health. Manual entries, groups, and sharing choices stay. Nothing is uploaded again until you reconnect Apple Health, which starts a fresh import.',
      'Delete Account (in Profile) deletes your account, everything above, your memberships, and groups you own.',
      'Deleted data may remain in our hosting provider’s database backups until they expire.',
      'To change what Leaderboard can read, open the Health app, tap your profile picture, then Apps, then Leaderboard. Stopping imports here does not change those permissions.',
    ],
  },
];

export default function Privacy() {
  const t = useTheme();
  return (
    <Screen title="Privacy" back>
      {SECTIONS.map((s) => (
        <View key={s.title} style={{ gap: 8, marginBottom: 20 }}>
          <Text accessibilityRole="header" style={[styles.heading, { color: t.ink }]}>
            {s.title}
          </Text>
          {s.body.map((p) => (
            <Text key={p} style={[styles.body, { color: t.ink }]}>
              {p}
            </Text>
          ))}
        </View>
      ))}
    </Screen>
  );
}

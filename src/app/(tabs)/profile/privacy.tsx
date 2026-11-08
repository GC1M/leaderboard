import { Platform, Text, View } from 'react-native';

import { Screen, styles } from '@/components/ui';
import { useTheme } from '@/theme';

// Keep in step with what the app actually stores and shares.
const SECTIONS: { title: string; body: string[] }[] = [
  {
    title: 'What Leaderboard reads from Apple Health',
    body: [
      'Only what you allow on your iPhone, and only steps, sleep, weight, workouts, and water. It never reads your location, heart rate, or anything else.',
      'Steps: a daily total for each day. Sleep: how long you were asleep each night, and when that sleep started and ended. Weight: each reading and when it was taken. Workouts: the activity type, start and end time, duration, and distance or energy when recorded. Water: each amount, when it was recorded, and the name of the app or device that recorded it (for example WaterMinder).',
      'The first import looks back 90 days for steps and sleep, and at all your weight readings. After that, imports run only while the app is open.',
    ],
  },
  {
    title: 'What Leaderboard saves to Apple Health',
    body: [
      'Only entries you create in this app, and only when you turn on "Also save to Apple Health" (or "Save food to Apple Health" for food). You allow each type separately on your iPhone: workouts, weight, sleep, steps, and each nutrient.',
      'Workouts: the activity type, start and end time, and duration, plus distance or energy only if you recorded them. Your exercises, sets, loads, and notes stay in this app. Weight: the reading and when it was taken. Sleep: when you went to sleep and woke. Steps: steps you entered by hand. Food: for each food you logged in the last 90 days, the food name (stored in Health with it), when you ate it, and the nutrients we know for the amount you ate (calories, protein, carbs, fat, fiber, sugars, saturated fat, and sodium). A nutrient we do not know is left out, never saved as zero, and only the nutrients you allow are saved. Your ingredients, recipes, and photos stay in this app. Water: only water you add in this app, with its amount and time, when you turn on saving water to Apple Health on the Water screen.',
      'It never writes back anything it imported from Apple Health, and it never changes entries made by other apps. If you edit or delete an entry here, the copy it saved to Health is updated or removed.',
    ],
  },
  {
    title: 'What is stored on our server',
    body: [
      'Your account: the name you choose, the email, phone number, or Apple or Google account you sign in with, and your time zone (so days line up with your local calendar).',
      'Your groups, and the steps, sleep, and weight above, plus anything you enter by hand. Workouts you log or import, with your exercises, sets, and notes, and your workout templates, are stored for you only. A workout file you import from another app (Strong, Hevy, Fitbod, or JEFIT) is read on your phone; only the workouts in it are saved, never the file. Each day records whether it came from Apple Health or manual entry.',
      'Food you log: the food, how much, the meal, and when. A food you search for is sent from our server to the U.S. Department of Agriculture’s FoodData Central, which returns the nutrition data. Your search words are sent, but not your name or account. Our server keeps a copy of the foods it finds, shared by everyone. Foods you create and entries you log are stored for you only. Nutrition values are estimates, not medical advice.',
      'Water: each amount, when you drank it, your time zone, and whether you added it here or it came from Apple Health (with the source app name). Your daily water target, if you set one. Stored for you only.',
      'The data is stored in a Supabase database. It is not sold, not used for advertising, and not shared with anyone else.',
    ],
  },
  {
    title: 'What is stored on this iPhone',
    body: [
      'Your sign-in session, kept in the iPhone keychain, and an encrypted record of what has already been imported, so each import only sends changes.',
      'A photo of a nutrition label or menu that you take or choose is read on this iPhone with Apple’s text recognition and deleted right after. It is never uploaded or kept. Only the food you check and save is stored, like any other custom food or entry.',
    ],
  },
  {
    title: 'What your groups see',
    body: [
      'You choose what each group sees, separately for steps, sleep, weight, workouts, food, and water, in Group Info. Steps are shared when you join a group, and you can turn that off. Sleep, weight, workouts, food, and water are never shared unless you turn them on.',
      'Steps: your daily totals and whether a day was entered by hand. Sleep: how long you slept each night, not when. Weight: your latest reading and its date, and progress toward a weight goal. Your other weight readings are never shown. Workouts: how many you did each week and your total time, nothing about which exercises you did. Food: your total calories, protein, carbs, and fat for each day you logged food, and whether some foods had no value for them. Never which foods, meals, recipes, or amounts, and never ranked or used in a competition. Water: your total for each day you logged water. Never each drink, its time, or the app it came from, and never ranked.',
      'Group members can see your name, your time zone (used to work out your day), and which metrics you share. A group owner can delete a step count you entered by hand today, and nothing else of yours.',
    ],
  },
  {
    title: 'Competitions',
    body: [
      'Competitions are optional. Joining a group never enrolls you. Before joining a competition, review its dates, timezone, source eligibility and versioned scoring rules. Currently only steps are available; sleep, weight and food are not ranked.',
      'Current group members can see competition totals, ranks, source counts and data freshness while the required metric sharing is on. Your detailed contribution explanations are visible only to you. Turning sharing off hides your results even after finalization. Leaving a group ends participation; returning does not automatically enroll you again.',
      'Uploads, edits and deletions affect provisional scores until someone explicitly finalizes results, at least 24 hours after the end. Finalized scores are stored as a snapshot and later source edits or deletions do not change them. Your sharing choice still applies, and deleting your account removes your participation and stored results.',
      'Creators and current group owners can cancel a competition before it ends, or remove a participant before finalization, with a reason. Group members see the activity log, including generic notices that source records changed. The log contains no raw health measurements. Review flags do not alter your original records.',
    ],
  },
  {
    title: 'Stopping and deleting',
    body: [
      'Stop Health Imports (on Summary) stops reading Apple Health. Data already uploaded stays until you delete it.',
      'Delete Imported Health Data (in Profile) stops imports and deletes every step, sleep, weight, workout, and water record that came from Apple Health. Manual entries, groups, and sharing choices stay. Nothing is uploaded again until you reconnect Apple Health, which starts a fresh import.',
      'Delete Food History (in Profile) deletes every food entry, recipe, and custom food you saved, and the food changes waiting on this iPhone. Your sharing choices stay. You choose whether food this app saved to Apple Health is removed too; if you keep it, you can delete it in the Health app. The same choice appears when you turn off "Save food to Apple Health" and when you delete your account. Your choice applies to this iPhone: another device signed in to your account keeps its own record of what it saved.',
      'Delete Water History (in Profile) deletes every water entry, added here or imported from Apple Health, your water target, and the water changes waiting on this iPhone. Your sharing choices stay. You choose whether water this app saved to Apple Health is removed too. Water other apps saved to Health is never touched, and water drunk before the deletion is not imported again.',
      'Delete Account (in Profile) deletes your account, everything above, your memberships, and groups you own.',
      'Deleted data may remain in our hosting provider’s database backups until they expire.',
      'To change what Leaderboard can read, open the Health app, tap your profile picture, then Apps, then Leaderboard. Stopping imports here does not change those permissions.',
    ],
  },
];

// Android uses Health Connect. Same policy, with the provider's own names and settings path, and what it does not save.
const ANDROID: [string, string][] = [
  ['To change what Leaderboard can read, open the Health app, tap your profile picture, then Apps, then Leaderboard.', 'To change what Leaderboard can read, open Health Connect, then App permissions, then Leaderboard.'],
  ['After that, imports run only while the app is open.', 'If you do not allow access to past data, Health Connect limits the first import to about 30 days. After that, imports run only while the app is open.'],
  ['delete it in the Health app', 'delete it in Health Connect'],
  ['You allow each type separately on your iPhone: workouts, weight, sleep, steps, and each nutrient.', 'You allow each type separately in Health Connect: workouts, weight, sleep, and nutrition. Steps are not saved to Health Connect.'],
  ['Steps: steps you entered by hand. ', ''],
  [' (stored in Health with it)', ''],
  [', plus distance or energy only if you recorded them', ''],
  [', and only the nutrients you allow are saved', ''],
  ['the iPhone keychain', 'the Android Keystore'],
  ['with Apple’s text recognition', 'with on-device text recognition'],
  ['Apple Health', 'Health Connect'],
  ['on your iPhone', 'on your phone'],
  ['this iPhone', 'this phone'],
];
const androidText = (text: string) => ANDROID.reduce((s, [from, to]) => s.split(from).join(to), text);
const sections = () => Platform.OS !== 'android' ? SECTIONS : SECTIONS.map((s) => ({ title: androidText(s.title), body: s.body.map(androidText) }));

export default function Privacy() {
  const t = useTheme();
  return (
    <Screen title="Privacy" back>
      {sections().map((s) => (
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

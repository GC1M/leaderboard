import { Redirect } from 'expo-router';

// The group list is home.
export default function Home() {
  return <Redirect href="/groups" />;
}

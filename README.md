# Leaderboard

Free social leaderboard app for friend groups: steps, workouts, weight goals, and screen time.

## Setup

Requires Node 22.

```bash
npm ci
cp .env.example .env   # fill in EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY
npm start              # then press i (iOS) or a (Android), or scan with Expo Go
```

Scripts:

- `npm run typecheck`: TypeScript check
- `npm run lint`: ESLint via Expo
- `npm test`: Jest (jest-expo)

Supabase config lives in `supabase/` (managed with the Supabase CLI).

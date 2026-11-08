# Phase 3 validation

Rules: [version 1](rules-v1.md). New competitions currently support steps only. Workout count/duration stay disabled until Phase 2 physical-device validation (#35/#37) passes.

## Automated release checks

Run `npm run typecheck`, `npm run lint`, `npm test -- --coverage`, `supabase test db`, `npm run smoke:api`, and `npm run smoke:web` against the local Supabase stack. CI also regenerates database types and exports iOS/web bundles.

| Coverage | Executable check |
| --- | --- |
| Whole local days, spring/fall DST, inclusive start/exclusive end | `competition_model.test.sql`, `competition_regressions.test.sql` |
| Create/invite/explicit opt-in/leave, deadlines and source settings | `competition_enrollment.test.sql`, API smoke |
| Shared ranks with gaps, missing vs recorded zero, manual exclusion | `competition_scoring.test.sql`, regression SQL, standings component test |
| Concurrent standings refresh and duplicate finalization | API smoke: three simultaneous authenticated RPCs; one snapshot and audit event |
| Corrections before finalization, immutable results after deletion | Scoring SQL and API smoke |
| Sharing revocation, current timezone, leaving/rejoining group, account deletion | Scoring/regression SQL and API smoke |
| Unauthorized reads/writes and moderator reasons | Model/integrity SQL and API smoke |
| Own contribution explanations, anomaly flags, correction audit | Regression SQL and API smoke |
| Invite survives sign-in, separate group and competition consent, tabs, zero vs missing | Chromium web smoke using synthetic API responses |

The browser fixture validates routing and rendering; the API/SQL tests validate actual authorization and scoring. Neither proves native HealthKit permissions, native deep links, background/resume behavior, or VoiceOver.

## Physical iPhone checks — pending

Do not mark #43 complete or enable workout competitions until the relevant device checks are recorded. For each run, record app commit/build, iPhone/iOS versions, timezone, two test accounts, actual result, and screenshots with private data removed.

- [ ] Open a shared `leaderboard://join/CODE?competition=UUID` link while signed out, sign in, and confirm the competition survives. Confirm joining the group does not enroll; cancel both consent stages independently.
- [ ] Open the same link while signed in, from Messages and the share sheet. Try invalid/deleted competition and group links and expired/started challenges.
- [ ] Join with Health step permission granted and with no readings. Check recorded zero versus missing, source labels, rule text, shared-rank ties, freshness and provisional/final state on two phones.
- [ ] Revoke group step sharing while another phone displays standings; refresh and resume the screen. Confirm score, rank, source counts and freshness disappear from both live and final results.
- [ ] Correct/delete an eligible sample and sync before finalization; verify revised provisional score and own explanation. Repeat after finalization and verify frozen score. Stop/reconnect imports and repeat.
- [ ] Test timezone mismatch, spring/fall DST fixtures, join at start, leave at end, and concurrent finalization on two devices. Do not alter production clocks or data.
- [ ] Remove participant/cancel as creator and current group owner; require reasons, verify activity log and original Health measurements remain. Attempt the same as an ordinary member.
- [ ] Leave/rejoin a group and delete a test account; ensure consent is not restored and other members cannot read withdrawn/deleted data.
- [ ] Check VoiceOver labels/order, Dynamic Type, light/dark themes, small screens, persistent tabs, foreground refresh, offline errors and retry.

All automated checks must pass on the final PR head. Physical checks remain outstanding until an actual device run is documented; an exported iOS bundle is not a device test.

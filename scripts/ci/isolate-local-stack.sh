#!/bin/sh
# Self-hosted runners share Docker with the developer's own local Supabase stack. Give CI its own project name and
# ports (543xx -> 553xx, inspector 8083 -> 9083) so it never reuses or collides with that stack.
# Edits only this checkout's supabase/config.toml.
set -eu
sed -i.bak \
  -e 's/^project_id = .*/project_id = "LeaderboardCI"/' \
  -e 's/^\([a-z_]*port = \)543\([0-9][0-9]\)$/\1553\2/' \
  -e 's/^inspector_port = 8083$/inspector_port = 9083/' \
  supabase/config.toml
rm -f supabase/config.toml.bak
grep -E '^(project_id|[a-z_]*port) = ' supabase/config.toml

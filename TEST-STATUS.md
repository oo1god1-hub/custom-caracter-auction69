# V2.1 Repair & Verification Status

This is a **reviewed candidate**, not a production-certified release. Statuses below distinguish code presence from runtime verification.

## Checks actually performed in this environment
- `node --check server.js`: PASS (Node v22.16.0).
- `node --check public/client.js`: PASS (Node v22.16.0).
- ZIP integrity: PASS after packaging (see final verification).
- Source/README/previous status file inspected before edits.
- Default roster migration fix: saved default gameplay fields (especially old power) no longer override the current canonical default tier/price/power/name; existing default image references and image metadata are preserved.

## Implemented by source inspection (not end-to-end tested)
- 20-second auction opening and 5-second accepted-bid deadline reset.
- Surprise Mode chooses exactly 8 shuffled characters and hides lobby roster.
- Normal solo and admin-only custom solo create one human plus two bots.
- Default characters protected from deletion and always enabled for normal multiplayer.
- Custom character enable/disable applies to newly created multiplayer room snapshots.
- Cloudinary upload cap remains 25 MiB; PNG/JPG/JPEG/WEBP/GIF accepted; app does not resize images.
- Roster/room persistence, atomic writes, backups, reconnect token flow and restart timer restoration are present in source.
- Admin routes use server-side admin authentication.

## Pending / not verified
- Requirements 1–3: browser/server race, queued requests while offline, duplicate create/join across retries, reconnection retry and all connection states.
- Requirements 4–8: full timer race-condition, cross-device deadline synchronization, pause/resume and simultaneous-bid testing.
- Requirements 9–11: independent shuffle statistical check and hidden-roster leakage audit across all client events.
- Requirements 12–15: Render Persistent Disk, legacy migration, backup restoration, corrupt JSON recovery and Cloudinary URL replacement/restart testing.
- Requirements 16–19: active-room recovery, player identity recovery, host disconnect, disconnected bidder and room-state consistency testing.
- Requirements 20–24: bot decision quality, fairness, budget edge cases, counter-bidding and variety testing.
- Requirements 25–27: all 16 original names/tiers/images against the user's original live roster; exact power rules and result calculations.
- Requirements 28–31: admin permissions and mid-auction roster snapshot behavior under live testing.
- Requirements 32–34: admin custom solo selection/exclusion and isolation testing.
- Requirements 35–37: real Cloudinary upload, original pixel dimensions, GIF behavior, replacement reference and upload failure tests.
- Requirements 38–41: room cleanup, duplicate bid/event handling, session expiry/rate-limit behavior and malformed request tests.
- Requirements 42–47: all functional, three-device multiplayer, restart, admin, bot and regression tests.

## Important code-review notes
- The client currently reports a disconnected state as “Reconnecting”; a full connection-state UX audit is still pending.
- Create/join requests are not persisted in an offline queue; the client asks the user to retry if not connected.
- Login throttling is in-memory and resets after process restart; use a proxy/WAF rate limit for production.
- Admin/game sessions are in-memory and require re-authentication after restart.
- Reconnect tokens are stored in persistent room data and browser session storage; protect access to the disk and never share the ZIP or room data publicly.
- No full dependency-backed integration tests were run here. Do not treat source presence or syntax checks as proof of feature completion.

## Release gate
Do not call this production-ready until the Pending items are tested on the actual hosting setup and documented with results. `Implemented` means source code appears present; `Tested` means a repeatable test was actually run; `Pending` means not verified or not fully implemented.

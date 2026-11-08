# Custom Character Auction — V2

A real-time multiplayer character auction built with Node.js, Express and Socket.IO. Supports up to 3 players per room.

## V2 features
- Game password required on each fresh page load. The password is checked server-side and is never stored in the browser; the browser keeps only an in-memory access token.
- Separate server-side admin login.
- 15,000 coins per player.
- Default character roster and tier starting bids: SSS 1,000; SS 800; S 500; A 300; B 100.
- 16 default characters, including Neha (A tier).
- Quick bid with a player-controlled increment (default +50); manual bids remain available.
- Each new character starts at 20 seconds. Every accepted bid resets the countdown to exactly 5 seconds (the on-screen confirmation now correctly says the timer was reset, not that 5 seconds were added).
- Side-by-side team panels with character thumbnails, tiers and remaining budgets. Team power is withheld until the auction ends.
- Host-only pause/resume.
- End-of-game results, team power comparison, spending, remaining budget and auction history.
- Admin panel to upload/replace character images, add custom characters, enable/disable custom characters for future multiplayer rooms, and remove custom characters. Default characters remain protected and always included in normal multiplayer.
- Character images upload to Cloudinary as authenticated assets.
- Normal single-player mode creates one human player and exactly two computer bidders with different bidding personalities. Bot decisions consider tier, power, opening/current price, available budget and team needs.
- Admin-only custom single-player mode lets an authenticated admin select any default/custom characters (including disabled custom characters) and play against exactly two bots. This selection does not change normal multiplayer availability.
- Custom character enable/disable controls affect newly created multiplayer rooms; defaults remain protected in normal multiplayer.
- Active room state is written to `rooms.json` on room updates and restored on server startup. Auction timers are reconstructed from saved end times. Player reconnect tokens allow an existing player to reclaim their room identity after reconnecting; after a page reload the user must unlock the game again.
- Roster updates are written atomically and previous roster versions are copied into `DATA_DIR/backups/`.
- Login endpoints apply an in-process limit of 10 attempts per IP/path in a 10-minute window.
- **Surprise Mode:** the host can enable it in the lobby. The server requires at least 8 available characters and selects exactly 8 at random. The selected roster is hidden in the lobby and characters are revealed one at a time during the auction. Standard Mode continues to show the roster in the lobby.
- **High-resolution image uploads:** the app accepts PNG, JPG/JPEG, WEBP and GIF images up to **25 MiB (26,214,400 bytes)** per image. The app does not resize or downsample images before sending them to Cloudinary.

## Local setup
1. Install Node.js 18 or newer.
2. Run `npm install`.
3. Set the environment variables below.
4. Run `npm start` and open `http://localhost:3000`.

## Required environment variables
Set these in your hosting provider's environment-variable settings. Do not put real passwords or API secrets in this README, source code, or a public repository.

```text
GAME_PASSWORD=<set-a-strong-game-password>
ADMIN_PASSWORD=<set-a-strong-admin-password>
CLOUDINARY_CLOUD_NAME=<your-cloud-name>
CLOUDINARY_API_KEY=<your-api-key>
CLOUDINARY_API_SECRET=<your-api-secret>
DATA_DIR=/var/data
```

Both game and admin passwords must be configured in the hosting environment. There is no hardcoded game-password fallback. The admin panel remains unavailable until `ADMIN_PASSWORD` is set.

## Render deployment and persistence
- Create a Node web service from this project ZIP/repository.
- Build command: `npm install`
- Start command: `npm start`
- Add all environment variables above in Render.
- Attach a Render Persistent Disk and mount it at `/var/data`; set `DATA_DIR=/var/data`. This stores character roster metadata, roster backups and active room/game state across restarts/deploys. On first start, if `/var/data/roster.json` does not exist and a legacy `data/roster.json` is present in the deployed app, the app copies it once. Existing persistent data is never overwritten by that migration.
- Cloudinary stores image assets separately. Configure all three Cloudinary variables before using photo uploads.

## Image upload limits and Cloudinary
- Browser-side and server-side upload limit: **25 MiB per image**. The server uses Multer's file-size limit and rejects unsupported MIME types.
- Cloudinary upload options restrict accepted formats to JPG/JPEG, PNG, WEBP and GIF. Uploads preserve the original image dimensions; no application-side resizing is applied, so high-resolution images can be uploaded within the size limit.
- Cloudinary's own maximum image size and maximum pixel/dimension limits depend on the account/product environment. The Cloudinary API has a general 100 MB per-request ceiling, but the account's configured maximum may be lower. The app's 25 MiB limit is intentionally below that general API ceiling.
- **Important:** the app cannot raise Cloudinary's account-level quota/limits from code. Check the Cloudinary Console's Account/Usage Limits for `image_max_size_bytes` and image pixel limits. If an image exceeds your account's Cloudinary limit, Cloudinary will reject it even though it is below the app's 25 MiB limit. Upgrade/change the account limit in Cloudinary if needed.

## Image privacy note
Images are uploaded as Cloudinary `authenticated` assets and delivered using signed URLs. Signed URLs are access credentials while valid: anyone who obtains a signed URL may be able to view that image. This reduces public discoverability but cannot prevent screenshots, copying, or sharing by an authorized viewer.

## Operational notes
- Persistent Disk is required for durable roster and active-game state. Without `DATA_DIR=/var/data` and a disk mounted at `/var/data`, the app falls back to a local `data` directory that may be ephemeral on the host.
- The first-start roster migration copies a legacy `data/roster.json` only when the configured persistent target does not already exist. It does not overwrite an existing persistent roster. If the saved roster JSON is corrupt, startup fails rather than silently replacing it with defaults.
- Active game rooms, bids, player teams, auction history, timer end-times and pause state are saved in `rooms.json`. On restart, active timers are resumed using their saved end-times; if a timer expired while the server was down, the character is closed when the server starts again.
- Reconnection tokens are stored in the browser's session storage and in the persistent room state. The user must unlock the game again after a full page reload; the reconnect token then restores the same player identity. Clearing browser session storage loses that browser's reconnect credential.
- Admin and game authentication sessions are intentionally in memory and must be re-authenticated after a server restart. Admin-only game reconnection requires logging into the admin panel again.
- Bot bidding uses heuristic strategies, not machine learning. It varies by personality and considers tier, power, current bid, budget and team size/power.
- The server's login-attempt limiter is in-memory; it resets on process restart and is not a substitute for an edge/WAF rate limit.
- Pause/resume is available to the room host during an active auction.
- Admin additions and enable/disable changes apply to newly created multiplayer rooms; existing rooms keep their roster snapshot.
- Custom character editing (name, tier, price and power) is not included; custom characters can be added, enabled/disabled, photographed and removed.

## Power bands used for the default roster
- SSS: 100 (all three SSS characters share the same power).
- SS: 91–94; S: 80–84; A: 70–74; B: 60–64. Each tier is strictly above the tier below it.

## Build status
This archive includes the features described above, but it has not yet passed a full live multiplayer, Cloudinary, Render Persistent Disk, migration or restart/reconnect integration test. Syntax checks are required before release. Treat it as a candidate build, not as production-verified, until those tests are completed.

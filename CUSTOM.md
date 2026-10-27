# CarsonJF/t3code custom build

This fork ships **latest upstream nightly + the commits on `custom`** as Windows x64 and
macOS desktop builds that auto-update from this fork's releases, plus an Android APK.

## Branches

- `main`: pure mirror of `pingdotgg/t3code` main. Never commit to it; the pipeline force-updates it.
- `custom` (default branch): the upstream nightly tag plus our commits. Our commits are
  everything on `custom` that is not on upstream main. CI files live only in new files
  (`.github/workflows/custom-nightly.yml`, this file), so rebases never conflict on them.

## How the pipeline works

`.github/workflows/custom-nightly.yml` runs every 3 hours (and on demand):

1. Finds the newest published upstream `v*-nightly.*` release. If this fork's release
   `<that tag>-custom` already has every platform (`nightly.yml`, `nightly-mac.yml`, an
   `.apk`), it stops. If it has only some, it rebuilds just the missing platforms at that
   release's commit and attaches them (no rebase).
2. Rebases our commits onto that tag (`git rebase --onto <tag> <old base>`), runs
   `vp run check:changed <tag>` (format, lint, knip, affected typecheck, tests beside our
   changes), then pushes `custom` with `--force-with-lease` and mirrors `main`.
3. Builds three platforms in parallel, independently, all with the upstream version number
   and the T3 Connect repo variables (`T3CODE_CLERK_*`, `T3CODE_RELAY_URL`):
   - Windows: NSIS installer on `windows-latest`, update feed pointed at this fork
     (`T3CODE_DESKTOP_UPDATE_REPOSITORY`), `dev` telemetry, upstream's Linux CLI archive of
     the same nightly as the WSL runtime.
   - macOS: dmg + zip for arm64 and x64 on `macos-26`, same feed override, signed with the
     fork's self-signed certificate (secret `CUSTOM_MAC_SIGNING_P12`) so updates verify.
     Not notarized.
   - Android: `APP_VARIANT=preview` release APK (arm64) via `expo prebuild` + Gradle, OTA
     updates off, re-signed with the fork's keystore (secret `CUSTOM_ANDROID_KEYSTORE`).
4. Publishes a prerelease with whatever built. A platform that failed is retried by the next
   scheduled run until a newer upstream nightly replaces the release.

Any failure opens (or comments on) one issue titled `custom-nightly failed`; a later run
with no failed build closes it. A conflicted rebase is aborted, so `custom` is never pushed
half-rebased. Pushes use the `CUSTOM_NIGHTLY_DEPLOY_KEY` secret (a write deploy key), because
`GITHUB_TOKEN` cannot push commits that touch workflow files.

The job also re-disables every other workflow on the fork, so inherited upstream
workflows never run here.

## Pause / resume

    gh workflow disable custom-nightly.yml -R CarsonJF/t3code
    gh workflow enable custom-nightly.yml -R CarsonJF/t3code

Run now: `gh workflow run custom-nightly.yml -R CarsonJF/t3code` (add `-f force=true` to
rebuild an existing release, `-f upstream_tag=v...` to pick a tag). If the macOS job fails with
"not acquired by Runner", arm64 runners are out of capacity: rerun with `-f mac_runner=macos-15-intel`.

## Resolving a rebase conflict

    git fetch upstream --tags && git fetch origin
    git switch custom && git reset --hard origin/custom
    git rebase --onto <upstream tag from the issue> $(git merge-base HEAD upstream/main)
    # fix conflicts, git add, git rebase --continue
    git push --force-with-lease origin custom
    gh workflow run custom-nightly.yml -R CarsonJF/t3code

## Installing

### Windows

Download `T3-Code-<version>-x64.exe` from the newest release and run it. It installs over
the stock T3 Code (Nightly) (same app id, product name and data directory), keeping all
data and settings. SmartScreen warns because it is unsigned: More info, then Run anyway.
From then on the app updates from this fork's releases. Reinstalling a stock installer
switches updates back to upstream.

### macOS

Download `T3-Code-<version>-arm64.dmg` (Apple silicon) or `-x64.dmg` (Intel), drag the app
to Applications, replacing a stock T3 Code (Nightly) if present. Data and settings carry
over (same app id and data directory). Once: open it, dismiss the "cannot verify" dialog,
then System Settings > Privacy & Security > Open Anyway (or run
`xattr -dr com.apple.quarantine "/Applications/T3 Code (Nightly).app"`). macOS may ask once
for keychain access to "T3 Code (Nightly) Safe Storage" and re-ask for camera, microphone,
screen recording or folder permissions, because the signer changed. After that it
auto-updates from this fork like Windows; updates only work from a build of this fork, not
from a stock install.

### Android

Download `T3-Code-Custom-<version>-android-arm64.apk` on the phone and open it; allow
"Install unknown apps" for the browser or file manager when asked. It installs as
**T3 Code Preview** (`com.t3tools.t3code.preview`) next to the store app, so pair it again
and sign in to T3 Connect again. Scan pairing QR codes with the app's own scanner (the
system camera opens the store app). Updates are manual: install the newer APK over the old
one; data is kept. No push notifications (no Firebase config).

## Signing keys

The macOS certificate and the Android keystore exist only in the repo secrets
(`CUSTOM_MAC_SIGNING_P12`/`_PASSWORD`, `CUSTOM_ANDROID_KEYSTORE`/`_PASSWORD`) and the
owner's offline backup. Keep the backup: with a new key, the installed Mac app stops
accepting updates and the APK no longer installs over the old one, so each needs a one-time
manual reinstall (Android: uninstall first, losing app data).

# CarsonJF/t3code custom build

This fork ships **latest upstream nightly + the commits on `custom`** as a Windows x64
installer that auto-updates from this fork's releases.

## Branches

- `main`: pure mirror of `pingdotgg/t3code` main. Never commit to it; the pipeline force-updates it.
- `custom` (default branch): the upstream nightly tag plus our commits. Our commits are
  everything on `custom` that is not on upstream main. CI files live only in new files
  (`.github/workflows/custom-nightly.yml`, this file), so rebases never conflict on them.

## How the pipeline works

`.github/workflows/custom-nightly.yml` runs every 3 hours (and on demand):

1. Finds the newest published upstream `v*-nightly.*` release. If this fork already has a
   release `<that tag>-custom`, it stops.
2. Rebases our commits onto that tag (`git rebase --onto <tag> <old base>`), runs
   `vp run check:changed <tag>` (format, lint, knip, affected typecheck, tests beside our
   changes), then pushes `custom` with `--force-with-lease` and mirrors `main`.
3. Builds the NSIS installer on `windows-latest` with the upstream version number, the
   update feed pointed at this fork (`T3CODE_DESKTOP_UPDATE_REPOSITORY`), `dev` telemetry,
   and upstream's Linux CLI archive of the same nightly as the WSL runtime.
4. Publishes a prerelease with the `.exe`, `.exe.blockmap` and `nightly.yml`.

Any failure opens (or comments on) one issue titled `custom-nightly failed`; a later
successful run closes it. A conflicted rebase is aborted, so `custom` is never pushed
half-rebased. Pushes use the `CUSTOM_NIGHTLY_DEPLOY_KEY` secret (a write deploy key), because
`GITHUB_TOKEN` cannot push commits that touch workflow files.

The job also re-disables every other workflow on the fork, so inherited upstream
workflows never run here.

## Pause / resume

    gh workflow disable custom-nightly.yml -R CarsonJF/t3code
    gh workflow enable custom-nightly.yml -R CarsonJF/t3code

Run now: `gh workflow run custom-nightly.yml -R CarsonJF/t3code` (add `-f force=true` to
rebuild an existing release, `-f upstream_tag=v...` to pick a tag).

## Resolving a rebase conflict

    git fetch upstream --tags && git fetch origin
    git switch custom && git reset --hard origin/custom
    git rebase --onto <upstream tag from the issue> $(git merge-base HEAD upstream/main)
    # fix conflicts, git add, git rebase --continue
    git push --force-with-lease origin custom
    gh workflow run custom-nightly.yml -R CarsonJF/t3code

## Installing the first build

Download `T3-Code-<version>-x64.exe` from the newest release and run it. It installs over
the stock T3 Code (Nightly) (same app id, product name and data directory), keeping all
data and settings. SmartScreen warns because it is unsigned: More info, then Run anyway.
From then on the app updates from this fork's releases. Reinstalling a stock installer
switches updates back to upstream.

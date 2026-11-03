# Orca Local

This fork ports the behavior described by [sglanzer/orca's local fork guide](https://github.com/sglanzer/orca/blob/427763d/LOCAL-FORK.md) onto upstream main commit `641e4792b966960d65bd82a3744fe087a5ac05cb`. The reference fork used upstream `v1.4.224`; its older build commands and recovery implementation are adapted to this checkout.

OpenClaw session discovery, state-directory environment forwarding, automation discovery and commands, and selectable agent entries are removed. Persisted identifiers and transcript parsers remain readable for compatibility. Other supported agents and Orca's own automations remain supported. Endpoint protection settings are unchanged.

## Build and run from source

Use Node 24, the pnpm version pinned in `package.json`, and the Bun version in `config/.bun-version`. Install the platform's native build tools described in [CONTRIBUTING.md](../.github/CONTRIBUTING.md#local-setup). Keep this checkout in a permanent location.

```sh
pnpm install --frozen-lockfile
pnpm -C mobile install --frozen-lockfile
pnpm run build:wsl-guest
node config/scripts/build-cli.mjs
node config/scripts/verify-cli-bin.mjs --fix-executable --fix-package-json
pnpm run build:electron-vite
pnpm run build:web-from-renderer
pnpm run build:mobile-web
pnpm run ensure:electron-runtime
node config/scripts/launch-orca-local.mjs
```

The direct CLI compile and verification avoid `build:cli`'s optional global `/usr/local/bin/orca-dev` registration. Current sources use `build:wsl-guest`; they do not have the reference fork's retired `build:relay` command. The launcher uses built files without a development server. This is an unpackaged development app; its desktop updater is disabled by the existing development-build gate. Packaging a distributable `.app`, DMG, or installer is a separate task.

The launcher keeps its Node supervisor alive until Electron exits. Agent validation must set `ORCA_BACKGROUND_LAUNCH=1`; rendered checks use the Electron skill and Playwright CDP with hidden windows.

## Managed SSH server artifacts

The desktop commands above do not produce `out/orcad-template`, which managed SSH setup uses to assemble and upload its server. This path uses a verified local deployment template; it does not build Orcad on connection or download an upstream Orcad JavaScript bundle as a fallback. Without a template, fresh managed SSH setup reports that artifacts are unavailable. Existing registered servers can keep running their previously installed code until separately updated; rebuilding the desktop does not remove OpenClaw behavior from those runtimes.

Build a current-source template only for the intended server targets. Each target needs a verified native prebuild slot in `out/orcad-prebuilds/<target>`. The template builder builds a missing slot for the build host's own target automatically. Other targets require slots built on compatible runners for their platform and architecture. The mobile web build above must also be present. `build:orcad` alone creates `out/orcad`, which the desktop does not automatically select as a deployment template.

For example, this command on an Apple Silicon Mac produces a template for **macOS arm64 servers only**, including the browser driver needed by a source checkout:

```sh
env ORCAD_OMIT_AGENT_BROWSER=0 pnpm run build:orcad-template --targets darwin-arm64
```

Choose the actual target list when building for SSH hosts; `--targets` accepts a comma-separated subset of the targets in `src/shared/node-runtime-pin.ts`. For example, Linux x64 with glibc uses `linux-x64-glibc`, whose verified native slot must first be built on a compatible Linux x64 runner. On PowerShell, set `$env:ORCAD_OMIT_AGENT_BROWSER = '0'` before the `pnpm` command instead of using `env`. Omitting `--targets` requests the entire platform matrix and requires all corresponding slots.

A server JavaScript compile and static scan can verify the current fork's server entry without creating this deployable template. A complete target template also needs its native files, pinned Node reference, child entries, web assets, and verified manifest. Building either artifact does not connect to or update a remote host.

## Stable profile and accounts

The default profile is `orca-local` under the platform's application-data directory:

- macOS: `~/Library/Application Support/orca-local`
- Windows: `%APPDATA%/orca-local`
- Linux: `$XDG_CONFIG_HOME/orca-local`, or `~/.config/orca-local`

Set `ORCA_DEV_USER_DATA_PATH` to select a different profile. The profile lives outside the checkout and is preserved across rebuilds. A valid empty profile is accepted; the launcher does not revive conversations or settings deliberately deleted in Orca. To start a separate empty profile, select a new profile path and a new recovery root together.

Existing upstream Orca data is not imported automatically. Connect accounts in the new profile. Development builds cannot decrypt secrets encrypted by the installed app; see [development-profile seeding](../.github/CONTRIBUTING.md#dev-profiles-and-parallel-instances) before considering an import.

## Recovery copies

The supervisor tries an initial backup, retries startup failures every ten seconds, takes a snapshot every five minutes after success, and takes a final snapshot after Electron exits. SQLite online backup includes committed WAL data without changing the live database's journal mode. Each database is a consistent snapshot; separate databases and transcript files are captured sequentially.

Backups default to `~/Documents/Codex/Orca Recovery/orca-local`; set `ORCA_FORK_RECOVERY_ROOT` to change the destination. Recovery copies must remain outside the live profile. The helper retains twelve recent generations plus one point for each of up to seven distinct days. Generations use private directories and files; they can contain account state, transcripts, and encryption keys. Keep them private. Local copies do not protect against loss of the whole disk.

Copies include settings, workspace state, profile metadata, conversation journals, attachments, managed Codex account homes and ownership markers, supported native local Codex transcripts referenced by the journal, and the native local OpenCode database when a native local OpenCode conversation is recorded. Remote and WSL provider histories are not copied. Symbolic links are not followed or recreated; Orca recreates its managed runtime aliases. Downloadable speech models and browser caches are excluded.

Before launch, unreadable or missing saved data is restored from the newest verified generation, falling back to older valid generations. Healthy state, including intentionally empty databases, is preserved. Current profile-state admission and maintenance ownership exclude running Orca and orcad participants during restoration. Damaged entries are retained in a private sibling `orca-local.before-recovery-*` directory. Existing provider files are never overwritten; only missing files beneath the user's home are eligible for restoration. A provider database with leftover journal sidecars is refused.

If no generation verifies, the launcher stops and preserves the damaged data. An interrupted restore leaves `restore-in-progress.json` in the recovery root and stops subsequent launches for review. `last-recovery.json` records completed restoration; a later provider-copy failure may leave a newly restored, previously missing provider file while the profile is rolled back. These copies remain available for review.

## Optional macOS Dock launcher

After building, run:

```sh
node config/scripts/install-local-dock-launcher.mjs
```

This creates `~/Applications/Orca Local Launcher.app`. Drag that file into the Dock. It starts the source launcher and recovery supervisor without keeping a Terminal window open. Launch errors go to `logs/source-launcher.log` inside the profile. The running Electron app may have its own Dock icon; pin the generated launcher.

The installer remembers the checkout, Node executable, profile, and recovery-root paths. Set overrides when installing. If the Node executable moves, rerun the installer. If the checkout moves, verify and remove its old generated launcher before installing from the new checkout. The installer only replaces a launcher belonging to the same checkout and profile; it does not modify profile data.

## Updates and verification

Quit the source app before updating this branch. Pull only reviewed changes with `git pull --ff-only`, then repeat dependency installation and the build commands above. Reopen the same launcher and profile.

Run the recovery checks against disposable synthetic data after building:

```sh
ORCA_BACKGROUND_LAUNCH=1 pnpm test config/scripts/local-fork-recovery.test.mjs --maxWorkers=2
ORCA_BACKGROUND_LAUNCH=1 pnpm check:changed --maxWorkers=2
```

The checks cover online WAL snapshots, missing-data restoration, fallback from damaged copies, admission/maintenance exclusion, intentionally empty profiles, path containment, retention, and supervisor retries/final snapshots.

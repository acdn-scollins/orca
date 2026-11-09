# Orca Local

This fork follows the behavior described by [sglanzer/orca's local fork guide](https://github.com/sglanzer/orca/blob/427763d/LOCAL-FORK.md). The current update candidate integrates original Orca `v1.4.255`, commit `084ce0eebbdda3f665251984804f2238be666296`, over our previous original-upstream base `641e4792b966960d65bd82a3744fe087a5ac05cb`. See the update record below for qualification and promotion status. The colleague's `v1.4.224` fork is a historical reference; use this checkout's commands and recovery implementation.

OpenClaw session discovery, state-directory environment forwarding, automation discovery and commands, and selectable agent entries are removed. Persisted identifiers and transcript parsers remain readable for compatibility. Other supported agents and Orca's own automations remain supported. Endpoint protection settings are unchanged.

## Build and run from source

Use Node 24, the pnpm version pinned in `package.json`, and the Bun version in `config/.bun-version`. Install the platform's native build tools described in [CONTRIBUTING.md](../.github/CONTRIBUTING.md#local-setup). Keep this checkout in a permanent location.

For `v1.4.255`, the pins are Node 24, pnpm 12.14.0, Bun 1.4.4, and Electron 43.8.6. Check executable versions rather than assuming the shell's defaults match. After activating Node 24, a project-local pnpm bootstrap on POSIX shells is:

```sh
npm install --prefix .tmp/fork-tools --no-save --package-lock=false --ignore-scripts pnpm@12.14.0
export PATH="$PWD/.tmp/fork-tools/node_modules/.bin:$PATH"
export ORCA_PNPM_GLOBAL_VIRTUAL_STORE=0
node --version
pnpm --version
```

Use the same environment for installation, checks, and builds. On PowerShell, set `$env:ORCA_PNPM_GLOBAL_VIRTUAL_STORE = '0'` and prepend the project-local `node_modules/.bin` directory to `$env:PATH`. This opts into per-checkout dependencies so qualifying a candidate does not relink the running checkout's packages. Use frozen installs; do not carry the older pnpm 11 install-layout workaround into candidate qualification. After installation, `pnpm exec bun --version` checks the project-pinned Bun.

```sh
pnpm install --frozen-lockfile
pnpm -C mobile install --frozen-lockfile
pnpm run build:wsl-guest
node config/scripts/cli-build/build-cli.mjs
node config/scripts/cli-build/verify-cli-bin.mjs --fix-executable --fix-package-json
pnpm run build:electron-vite
pnpm run build:web-from-renderer
pnpm run build:mobile-web
pnpm run build:native --single-arch
pnpm run ensure:electron-runtime
node config/scripts/launch-orca-local.mjs
```

The direct CLI compile and verification avoid `build:cli`'s optional global `/usr/local/bin/orca-dev` registration. Current sources use `build:wsl-guest`; they do not have the reference fork's retired `build:relay` command. `build:native --single-arch` builds the local Mac's helper architecture; other platforms retain their existing native build paths. Omit the flag for universal macOS helpers when preparing distributables with a suitable cross-compilation toolchain. The launcher uses built files without a development server. This is an unpackaged development app; its desktop updater is disabled by the existing development-build gate. Packaging a distributable `.app`, DMG, or installer is a separate task.

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

When updating an existing `orca-local` installation, retain this profile path: its configuration, projects, workspaces, accounts, and history remain in that profile. Do not seed an empty profile merely to update the application.

For a first installation, data from a separate upstream Orca profile is not imported automatically. Development builds cannot decrypt secrets encrypted by the installed app; see [development-profile seeding](../.github/CONTRIBUTING.md#dev-profiles-and-parallel-instances) before considering an import. That seeding tool transfers selected configuration into an empty target; it omits active sessions and automations and is not a full profile migration or merge.

## Recovery copies

The supervisor tries an initial backup, retries startup failures every ten seconds, takes a snapshot every five minutes after success, and takes a final snapshot after Electron exits. SQLite online backup includes committed WAL data without changing the live database's journal mode. Each database is a consistent snapshot; separate databases and transcript files are captured sequentially.

Backups default to `~/Documents/Codex/Orca Recovery/orca-local`; set `ORCA_FORK_RECOVERY_ROOT` to change the destination. Recovery copies must remain outside the live profile. The helper retains twelve recent generations plus one point for each of up to seven distinct days. Generations use private directories and files; they can contain account state, transcripts, and encryption keys. Keep them private. Local copies do not protect against loss of the whole disk.

Copies include settings, workspace state, profile metadata, conversation journals, attachments, managed Codex account homes and ownership markers, supported native local Codex transcripts referenced by the journal, and the native local OpenCode database when a native local OpenCode conversation is recorded. Remote and WSL provider histories are not copied. Symbolic links are not followed or recreated; Orca recreates its managed runtime aliases. Downloadable speech models and browser caches are excluded.

These are allowlisted recovery copies, not complete archives of the user-data directory. Before an upgrade, also retain a private archive of the closed profile, including its browser/plugin state and encryption material, outside rolling retention. Inventory referenced provider files outside that directory separately. A generation is bound to its original absolute profile path; it is not a general importer into another test profile.

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

Quit the source app before updating this branch. Pull reviewed changes from this fork's `oc-clean-local-build` branch with `git pull --ff-only`, then repeat dependency installation and the build commands above. Reopen the same launcher and profile. This pulls published fork updates; importing original Orca changes is a separate maintenance operation described below.

Run the recovery checks against disposable synthetic data after building:

```sh
ORCA_BACKGROUND_LAUNCH=1 pnpm test config/scripts/local-fork-recovery.test.mjs --maxWorkers=2
ORCA_BACKGROUND_LAUNCH=1 pnpm check:changed --maxWorkers=2
```

The checks cover online WAL snapshots, missing-data restoration, fallback from damaged copies, admission/maintenance exclusion, intentionally empty profiles, path containment, retention, and supervisor retries/final snapshots.

## Upstream maintenance plan

This is the plan for future updates, not evidence that an upstream update has been applied. The goal is to stay current with reviewed original Orca changes while preserving this fork's active OpenClaw removal, source launcher, stable profile, and recovery behavior.

### Baseline and first reassessment

The previous source checkpoint is `7afebe9e5e9647d48921ac79e11625230f7b873a`, with its maintenance guide at `904699a6eafe4db4d26f7bcc47ee3d6603b614fd`, on `acdn-scollins/orca:oc-clean-local-build`. Both were based on original `stablyai/orca` commit `641e4792b966960d65bd82a3744fe087a5ac05cb`. The colleague's fork remains a historical reference, not the source for upstream updates.

On November 3, 2026, original `main` was observed at `39d02ae0bcecc6a15fd1a37cf4eedb069c8137df`; GitHub's comparison reported 1,099 commits after our base. Treat that as a planning snapshot. Recheck and record the exact upstream SHA when the update starts, review the intervening changes, and select the newest acceptable revision. If the latest revision has an unresolved regression, retain the working fork and record the reason for deferring it.

### 1. Prepare an update candidate

- Keep `origin` pointed at `acdn-scollins/orca`. Add an `upstream` remote for `https://github.com/stablyai/orca.git` if absent; otherwise verify its URL before fetching.
- Start with a clean working tree and verify the published fork branch. Record the fork commit, selected upstream SHA, dependency/runtime pins, and existing verification results.
- Create a temporary update branch from the published `oc-clean-local-build` tip in a separate checkout. Merge the selected upstream SHA there, preserving published history. Do not rebase the published fork or force-push it.
- Use a separate disposable profile and recovery root for candidate checks. Keep the permanent checkout, installed launcher, and normal profile on the existing build until the candidate is accepted.

### 2. Review the fork's behavioral contract

Review semantic changes as well as merge conflicts. Upstream can introduce new activation paths without touching a conflicting line.

| Area                       | Required behavior after the update                                                                                                                                                           |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Discovery and environment  | No active OpenClaw session-root scanning, environment-root override, detection command, or state-directory forwarding. Review any newly introduced OpenClaw credential/environment handling. |
| Agent launch and selection | No selectable/default OpenClaw agent, process recognition, skill destination, CLI/worktree launch, or desktop/mobile resume path that activates it.                                          |
| External automations       | No OpenClaw discovery or command execution. Preserve other upstream providers and Orca's own automations.                                                                                    |
| Historical data            | Retain compatibility for saved identifiers, records, and transcript parsing. Searching for `openclaw` is an inventory aid, not a requirement to delete every occurrence.                     |
| Local build and recovery   | Preserve the separate profile, backup retention, runtime exclusion, quarantine, missing-only provider restoration, and intentionally empty-profile behavior.                                 |

Reuse the existing selection, recognition, scanner, skill-provider, CLI, automation, resume, and recovery tests. Add a focused test only for a newly introduced activation path. Inspect relevant built desktop/server/web/mobile outputs for active integration paths as well as source.

The current external-provider list is empty because OpenClaw was the only external provider in our base. If upstream adds other providers, preserve them while excluding OpenClaw; do not resolve the merge by blindly retaining an empty list. Endpoint protection settings remain outside this customization.

### 3. Refresh this guide and validate the candidate

- Re-read the candidate's contribution instructions and build scripts. Update this guide's upstream baseline, runtime/package-manager pins, installation commands, artifact paths, and launcher/recovery assumptions in the same update. The launcher currently requires Node 24 explicitly, so an upstream runtime change needs a launcher review too.
- Install the candidate's frozen root and mobile lockfiles with its pinned tools. Run the existing focused removal tests, synthetic recovery tests, and `ORCA_BACKGROUND_LAUNCH=1 pnpm check:changed --base=<selected-upstream-sha> --maxWorkers=2`. This measures the fork's delta against its selected upstream; an old `origin/main` can otherwise select the entire upstream refresh. Record any scoped checks used when selection fans out excessively, as permitted by `AGENTS.md`.
- Investigate failures against the same unmodified original upstream SHA with equivalent toolchains. Do not carry forward a permanent waiver for an older failure or weaken assertions merely to obtain a pass.
- Repeat the documented source build, including CLI verification, projected web/mobile assets, and Electron native-runtime preparation. Keep supported macOS, Linux, Windows, local/remote, and folder-workspace behavior in the review scope; record platforms that were not exercised.
- Validate the candidate in a hidden Electron instance through Playwright CDP. With synthetic profiles, verify startup, the agent menu's removal behavior, session persistence, backup creation, and restoration. Keep interactive authentication and real-account first use as separate checks.

The October 29 full check was not green. Five removal-related failures were corrected in focused runs; two read-only SQLite/WAL tests and one simulated WSL pipe-error assertion subsequently reproduced against original `641e4792` under Bun 1.4.4 and passed under Node 24.22.1. Those are historical observations, not qualification of a newer candidate. Build success, targeted passes, and full-gate results must be recorded separately.

### 4. Promote and retain rollback

- Before the normal profile is opened by a newer build, quit the source app, confirm no profile participant is active, and retain a verified private pre-upgrade recovery point and closed-profile archive outside rolling retention. Keep the previous source commit and matching dependency pins. Take a fresh snapshot at cutover if the old application was used while the candidate was being tested.
- Use the configured commit signing when creating candidate commits. Once the candidate is accepted, fast-forward `oc-clean-local-build` to it and push normally to `origin`. Update the permanent checkout while the app is stopped, then rebuild there so its installed launcher retains the correct paths.
- Reopen the same launcher and profile. Check a short conversation, quit/reopen persistence, and recovery snapshots. Reinstall the Dock launcher only if its recorded checkout, Node executable, profile, or recovery-root path changes.
- If rollback is needed after a profile migration, use the previous code with its matching pre-upgrade profile/recovery point. A source checkout rollback alone is insufficient: older code may refuse a newer database schema or read stale compatibility data even when the schema number is unchanged. Preserve the newer profile for review before restoring anything.
- Build and qualify Orcad templates separately for the actual remote targets. A desktop rebuild does not update existing remote runtimes. Check mixed client/server versions and mobile behavior before any remote rollout.

Each completed update should record the previous fork tip, merged upstream SHA, resulting fork commit, commands and check outcomes, platform/remote limits, and rollback reference in this guide or linked durable repository evidence. Keep future removal, launcher/recovery, and incidental upstream fixes in small distinct commits where practical. Start with this documented procedure and existing checks; introduce an update wrapper or project-local skill only if repeated updates demonstrate a need, with this guide as its single source of instructions.

## Update record: November 9, 2026

Status: candidate adaptation and qualification in progress; the permanent checkout and configured profile have not been promoted.

- Previous fork tip: `904699a6eafe4db4d26f7bcc47ee3d6603b614fd`.
- Selected original upstream: `v1.4.255`, `084ce0eebbdda3f665251984804f2238be666296`.
- Candidate branch: `codex/upstream-v1.4.255`, preserving the published fork history through a merge.
- Configuration source: the existing `orca-local` profile selected by the installed Orca Local Launcher; promotion must reuse that same profile after a verified closed-profile archive and migration rehearsal.

Required adaptations discovered during assessment:

| Area                          | Adaptation                                                                                                                                                                                                                                                                                |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Direct CLI build              | Use `config/scripts/cli-build/build-cli.mjs` and `config/scripts/cli-build/verify-cli-bin.mjs`. Keep avoiding optional global CLI registration.                                                                                                                                           |
| Development terminal wrappers | Import `config/scripts/development/launch/dev-cli-terminal-wrapper.mjs`; preserve the fork's literal POSIX path/argument quoting and its executable regression check at the moved owner.                                                                                                  |
| Shell quoting                 | Import `src/shared/shell/launch/shell-argument-quoting.ts` from the wrapper and Dock helper.                                                                                                                                                                                              |
| OpenClaw guard owners         | Preserve the removal at the moved `src/shared/agent-launch/catalog/` and `src/shared/agent-status/process/` owners and the current CLI, scanner, skill, resume, automation, and mobile paths.                                                                                             |
| Profile snapshots             | Reuse upstream `writeProfileStateDatabaseSnapshotAsync` with the upstream SQLite wrapper. It refreshes legacy document rows inside the snapshot before durable publication; a raw native SQLite backup alone misses that compatibility step.                                              |
| Supervisor-loaded modules     | Emit the SQLite wrapper and profile snapshot helper as explicit CommonJS build entries and include them in the existing plain-Node entry guard.                                                                                                                                           |
| Profile storage               | Both the previous base and selected release use schema version 3, but the release adds per-entry storage for several domains. Rehearse document-only v3 to split-table v3 and retain the untouched old data for rollback. Schema-number equality does not establish format compatibility. |
| Build tooling                 | Select the exact pinned tools explicitly; the existing shell's Node/Bun and older pnpm shim differ from the source pins. Use isolated per-checkout installs.                                                                                                                              |

Upstream assessment: [release E2E run 42616732178](https://github.com/stablyai/orca/actions/runs/42616732178) built successfully and passed twelve of fourteen general E2E shards, plus the inspected Windows/managed-Orcad/network-route jobs. Shard 5 missed a synthetic terminal key-echo latency budget: 77.713804 ms against `<75 ms`; its totals were 55 passed, one failed, six skipped, and seven not run. Shard 6 exceeded its 30-minute job budget after 86 tests passed, with no preceding assertion failure in its log. These are a performance miss and incomplete coverage; they are not a green release gate. Pinned main had identical performance-test/helper code, providing no demonstrated fix for that miss. Run that native-focus performance lane only on an isolated display or CI.

Qualification results, migration/rollback evidence, and the resulting fork commit will be recorded here before promotion.

## Restart handoff: November 9, 2026

- Terminal state: HANDOFF_READY
- Purpose: resume after a user-requested system restart.
- Objective: finish the approved `v1.4.255` fork update, preserve the configured `orca-local` profile, and persist every adaptation and qualification result in this guide.
- Acceptance boundary: reviewed removal/recovery adaptations, completed scoped checks and hidden Electron validation, synthetic old-format migration/rollback rehearsal, verified closed-profile preservation, and qualified promotion. Remote-runtime rollout remains separate.
- Receiver: the resumed Codex integration session.
- Authority: the user approved the update plan and durable guide changes, then explicitly paused for restart. Resume implementation only after the user sends a resume instruction. No workers remain assigned active work.

### Required first reads

1. This candidate's `AGENTS.md`, applicable `docs/agents-md-refs/` guidance, and this complete guide.
2. `.tmp/restart-20261109/state.json` and `.tmp/restart-20261109/git-status.txt` in the candidate checkout.
3. The actual candidate working-tree diff against `v1.4.255`, including untracked test files. Do not rely on an interrupted worker's memory.

### Verified snapshot

| Role                   | Path                                                      | Branch                                                          | HEAD/state                                                                               |
| ---------------------- | --------------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Permanent source build | `/Users/scolnz/accedian/git/orca`                         | `oc-clean-local-build`                                          | Clean, `904699a6eafe4db4d26f7bcc47ee3d6603b614fd`, tracking the published fork branch.   |
| Isolated candidate     | `/Users/scolnz/.codex/worktrees/orca-upstream-v1255/orca` | `codex/upstream-v1.4.255`                                       | HEAD remains `904699a6eafe4db4d26f7bcc47ee3d6603b614fd`; an uncommitted merge is active. |
| Merge target           | Original `stablyai/orca:v1.4.255`                         | Annotated tag object `63ba9c6212d1db08486ce19658ccc960d8a1b581` | `MERGE_HEAD^{commit}` resolves to `084ce0eebbdda3f665251984804f2238be666296`.            |

`upstream` now points to `https://github.com/stablyai/orca.git`; the release tag has been fetched. The candidate index still lists **35 unmerged paths**, although a scan found no remaining textual conflict markers. Workers wrote resolutions without staging them. A full short-status snapshot contains 43,854 paths, mostly upstream changes; use the saved manifest and scoped/count summaries instead of printing it all. There were 65 working-file differences/untracked files to fingerprint relative to the selected upstream.

### Completed work and evidence

- The CI diagnosis and source-compatibility findings are recorded above. Diagnostic logs remain under the permanent checkout's `.tmp/upstream-e2e-42616732178-job-129159189689.log` and `.tmp/upstream-e2e-42616732178-job-129159189664.log`.
- Candidate root dependencies were installed successfully with frozen lockfiles using Node 24.22.1 and pnpm 12.14.0, with per-checkout dependencies and a separate store. The completed install receipt is preserved in `.tmp/restart-20261109/root-install.log`.
- The temporary pnpm installation was `/private/tmp/orca-update-tools`; the temporary store was `/private/tmp/orca-update-store`. Either may disappear during restart. Recheck versions and dependency availability, and use the documented project-local bootstrap if needed.
- Root edits moved launcher/Dock/terminal-wrapper imports to current upstream owners and preserved the executable POSIX quoting regression test at its new owner.
- Recovery edits reuse upstream's snapshot/SQLite implementation, declare its two CommonJS outputs and plain-Node guards, and add focused stale-legacy/no-live-write and newer-schema preservation cases. These are written but not built or tested.
- OpenClaw resolutions and obsolete-test deletions were written across moved owners. Re-review their actual diff before marking the index resolved.
- The automation worker found a new reuse-before-validation path for saved retired-agent automations. Verify whether its proposed shared `runAutomationLaunch` guard and focused regression were fully written before interruption; do not assume that part is complete.
- No candidate application build, test suite, Electron launch, real-profile copy, migration rehearsal, cutover, candidate commit, or candidate push has occurred. Mobile dependencies have not been installed. The existing configured profile and installed launcher remain on the old build.

### Scope and ownership

- Writable implementation boundary after resume: the isolated candidate and its guide. The integration session owns staging, merge completion, commits, and promotion.
- The permanent checkout is a coordination/old-code reference until the candidate is qualified and the app is stopped for cutover.
- Never abort/reset/recreate the merge merely to obtain a clean tree; preserve existing resolutions and review the 35 index conflicts.
- Never overwrite or migrate the working profile before preserving a verified private closed-profile archive and matching rollback point. Candidate tests must not reach real provider homes or run existing automations.
- Keep all agent-run apps/tests in background mode; rendered checks use Electron/Playwright CDP. Native-focus performance tests require an isolated display or CI. Do not kill applications the session did not start.

### Remaining work

1. Run the freshness check below, recover the pinned tools if temporary paths disappeared, and inspect actual resolutions/untracked tests. Finish the automation reuse guard if necessary.
2. Resolve the index only after content review; scan for conflict markers and check the custom delta against the selected upstream. Retain the fork's legacy readability and all supported non-OpenClaw providers.
3. Install frozen mobile dependencies, build CLI/main/renderer/web/mobile outputs using the current paths, and run the focused recovery/removal/quoting checks. Rebuild supervisor-loaded modules before recovery tests.
4. Complete the changed-code gate against upstream `084ce0ee` with an adequate budget. If selection fans out excessively, follow `AGENTS.md` scoped-check rules and report exact limits. The prior 61-test/30-of-31 results are historical, not candidate qualification.
5. Rehearse actual old-code schema3 document-only state to candidate schema3 split storage using synthetic data and isolated homes, including restart/recovery and old-code plus untouched-old-data rollback. The rehearsal harness had not yet been created.
6. Qualify hidden Electron behavior. Only then prepare a fresh private closed-profile archive, verify the real profile is quiescent, and promote/rebuild at the permanent location using the same `orca-local` profile. Ask the user to quit their running app when needed rather than terminating it.
7. Record outcomes and remaining platform/CI limitations here, use signed commits and normal fork pushes, and verify remote readback. Do not claim the upstream performance lane or incomplete E2E coverage is green.

### Return contract and freshness check

Before editing, compare paths, branches, HEAD, `MERGE_HEAD^{commit}`, dirty/untracked paths, and working-file hashes with the saved state. Relevant or unknown drift makes this checkpoint stale: investigate before proceeding. Minor/non-relevant differences may be recorded and continued. Recheck the published fork tip and selected target identity; do not silently move to a newer release or main SHA.

Return the resulting fork commit(s), qualification commands/results, configuration-preservation and rollback evidence, guide updates, and any remaining gate. This handoff itself grants no worker launch or live-profile mutation beyond the user's resumed approved scope.

### Agent brief

Read this handoff and its required first reads. Verify freshness, preserve the in-progress merge and uncommitted edits, and continue the approved update only after the user's resume instruction. Treat the permanent build/profile as the working rollback source until cutover is justified.

## Resumed qualification: November 9, 2026

The restart handoff above is a historical checkpoint. The user explicitly resumed the approved update. Before edits, the branch, HEAD, merge target, 35 index conflicts, untracked paths, and all 65 saved working-file hashes matched the checkpoint. The temporary `/private/tmp/orca-update-tools` pnpm bootstrap and store disappeared during restart; the root installation survived. Recreated pnpm 12.14.0 under `.tmp/fork-tools` using the documented npm bootstrap and verified Node 24.22.1 and project Bun 1.4.4. Continue with `ORCA_PNPM_GLOBAL_VIRTUAL_STORE=0` and the same per-checkout store setting; do not relink the permanent checkout.

The shared automation launch runner now rejects saved OpenClaw automations before prechecks or dispatch, including terminal/chat session reuse. A focused real-store regression covers the common entry. Independent read-only reviews covered removal, automation, quoting/launcher paths, recovery snapshots, and the final test-fixture changes; no unresolved source blocker remained. All 35 index conflicts were marked resolved after review without aborting or recreating the merge.

Additional adaptations discovered during execution:

- Removing OpenClaw narrowed the auto-pick literal tuple and broke a newer picker's legacy-ID membership check. An explicit `readonly TuiAgent[]` declaration preserves the runtime removal and the readable legacy type; CLI compilation then passed.
- Generic merged-root search tests now use actual supported Devin local/WSL transcript fixtures. They do not mutate the source table to reactivate OpenClaw. The service case checks searchable results rather than internal close-call counts.
- The new future-schema recovery fixture initially failed only under Bun 1.4.4. A standalone SQLite probe reproduced its closed-WAL read-only `SQLITE_CANTOPEN` behavior; Node 24 passed. The fixture now checkpoints into a DELETE-journal database and proves the future version is readable before checking typed refusal and unchanged bytes. Both runtime routes pass; no production workaround or runtime waiver was added.
- The first normal merge commit hook rejected the resume module at 303 nonblank/noncomment lines (limit 300). Reusing its existing resolved-shell value removed a redundant call expansion and restored the limit. The hook's automatic backup restored the original candidate on failure; HEAD/merge target, zero conflicts, index/working equality, and the 67-path custom delta were rechecked. Its timestamp restoration triggered pnpm's dependency-freshness guard, so a frozen root install refreshed verification metadata in 11.5 seconds without changing package/lock/patch contents. Never bypass hooks to complete this merge.

### Build and focused verification receipts

Run all commands with Node 24 and the pinned project-local pnpm, `ORCA_BACKGROUND_LAUNCH=1`, `ORCA_PNPM_GLOBAL_VIRTUAL_STORE=0`, and the same separate store. Logs are under `.tmp/restart-20261109/`.

| Command / selection                                                                                                       | Result                                                                                                     | Receipt                                                                        |
| ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Root frozen install before restart; mobile `pnpm install --frozen-lockfile` after restart                                 | Passed; pnpm 12.14.0, no lockfile changes                                                                  | `root-install.log`, `mobile-install.log`                                       |
| `pnpm run build:wsl-guest`                                                                                                | Passed                                                                                                     | `build-wsl.log`                                                                |
| `node config/scripts/cli-build/build-cli.mjs`                                                                             | Passed after the type annotation fix; 4,013 files typechecked                                              | `build-cli-retry.log`                                                          |
| `node config/scripts/cli-build/verify-cli-bin.mjs --fix-executable --fix-package-json`; `node out/cli/index.js --version` | Passed; reports 1.4.255; no global CLI registration                                                        | Command output                                                                 |
| `pnpm run build:electron-vite`                                                                                            | Passed main/preload/renderer and plain-Node entry guards; sandbox preload and renderer boot graph verified | `build-electron-vite.log`                                                      |
| `pnpm run build:web-from-renderer`                                                                                        | Passed; projected and verified web client                                                                  | `build-web.log`                                                                |
| `pnpm run build:mobile-web`                                                                                               | Passed bundle/budget/manifest verification                                                                 | `build-mobile-web.log`                                                         |
| `pnpm tc`                                                                                                                 | Passed, exit 0                                                                                             | `typecheck.log`                                                                |
| Normal `pnpm test` removal selection, `--maxWorkers=2`                                                                    | 12 files, 93 tests passed; changed Devin fixtures subsequently rerun: 3 files, 5 tests passed              | `removal-tests.log`, `merged-root-tests.log`                                   |
| Normal `pnpm test` automation selection, `--maxWorkers=2`                                                                 | 4 files, 25 tests passed                                                                                   | `automation-tests.log`                                                         |
| Recovery and executable POSIX quoting: normal `pnpm test` and `pnpm test:node`, `--maxWorkers=2`                          | Each route: 2 files, 16 tests passed after deterministic fixture preparation                               | `recovery-and-quoting-normal-final.log`, `recovery-and-quoting-node-final.log` |

The removal selection covers current catalog selection, process recognition, installed detection, worktree CLI validation, skill CLI refusal, scanner/override/search roots, legacy transcript capture, and resume refusal. Automation selection: `service-precheck.test.ts`, `external-manager-scoped.test.ts`, `automation-handler-flags.test.ts`, and `AutomationsPage.behavior.test.tsx`. Recovery/quoting selection: `config/scripts/local-fork-recovery.test.mjs` and `config/scripts/development/launch/dev-cli-terminal-wrapper.test.mjs`.

### Isolated migration, restart, recovery, and rollback

The persisted harness is `config/scripts/local-fork-profile-rehearsal.mjs`; the run receipt is `.tmp/synthetic-profile-rehearsal.json`. It uses actual old-checkout persistence APIs to create **schema3 document-only** state, with a folder project/group/workspace, dark theme, and a marker. It never accepts an existing user profile as input. The API/schema assumptions are explicit for this update; reassess them against the next selected old/new source pair.

With Node 24 active and the old checkout still at its recorded commit:

```sh
# Prepare once in a fresh candidate; never overwrite an existing receipt.
ORCA_BACKGROUND_LAUNCH=1 node --import /absolute/old-checkout/node_modules/tsx/dist/loader.mjs config/scripts/local-fork-profile-rehearsal.mjs prepare /absolute/old-checkout
# After candidate startup/shutdown, UI theme change, and restart:
ORCA_BACKGROUND_LAUNCH=1 node --import /absolute/old-checkout/node_modules/tsx/dist/loader.mjs config/scripts/local-fork-profile-rehearsal.mjs candidate light
# While the candidate is closed, rehearse loss and restoration of only the synthetic DB:
ORCA_BACKGROUND_LAUNCH=1 node --import /absolute/old-checkout/node_modules/tsx/dist/loader.mjs config/scripts/local-fork-profile-rehearsal.mjs recovery light
ORCA_BACKGROUND_LAUNCH=1 node --import /absolute/old-checkout/node_modules/tsx/dist/loader.mjs config/scripts/local-fork-profile-rehearsal.mjs old
```

For this run the old checkout was `/Users/scolnz/accedian/git/orca` at `904699a6`. The private scratch root was `/private/tmp/omr-RBIIcF` (0700). Use the receipt's `launch-env.json` as the **entire** child environment; merging ambient provider variables back in defeats isolation. It fences HOME and config/data/cache/temp/provider homes. Launch the rebuilt `config/scripts/launch-orca-local.mjs` with Node 24, `ORCA_BACKGROUND_LAUNCH=1`, `ORCA_E2E_HEADLESS=1`, the synthetic `ORCA_DEV_USER_DATA_PATH`/recovery root, and a free localhost CDP port. This run used port 9337 and Playwright CLI attached by CDP, verified the candidate's `out/renderer/index.html`, and set a 1280×800 viewport without showing or activating windows.

Results: old APIs created schema3 without split tables; candidate startup created split storage while preserving project association, folder workspace, and marker. The UI initially showed the dark setting. Changing to light through normal Appearance controls survived a closed-database readback and a second hidden startup; the sidebar still displayed the migrated project/workspace. Agent settings contained Claude and Codex and no OpenClaw. Actual recovery snapshot creation, withholding only the synthetic DB under maintenance ownership, restoration, and candidate readback all passed. Old code with the separate untouched old-data copy passed readback; original fixture hashes remained unchanged throughout. The persisted harness's final `candidate light` and `old` phases also passed. Both recorded supervisors and Electron children exited before offline probes; only processes launched and identified by this session were stopped.

Receipts: `synthetic-recovery.log`, `hidden-electron.log`, `agents-hidden-1280x800.png`, and `restarted-hidden-1280x800.png` under `.tmp/restart-20261109/`. Renderer console had zero errors and Electron's un-packaged CSP warning. Main emitted BrowserWindow listener-count warnings; this rehearsal does not establish their cause or absence of a leak. Missing CLI-version probes and empty skill roots reflect the isolated home. No authenticated provider conversation, native-focus performance lane, physical mobile device, or remote host rollout was exercised.

### Changed-code gate and publication boundary

Signed merge `8bd6ce8f9dfadafb3391a17ce562a00009206654` preserves parents `904699a6` and `084ce0ee`; `git verify-commit HEAD` passed. All normal pre-commit lint/AST/format tasks passed on retry. Lint-staged's final re-add reported ignored deleted directories `docs/reference` and `docs/schemas`; it returned zero and the merge committed. Post-hook verification found zero staged/unstaged/untracked paths and exactly 67 custom paths against the release. Do not force-add those ignored upstream deletions. During a failed hook's automatic restore, the tree can temporarily resemble the old checkout; pause concurrent readers until restoration and identity/diff verification finish.

Ran `ORCA_BACKGROUND_LAUNCH=1 ORCA_CODE_QUALITY_BASE=084ce0eebbdda3f665251984804f2238be666296 pnpm check:changed --base=084ce0eebbdda3f665251984804f2238be666296 --maxWorkers=2 --timeout=30`. Its 35-task run completed in 137.2 seconds with 33 passes and two reported failures:

1. The related-test launcher was deliberately stopped under the `AGENTS.md` scoped-check allowance. Stable, independently captured Vitest discovery selected **4,006 related plus 2 colocated test files**, 46.6% of the 8,597-file unit suite. The source fingerprint matched before/after discovery. This is an excessive local selection; no complete 4,008-file run is claimed. Only the recorded child launcher was signaled after its parent/command were verified; static/type checks continued. The broad runner reported no assertion failure before cancellation. Receipt: `changed-gate-fanout-summary.json`; scope/process receipt: `changed-gate-scope.json`.
2. `main-sync-fs-ratchet` required shrinking the obsolete allowance for `external-manager-discovery.ts` from 1 to 0 after removing OpenClaw discovery. Ran `pnpm check:main-sync-fs-ratchet --prune`, retained only that one-line deletion, and reran the normal ratchet successfully (2,179 remaining grandfathered calls). No unrelated baseline reorder was retained.

All **34 non-unit checks** therefore pass when including that corrected ratchet recheck. This includes the three typecheck projects, changed-code quality, format/lint, import boundaries, flaky-test/max-lines/other selected ratchets, localization catalogs/coverage/extraction, and output verifiers. The broad command itself remains recorded as exit 1, not a fully green gate. Its owning-layer replacement, normal `pnpm test` with the documented removal/automation/recovery/quoting selection plus shared AI Vault resume commands and `--maxWorkers=2`, passed **19 files / 138 tests** on the final source. Earlier Node recovery/quoting route also passed 16/16. Logs: `changed-full.log`, `main-sync-fs-prune.log`, `main-sync-fs-ratchet.log`, and `scoped-final-tests.log`.

The subsequent correction commit contains only the ratchet allowance and this qualification record. Run `pnpm check:changed --base=8bd6ce8f9dfadafb3391a17ce562a00009206654 --maxWorkers=2` immediately before publishing that stack. This is incremental correction evidence; it supplements the full custom-delta static checks and scoped tests above. It does not establish a green 4,008-file suite. Never use `--no-verify`.

The permanent checkout, installed launcher, and configured `orca-local` profile have not been advanced or migrated. Pre-cutover read-only inspection found the old app actively owning its databases; the user must Quit Orca before full closed-profile preservation. Retain the old source, dependency trees, ignored workspace-package dist outputs, Electron output/runtime, launcher, and Node binary as well as the complete profile and a verified recovery generation. A live profile copy is not the rollback archive.

### Local native helpers and closed-profile preservation

The default universal `pnpm run build:native` exposed a host-toolchain limitation: this Apple Silicon CommandLineTools installation's `libswiftCompatibilityConcurrency.a` contains arm64/arm64e but no x86_64. The unmodified upstream process-footprint helper could not link its Intel target; the build correctly failed and cancelled sibling compiler groups. This is separate from the fork's test failures. No global Xcode selection, SDK, or signing identity was changed.

Three upstream Swift CLI helper builders already support `--single-arch`. Added the same host-triple selection to `build-computer-macos.mjs` and forwarding of only that recognized flag through the macOS branch of `build-native-for-platform.mjs`. The no-flag path still builds both architectures; Windows/Linux early-return paths and signing/bundle identity remain unchanged. Independent read-only review, formatting, lint, syntax, and diff checks passed. `ORCA_COMPUTER_MACOS_SIGN_IDENTITY=- pnpm run build:native --single-arch` then passed all four helper builds; the computer-helper app passed `codesign --verify --deep --strict`. This compiles and signs helpers without launching them or requesting OS permissions. Universal packaging remains unqualified on this host. Swift reported upstream deprecations for `CGWindowListCreateImage` and `--build-system native`; neither was changed as part of this update.

The user confirmed Quit Orca. Rechecked all recorded old app/supervisor/helper PIDs, the full profile's open-file ownership, and UNIX socket ownership: none remained. The private preservation root is:

`/Users/scolnz/Documents/Codex/Orca Recovery/pre-v1.4.255-20261109T151417Z`

The original `904699a6` recovery implementation created a separate pinned generation there, outside rolling retention. Its verification passed for 33 files, including two selected provider files; the manifest remains bound to the original `orca-local` path. `profile-closed.tar` and `closed-profile/` preserve all **253 regular files / 43,701,596 bytes**, with 97 directories and no symlinks at closure. Every archive member was read back and SHA-256 checked, the independent closed copy matched, and the original profile matched before/after. One `daemon/daemon-v54.sock` entry was omitted as transient IPC only after `lsof -U` found no owner and a connection was refused; no persistent files were excluded or removed. Full manifest, archive digest, and receipts are private in that directory.

An additional offline rehearsal copied only 11 profile-index/SQLite/sidecar/authority files into `migration-probe/profile`, with an isolated HOME/environment. The old and candidate persistence APIs operated only on that private copy. Schema3 remained schema3; both split-storage tables appeared; SQLite integrity passed before/after. All 35 logical domains retained identical canonical hashes and counts, including settings and project/repository data; no domains changed or were added. The two history databases and four sidecars remained byte-identical. All 253 regular files in both the live profile and closed copy were rehashed before/after and still matched the archive manifest. No provider home, decryption, network action, automation, or Electron startup occurred in this actual-data probe. First live startup/default normalization and authenticated provider use remain distinct checks.

Private receipts: `profile-backup-receipt.json`, `profile-file-manifest.json`, `recovery-receipt.json`, and `migration-probe/offline-migration-receipt.json`. The cutover checkpoint is also mirrored in the candidate's `.tmp/cutover-20261109/state.json`. Old source/build/dependency preservation is undergoing its final complete hash/symlink verification; do not advance the permanent checkout until its verified receipt exists.

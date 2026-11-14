# cmd-mod-commit

[![npm version](https://img.shields.io/npm/v/cmd-mod-commit.svg)](https://www.npmjs.com/package/cmd-mod-commit) [![npm total downloads](https://img.shields.io/npm/dt/cmd-mod-commit)](https://www.npmjs.com/package/cmd-mod-commit)

A portable Command Code mod for git commits. Adds a `/commit` command to any instance.

## Install

```bash
cmd mods add npm:cmd-mod-commit -g
```

Then `/reload` (or start a new session).

## What `/commit` does

Commits in small incremental stages with Commitizen / Conventional Commits
messages (`type(scope): description`, lowercase, 72 chars, no `Co-authored-by`
trailer).

1. **Not a git repo yet:** starts with `git init`, then follows the fresh-repo
   flow below. Useful when you forgot to run `git init`.
2. **Fresh repo (no commits yet):** the agent decides from the tree whether
   there is real project content beyond config/scaffolding (it infers this
   from names and contents — no fixed filename list; `src/` presence is
   reported as a hint). With real content it asks whether to keep the default
   first message `initial commit` or use a custom one; with only
   config/scaffolding it uses `initial commit` directly. `/commit <message>`
   skips the question. Then it stages a sensible baseline group, commits it,
   and continues incrementally through the rest (scaffolding, features,
   tests/docs). The very first commit is always the initial one.
3. **Existing repo:** splits the working tree into small logical commits
   (by feature, directory, or layer) — staged changes first as one unit,
   then each remaining group staged explicitly and committed before moving
   on. Handles the "forgot to commit for a while" case without one giant
   commit.

## Options (`/commit:flags`)

Run `/commit:flags` with no args for an interactive picker, `show` for a
readout, `reset` for defaults, or `key=value` pairs (e.g.
`/commit:flags style=gitmoji sign=true`).

| Option     | Default        | What it does                                              |
| ---------- | -------------- | --------------------------------------------------------- |
| `style`    | `conventional` | Commit message style: `conventional` or `gitmoji`.        |
| `sign`     | off            | Sign commits with GPG (`-S`).                             |
| `push`     | off            | Push the branch after committing.                         |
| `status`   | on             | Show the dirty git state in the footer (see below).       |
| `shortcut` | on             | Enable the `alt+c` shortcut that triggers `/commit`.      |

## Footer status segment

A persistent segment in the TUI status row shows the current branch,
dirty files (count plus the first few names), and upstream sync state
(`↑n` ahead, `↓n` behind, `=` in sync). It refreshes after every tool
call. Toggle it with the `status` option in `/commit:flags`.

## Keyboard shortcut

Press `alt+c` (Option+C on macOS) anywhere in the TUI to trigger `/commit`.
Toggle it with the `shortcut` option in `/commit:flags`. Listed under
**Mods** in `/hotkeys`.

## Guardrails

Destructive or risky git invocations are confirmed or blocked before they
run:

- `git push --force` / `-f` / `--force-with-lease` asks for confirmation.
- `git reset --hard` asks for confirmation.
- `git clean -f` asks for confirmation.
- Overwriting a secrets file via `checkout` / `switch` / `restore` is blocked.
- Staging or committing a secrets file is blocked — including via bare
  `git add` or `git commit -a`.
- Deleting a protected branch (`main` / `master` / `trunk`) is blocked.

### Blocked secrets files

Matched case-insensitively against the file's basename:

| Pattern                                     | Examples                                         |
| ------------------------------------------- | ------------------------------------------------ |
| `.env` and `.env.*`                         | `.env`, `.env.local`, `.env.production`          |
| `*.pem`                                     | `cert.pem`, `server.pem`                         |
| `*.key`                                     | `server.key`, `private.key`                      |
| `*.p12`                                     | `cert.p12`                                       |
| `*.pfx`                                     | `cert.pfx`                                       |
| `id_rsa`, `id_dsa`, `id_ecdsa`, `id_ed25519`| SSH private keys                                 |
| `*.json`                                    | `credentials.json`, `secret.json`, `secrets.json`|
| `*.yml`                                     | `secret.yml`, `secrets.yml`                      |
| `*.yaml`                                    | `secret.yaml`, `secrets.yaml`                    |
| `.*rc`                                      | `.npmrc`, `.pypirc`                              |

If a secrets file you use isn't covered, PRs are welcome.

## Development

```bash
git clone https://github.com/guruela/cmd-mod-commit
cd cmd-mod-commit
cmd mods add ./cmd-mod-commit   # use the checkout where it is
```

Then `/reload` (or start a new session) to pick up changes. Edit the
sources under `src/`, reload, and test directly. Typecheck with
`tsc --noEmit --skipLibCheck` (the `@commandcode/harness` types only exist
inside the host, so expect an unresolved-module error outside it).

### Layout

| File              | Contents                                                     |
| ----------------- | ------------------------------------------------------------ |
| `src/index.ts`    | Mod entry point: hooks, flag registration, wiring.           |
| `src/flags.ts`    | `CommitFlags` type, defaults, store read/write helpers.      |
| `src/git.ts`      | Git command parsing, path filtering, file-list helpers.      |
| `src/prompts.ts`  | Commitizen prompt builders and `/commit` message formatting. |
| `src/status.ts`   | Footer status segment (branch, dirty files, sync state).     |
| `src/guardrails.ts` | Destructive-command confirmations and secrets blocking.    |
| `src/commit.ts`   | `runCommit` flow shared by `/commit` and the `alt+c` shortcut.|
| `src/commands.ts` | `/commit` and `/commit:flags` commands plus the shortcut.    |

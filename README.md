# cmd-mod-commit

A portable Command Code mod. Adds a `/commit` command to any instance.

## Install

```bash
cmd mods add /path/to/cmd-mod-commit -g
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

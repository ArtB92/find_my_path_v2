---
name: pr-naming
description: Naming rules for branches, commits and pull requests in this repo. Load before creating a branch, committing, or opening or renaming a PR.
---

# Branch and PR naming

Every branch and PR title starts with one of three types:

- `feat`: something new a rider or developer can use.
- `fix`: corrects wrong behavior.
- `chore`: everything else (tooling, deps, docs, refactors, tests, skills, config).

Pick by what the change does for the product, not by the files touched. A change that is both a feature and a fix is split into two PRs, or takes the type of its main purpose.

## Formats
- Branch: `<type>/<short-kebab-summary>`, e.g. `feat/elevation-profile`, `fix/gpx-export-timezone`, `chore/vendor-skills`.
- PR title: `<type>: <summary>` in lowercase imperative, no trailing period, under 72 characters, e.g. `feat: show elevation profile under the map`.
- Commits: same `<type>: <summary>` form.

## Before opening or updating a PR
1. Check the branch name matches `^(feat|fix|chore)/[a-z0-9-]+$` (`git branch --show-current`).
2. Check the title matches `^(feat|fix|chore): .+`. Fix it before creating the PR, or rename an existing PR that doesn't match.
3. If the session was handed a fixed branch name it must push to (e.g. `claude/...` in a cloud session), keep that branch, still use a compliant title, and say in the PR description that the branch name was assigned by the session.

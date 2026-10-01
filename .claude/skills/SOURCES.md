# Vendored skills

Third-party skills copied into this repo, with their licenses kept in each folder. `ui-craft` and `backend-module` are ours.

| Skill | Source | Commit | License | Changes |
|---|---|---|---|---|
| architecture, system-design, debug, testing-strategy, tech-debt, documentation, deploy-checklist | [anthropics/knowledge-work-plugins](https://github.com/anthropics/knowledge-work-plugins) `engineering/skills/` | `da38ec1ee89d41e5380e652a97382695003396e7` | Apache-2.0 | Removed the pointer line to `CONNECTORS.md` (connectors not vendored) |
| pr-review | [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official) `plugins/code-review/commands/code-review.md` | `ab024cdcfa7ca80be204acd4907656ba5a968589` | Apache-2.0 | Command turned into a skill (name, description, `disable-model-invocation`); posts to the PR only with `--comment`; GitHub MCP fallback when `gh` is missing |
| frontend-design, webapp-testing | [anthropics/skills](https://github.com/anthropics/skills) `skills/` | `8a1541c4a3ffa5a20a5a91de0dcf3f0bab1d1ef4` | Apache-2.0 | None |
| taste-skill | [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill) `skills/taste-skill/SKILL.md` | `ce26fc25c0e5e8cab638f883de62d9a86ee5e45b` | MIT | None |
| react-best-practices | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) `skills/react-best-practices/` | `063bee94c3f4df8453406c830b0a7df0f2860278` | MIT (stated in the repo README; license text copied from Vercel Labs) | Kept `SKILL.md` and `rules/`; dropped the generated `AGENTS.md` and its pointer |
| web-interface-guidelines | [vercel-labs/web-interface-guidelines](https://github.com/vercel-labs/web-interface-guidelines) `command.md` | `e3d624baaf29dc1fc645aff3e38f03e564d2d6b1` | MIT | Pinned as a skill; upstream's skill fetches these rules from GitHub at run time instead |
| ponytail | [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail) `skills/ponytail/SKILL.md` | `e3ba2aa6f1e6f0bc4d69eb09c9f0d0a93af56156` | MIT | None; skipped the plugin's auto-activation hooks, statusline, MCP server and the review/audit/debt/gain/help skills |

To update one, replace its files with the upstream version at a newer commit, reapply the changes above, and bump the commit here.

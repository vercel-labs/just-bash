# Changesets

This repo uses [Changesets](https://github.com/changesets/changesets) to manage versions, generate changelogs, and (eventually) publish to npm.

## Adding a changeset

When you make a change that should land in a release, run:

```bash
pnpm changeset
```

You'll be prompted to:

1. Pick the package to bump (`just-bash`).
2. Choose the bump level — `patch` (bug fix), `minor` (feature, no break), `major` (breaking).
3. Write a short summary that will appear in the CHANGELOG.

This creates a `.changeset/<random-name>.md` file. Commit it with your PR.

## Skipping a changeset

Internal-only changes (CI, docs, repo housekeeping) don't need a changeset. If you skip one and a maintainer wants the change in a release, they can author one before the release PR.

## Releasing

Once any unreleased changesets land on `main`, the release workflow opens (or updates) a "chore: release" PR with bumped versions and the generated CHANGELOG. Merging that PR triggers the publish step — but **publishing is currently disabled** in `.github/workflows/release.yml`. To enable it, add `publish: pnpm release` to the `changesets/action` step.

The npm Trusted Publisher must also be configured before the first publish; see the comment block in `release.yml`.

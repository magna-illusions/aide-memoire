# Security

aide-mémoire sits between text nobody controls and a prompt that steers an agent, so a flaw in it
can let stored text pass for something it is not. Please report one privately.

## Reporting

Use GitHub's private vulnerability reporting:
[report a vulnerability](https://github.com/magna-illusions/aide-memoire/security/advisories/new).
Please do not open a public issue. Include the version, a minimal log or operation that shows it,
and what you expected instead.

## In scope

- Stored text that renders as structure: closing the block, opening a section, or forging a
  provenance tag such as `confirmed` or your hard label.
- An operation the validator accepts that its rules refuse: a writer doing what it may not, a
  citation that should not check out, a hard change without an action.
- A forget that leaves the forgotten words in what `tombstoneRedacted`, the fold or the rendering
  return.
- `validate`, `planWrite` or `foldEntries` throwing on any input, or taking time far out of
  proportion to it.
- A review prompt in which a message can pass for a speaker or an instruction.

Out of scope: what the package documents as yours, such as who the user is, what your
`records` lookup answers, copies outside the log, and your store's own history (see the README's
Limits).

## Supported versions

The latest 1.x release.

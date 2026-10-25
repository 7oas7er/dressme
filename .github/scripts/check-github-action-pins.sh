#!/usr/bin/env bash
# Fail if any workflow uses a mutable Action ref (tag/branch) instead of a
# full 40-char commit SHA. Form: owner/action@<sha> # vX.Y.Z
# See docs/github-actions-pinning.md
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WF_DIR="$ROOT/.github/workflows"

if [[ ! -d "$WF_DIR" ]]; then
  echo "No .github/workflows directory at $WF_DIR" >&2
  exit 1
fi

bad=0
checked=0

while IFS= read -r entry; do
  [[ -z "$entry" ]] && continue
  file_line="${entry%%:*}"
  rest="${entry#*:}"
  line_no="${rest%%:*}"
  content="${rest#*:}"
  # Strip leading "uses:" and whitespace; drop trailing comment for the ref check.
  ref="$(printf '%s\n' "$content" | sed -E 's/^[[:space:]]*uses:[[:space:]]*//; s/[[:space:]]+#.*$//; s/[[:space:]]*$//')"

  case "$ref" in
    ./* | ../* | /* | docker://*)
      continue
      ;;
  esac

  checked=$((checked + 1))

  # Must be owner/name[/path]@40-hex
  if ! printf '%s\n' "$ref" | grep -Eq '^[A-Za-z0-9_.-]+/[A-Za-z0-9_./-]+@[0-9a-f]{40}$'; then
    echo "Unpinned or invalid Action ref at ${file_line}:${line_no}:" >&2
    echo "  $content" >&2
    echo "  Expected: owner/action@<40-char-sha> # vX.Y.Z" >&2
    bad=1
  fi
done < <(grep -RInE --include='*.yml' --include='*.yaml' '^\s*uses:\s+' "$WF_DIR" || true)

if [[ "$bad" -ne 0 ]]; then
  echo >&2
  echo "Pin every third-party and GitHub-owned Action to a full commit SHA." >&2
  echo "Dependabot (github-actions) keeps SHAs current — see docs/github-actions-pinning.md" >&2
  exit 1
fi

echo "OK: all workflow Action refs are SHA-pinned (${checked} uses: lines checked)."

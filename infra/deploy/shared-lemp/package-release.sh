#!/usr/bin/env bash
# Build the release tarball for shared-lemp-vm from the COMMITTED tree (git archive), so what is
# deployed is exactly a commit. Run from the repository root:
#
#   bash infra/deploy/shared-lemp/package-release.sh      -> dist/tindahan-release.tgz
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
SHA=$(git rev-parse --short HEAD)
[ -z "$(git status --porcelain -- backend frontend infra)" ] || echo "warning: uncommitted changes are NOT included (packaging $SHA)" >&2
mkdir -p dist
TMP=$(mktemp -d)
git archive --format=tar HEAD backend frontend infra | tar -x -C "$TMP"
echo "$SHA" > "$TMP/RELEASE"
tar -czf dist/tindahan-release.tgz -C "$TMP" .
rm -rf "$TMP"
echo "dist/tindahan-release.tgz ($SHA, $(du -h dist/tindahan-release.tgz | cut -f1))"

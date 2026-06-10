#!/usr/bin/env bash
set -e

# Usage:
#   ./bump.sh 1.2.3
#
# This will:
#   - bump package.json to 1.2.3
#   - run your version-bump.js script (updates manifest.json + versions.json)
#   - commit all changes
#   - create a git tag
#   - push commit + tag

VERSION="$1"

if [ -z "$VERSION" ]; then
  echo "Error: No version provided."
  echo "Usage: ./bump.sh 1.2.3"
  exit 1
fi

echo "🔧 Bumping version to $VERSION"

# 1. Update package.json
npm version "$VERSION" --no-git-tag-version

# 2. Run your Node bump script (updates manifest.json + versions.json)
npm run version

# 3. Commit changes
git add package.json manifest.json versions.json
git commit -m "Release $VERSION"

# 4. Create tag
git tag "$VERSION"

# 5. Push commit + tag
git push
git push --tags

echo "Version bump complete: $VERSION"

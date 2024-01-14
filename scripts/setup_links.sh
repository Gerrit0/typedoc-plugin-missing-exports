#!/bin/bash
# Expects to be run from within a package where you want to debug this plugin.
# Will create a td-missing-exports folder which hardlinks the build of this plugin
# so that imports of typedoc will use the debug target's version of TypeDoc,
# while allowing changes to be made/debugged in this repo.

PLUGIN_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &> /dev/null && pwd)

rm -rf td-missing-exports
mkdir td-missing-exports
ln -T "$PLUGIN_DIR/../package.json" td-missing-exports/package.json
ln -T "$PLUGIN_DIR/../index.js" td-missing-exports/index.js
ln -T "$PLUGIN_DIR/../index.js.map" td-missing-exports/index.js.map

echo "Add ./td-missing-exports/index.js to your plugins configuration for debugging"

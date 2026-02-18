#!/bin/bash
# Bundle QuoxMCP into a self-contained tarball for remote deployment.
# Creates quoxmcp-bundle.tar.gz with server.js, lib/, node_modules/, package.json.
# No `npm install` needed on remote hosts.
#
# Usage: cd /home/control/quoxmcp/deploy && ./bundle.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BUNDLE_NAME="quoxmcp-bundle.tar.gz"
BUNDLE_DIR="$SCRIPT_DIR/.bundle-staging"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log() { echo -e "${GREEN}[bundle]${NC} $1"; }
warn() { echo -e "${YELLOW}[bundle]${NC} $1"; }
error() { echo -e "${RED}[bundle]${NC} $1"; exit 1; }

# Verify we're in the right place
if [ ! -f "$PROJECT_ROOT/server.js" ]; then
  error "server.js not found in $PROJECT_ROOT — run from quoxmcp/deploy/"
fi

if [ ! -d "$PROJECT_ROOT/node_modules" ]; then
  error "node_modules/ not found. Run 'npm install' in $PROJECT_ROOT first."
fi

# Clean staging area
rm -rf "$BUNDLE_DIR"
mkdir -p "$BUNDLE_DIR"

log "Staging files from $PROJECT_ROOT..."

# Copy essential files only (no tests, no dev tooling)
cp "$PROJECT_ROOT/server.js" "$BUNDLE_DIR/"
cp "$PROJECT_ROOT/package.json" "$BUNDLE_DIR/"
cp -r "$PROJECT_ROOT/lib" "$BUNDLE_DIR/"

# Copy production node_modules (MCP SDK + zod)
cp -r "$PROJECT_ROOT/node_modules" "$BUNDLE_DIR/"

# Calculate size
STAGED_SIZE=$(du -sh "$BUNDLE_DIR" | cut -f1)
log "Staged: $STAGED_SIZE"

# Create tarball (flat — extracts directly into target dir)
log "Creating $BUNDLE_NAME..."
tar -czf "$SCRIPT_DIR/$BUNDLE_NAME" -C "$BUNDLE_DIR" .

# Clean up
rm -rf "$BUNDLE_DIR"

BUNDLE_SIZE=$(du -sh "$SCRIPT_DIR/$BUNDLE_NAME" | cut -f1)
log "Bundle created: $SCRIPT_DIR/$BUNDLE_NAME ($BUNDLE_SIZE)"
log "Deploy: extract to /opt/quoxmcp/ on remote hosts"

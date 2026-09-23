#!/usr/bin/env bash
# Generates Broadside.xcodeproj from project.yml. Run this once after cloning and any time project.yml changes.
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v xcodegen >/dev/null 2>&1; then
  if command -v brew >/dev/null 2>&1; then
    echo "Installing XcodeGen with Homebrew..."
    brew install xcodegen
  else
    echo "XcodeGen is not installed. Install Homebrew (https://brew.sh) and re-run, or: brew install xcodegen" >&2
    exit 1
  fi
fi

if [ ! -f Broadside/Config/GoogleService-Info.plist ]; then
  echo "NOTE: Broadside/Config/GoogleService-Info.plist is missing. The app will build but cannot talk to Firebase"
  echo "      until you download it from the Firebase console (see README step 3)."
fi

xcodegen generate
echo "Done. Open Broadside.xcodeproj in Xcode."

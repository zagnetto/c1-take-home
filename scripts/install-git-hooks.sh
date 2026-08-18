#!/bin/sh
set -eu

root="$(git rev-parse --show-toplevel)"
cd "$root"

git config --local core.hooksPath .githooks
echo "Git hooks installed (core.hooksPath=.githooks)"

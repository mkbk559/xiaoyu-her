#!/bin/bash
cd /opt/her || exit 1
export GIT_AUTHOR_NAME=dafeiyu GIT_AUTHOR_EMAIL=her@local GIT_COMMITTER_NAME=dafeiyu GIT_COMMITTER_EMAIL=her@local
git add -A >/dev/null 2>&1
if ! git diff --cached --quiet; then
  git commit -q -m "auto $(date '+%F %H:%M')"
fi
git tag -f "day-$(date +%F)" >/dev/null 2>&1
exit 0

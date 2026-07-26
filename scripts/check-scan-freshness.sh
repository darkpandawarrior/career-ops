#!/bin/bash
# check-scan-freshness.sh — dead-man's switch for the daily portal scan.
#
# Exits nonzero and prints a loud warning if the newest
# output/automation/scan-*.log is older than 36h (or missing) — catches a
# silently-broken launchd job (the Jun 29-Jul 9 class of outage) before it
# goes unnoticed for days. Read-only; installs no automation itself.
#
#   bash scripts/check-scan-freshness.sh [max_age_hours]
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOGDIR="$REPO/output/automation"
MAX_AGE_HOURS="${1:-36}"
MAX_AGE_SECS=$((MAX_AGE_HOURS * 3600))

LATEST="$(ls -t "$LOGDIR"/scan-*.log 2>/dev/null | head -1)"
if [ -z "$LATEST" ]; then
  echo "!!! CHECK-SCAN-FRESHNESS: no scan-*.log found in $LOGDIR — scan automation may have never run or LOGDIR moved !!!" >&2
  exit 1
fi

# ponytail: BSD stat (macOS) vs GNU stat (Linux) — try both, one always works.
MTIME="$(stat -f %m "$LATEST" 2>/dev/null || stat -c %Y "$LATEST" 2>/dev/null)"
NOW="$(date +%s)"
AGE_SECS=$((NOW - MTIME))

if [ "$AGE_SECS" -gt "$MAX_AGE_SECS" ]; then
  AGE_HOURS=$((AGE_SECS / 3600))
  echo "!!! CHECK-SCAN-FRESHNESS: newest scan log ($LATEST) is ${AGE_HOURS}h old (limit ${MAX_AGE_HOURS}h) — scan automation looks broken, investigate launchd/cron now !!!" >&2
  exit 1
fi

echo "ok: $LATEST is $((AGE_SECS / 3600))h old (limit ${MAX_AGE_HOURS}h)"
exit 0

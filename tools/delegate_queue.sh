#!/usr/bin/env bash
# Runs queued delegate briefs through opencode, one after another, waiting for the free quota to come
# back when it is used up. Leaves every change uncommitted for review. Log: tools/.cache/delegate-queue/.
# The free quota only returns after 24 hours with no requests at all, so the queue makes no request
# until START_AFTER seconds have passed, and after a refusal stays silent for a full day again.
# Usage: START_AFTER=87300 setsid nohup tools/delegate_queue.sh brief1.md brief2.md ... &
cd "$(dirname "$0")/.." || exit 1
D=~/.claude/skills/delegate-to-opencode/delegate.sh
MODEL=opencode/muse-spark-1.3-contributor-free
LOG=tools/.cache/delegate-queue
mkdir -p "$LOG"
QUIET=87300
echo "$(date -Is) queue waiting ${START_AFTER:-0} s before its first request" >> "$LOG/queue.log"
sleep "${START_AFTER:-0}"
clean() {
  keep=$(grep -oh '/tmp/\.[0-9a-f]*-[0-9]*\.so' /proc/[0-9]*/maps 2>/dev/null | sort -u)
  for f in $(find /tmp -maxdepth 1 -type f -user "$USER" -name '.*-[0-9]*.so'); do
    case " $keep " in *"$f"*) ;; *) rm -f -- "$f";; esac; done
}
for brief in "$@"; do
  name=$(basename "$brief" .md)
  while :; do
    sid=$("$D" --async --model "$MODEL" --title "$name" "$(cat "$brief")") || { sleep "$QUIET"; continue; }
    echo "$(date -Is) $name started $sid" >> "$LOG/queue.log"
    sleep 180
    # A run that has produced nothing and reports the usage limit means the quota is still out.
    if "$D" --result "$sid" 2>&1 | grep -q "FreeUsage\|Free usage" || "$D" --status "$sid" | grep -q "Free usage"; then
      "$D" --abort "$sid" > /dev/null 2>&1
      echo "$(date -Is) $name: no quota yet, silent for another day" >> "$LOG/queue.log"
      sleep "$QUIET"
      continue
    fi
    break
  done
  while :; do
    "$D" --auto-allow --wait "$sid" 1800 30 > /dev/null 2>> "$LOG/$name.err"; rc=$?
    clean
    case $rc in
      0|2) break ;;
      10) for q in $("$D" --questions "$sid" 2>&1 | grep -o 'que_[A-Za-z0-9]*' | sort -u); do
            "$D" --reject-question "$q" "No one is here to answer: choose the obvious default and note it in the report." > /dev/null 2>&1; done ;;
      11) for p in $("$D" --permissions "$sid" 2>&1 | grep -o 'per_[A-Za-z0-9]*' | sort -u); do "$D" --deny "$p" "not allowed unattended" > /dev/null 2>&1; done ;;
    esac
  done
  "$D" --result "$sid" > "$LOG/$name.report.txt" 2>&1
  git status --short > "$LOG/$name.status.txt"
  echo "$(date -Is) $name finished rc=$rc" >> "$LOG/queue.log"
done

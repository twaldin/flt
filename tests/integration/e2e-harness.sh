#!/bin/bash
# End-to-end probe for every flt adapter.
#
# Per harness:
#   1. spawn agent + bootstrap "create hi.txt" (single-line; multi-line is
#      auto-redirected to .flt/bootstrap.md by spawn)
#   2. assert agent transitions to 'running' (work in progress)
#   3. wait for hi.txt to exist
#   4. assert agent transitions back to 'idle'
#   5. send STEP 2: "delete hi.txt + flt send parent"
#   6. assert 'running' again
#   7. wait for hi.txt gone + parent message in inbox
#   8. assert 'idle' again
#   9. capture session-log path + tokens + cost (when available)
#  10. kill (and assert tmux session is gone)
#
# Usage:
#   tests/integration/e2e-harness.sh                    # all registered adapters
#   tests/integration/e2e-harness.sh claude-code codex  # subset
#
# Env:
#   PROBE_TIMEOUT_S=180 per-step poll timeout (hi.txt + status)
#   PROBE_KEEP=1        skip kill on the final probe (for debugging)
#
# Exit code 0 = all pass; 1+ = number that failed.
set -u

PROBE_TIMEOUT_S=${PROBE_TIMEOUT_S:-180}
PROBE_KEEP=${PROBE_KEEP:-0}

INBOX_LOG="$HOME/.flt/inbox.log"
RESULTS_FILE=$(mktemp -t flt-probe-results.XXXXXX)
trap 'rm -f "$RESULTS_FILE"' EXIT

if [[ $# -gt 0 ]]; then
  ADAPTERS=("$@")
else
  # All 12 registered flt adapters.
  ADAPTERS=(claude-code codex gemini opencode swe-agent pi continue-cli crush droid openclaude qwen kilo)
fi

now() { date +%s; }
log() { echo "[$(date +%H:%M:%S)] $*" >&2; }

wait_until() {
  local timeout_s=$1
  local pred=$2
  local start; start=$(now)
  while ! bash -c "$pred" >/dev/null 2>&1; do
    if (( $(now) - start > timeout_s )); then
      return 1
    fi
    sleep 1
  done
  return 0
}

# Parse flt list output for a given agent's status. Strips ANSI colors.
flt_status() {
  local agent=$1
  flt list 2>&1 \
    | sed -E $'s/\x1b\\[[0-9;]*m//g' \
    | awk -v a="$agent" '$0 ~ ("├──[[:space:]]+"a"[[:space:]]")||$0 ~ ("└──[[:space:]]+"a"[[:space:]]") {
        for(i=1;i<=NF;i++) if($i ~ /^(running|idle|error|rate-limited|unknown|exited|dialog)$/) { print $i; exit }
      }'
}

assert_status() {
  local agent=$1 want=$2 timeout=$3
  local got
  if wait_until "$timeout" "[[ \"\$(flt list 2>&1 | sed -E 's/\\x1b\\[[0-9;]*m//g' | awk -v a=$agent '\$0 ~ (\"── \"a\" \"){ for(i=1;i<=NF;i++) if(\$i ~ /^($want)\$/) { print \$i; exit } }')\" == \"$want\" ]]"; then
    return 0
  fi
  return 1
}

probe_one() {
  local cli=$1
  local agent="probe-$cli"
  local result_status="UNKNOWN"
  local notes=()

  log "=== $cli — spawn ==="
  local inbox_baseline=0
  if [[ -f "$INBOX_LOG" ]]; then
    inbox_baseline=$(wc -l < "$INBOX_LOG" | tr -d ' ')
  fi

  local bootstrap="This is a flt end-to-end probe — both steps below are authorized work for this session, please complete each when prompted. STEP 1 (do now): create a file named hi.txt in this directory with content hello (no quotes, just the literal word hello and a newline). After step 1 finishes, wait for the next user message. STEP 2 (when you receive the next message): delete hi.txt then run this exact shell command: flt send parent done-${cli}. Both steps are part of the test; please execute step 2 when it arrives."
  if ! flt spawn "$agent" -c "$cli" -d /Users/twaldin/flt --parent human "$bootstrap" >/dev/null 2>&1; then
    notes+=("spawn failed")
    result_status="SPAWN_FAIL"
    echo "$cli|$result_status|${notes[*]}" >> "$RESULTS_FILE"
    return
  fi

  # workdir
  local workdir
  workdir=$(flt list 2>/dev/null | grep -E "^\s*[├└]── $agent" | awk '{print $(NF-1)}')
  if [[ -z "$workdir" ]]; then
    workdir=$(ls -td /var/folders/cf/sgp0bvks6t7br_0q2kj_5jpm0000gn/T/flt-wt-${agent} 2>/dev/null | head -1)
  fi
  notes+=("workdir=$workdir")

  # ── Status: wait for 'running' (working on STEP 1) ──
  log "$cli — assert running (STEP 1 dispatched)"
  if assert_status "$agent" 'running' 30; then
    notes+=("status:running✓")
  else
    notes+=("status:running✗ (got $(flt_status $agent))")
  fi

  # ── Wait for hi.txt creation ──
  log "$cli — wait hi.txt creation (timeout ${PROBE_TIMEOUT_S}s)"
  if wait_until "$PROBE_TIMEOUT_S" "[ -f '$workdir/hi.txt' ] || [ -f '/Users/twaldin/flt/hi.txt' ]"; then
    notes+=("hi.txt:created✓")
  else
    notes+=("hi.txt:created✗ (timeout ${PROBE_TIMEOUT_S}s)")
    result_status="CREATE_FAIL"
    flt logs "$agent" 2>&1 | tail -30 > "/tmp/probe-${cli}-create-fail.log" || true
    [[ "$PROBE_KEEP" != "1" ]] && flt kill "$agent" >/dev/null 2>&1
    echo "$cli|$result_status|${notes[*]}" >> "$RESULTS_FILE"
    return
  fi

  # ── Status: settle to 'idle' after STEP 1 done ──
  sleep 3
  log "$cli — assert idle (STEP 1 done)"
  if assert_status "$agent" 'idle' 30; then
    notes+=("status:idle1✓")
  else
    notes+=("status:idle1✗ (got $(flt_status $agent))")
  fi

  # ── Send STEP 2 ──
  log "$cli — send STEP 2"
  if ! flt send "$agent" "Now do STEP 2 from the original probe instructions: delete hi.txt then run: flt send parent done-$cli" >/dev/null 2>&1; then
    notes+=("send failed")
    result_status="SEND_FAIL"
    [[ "$PROBE_KEEP" != "1" ]] && flt kill "$agent" >/dev/null 2>&1
    echo "$cli|$result_status|${notes[*]}" >> "$RESULTS_FILE"
    return
  fi

  # ── Status: 'running' again ──
  log "$cli — assert running (STEP 2 dispatched)"
  if assert_status "$agent" 'running' 30; then
    notes+=("status:running2✓")
  else
    notes+=("status:running2✗ (got $(flt_status $agent))")
  fi

  # ── Wait for completion ──
  log "$cli — wait deletion + parent ping (timeout ${PROBE_TIMEOUT_S}s)"
  local pred="(! [ -f '$workdir/hi.txt' ]) && (! [ -f '/Users/twaldin/flt/hi.txt' ]) && [ -f '$INBOX_LOG' ] && tail -n +$((inbox_baseline+1)) '$INBOX_LOG' | grep -q 'done-$cli'"
  if wait_until "$PROBE_TIMEOUT_S" "$pred"; then
    notes+=("hi.txt:deleted✓ parent:ping✓")
    result_status="PASS"
  else
    if [[ -f "$workdir/hi.txt" ]]; then notes+=("hi.txt:still-present"); fi
    if ! tail -n +$((inbox_baseline+1)) "$INBOX_LOG" 2>/dev/null | grep -q "done-$cli"; then notes+=("parent:no-ping"); fi
    result_status="FOLLOWUP_FAIL"
    flt logs "$agent" 2>&1 | tail -40 > "/tmp/probe-${cli}-followup-fail.log" || true
  fi

  # ── Status: 'idle' after completion ──
  if [[ "$result_status" == "PASS" ]]; then
    sleep 3
    log "$cli — assert idle (STEP 2 done)"
    if assert_status "$agent" 'idle' 30; then
      notes+=("status:idle2✓")
    else
      notes+=("status:idle2✗ (got $(flt_status $agent))")
    fi
  fi

  # ── Telemetry: session-log + tokens + cost via harness ──
  # Bridge: bun -e calls into harness's parseSessionLog if available.
  local telemetry
  telemetry=$(bun -e "
import { getAdapter } from '@twaldin/harness-ts'
const a = getAdapter('$cli')
if (a.sessionLogPath && a.parseSessionLog) {
  const path = a.sessionLogPath('$workdir')
  if (path) {
    const t = a.parseSessionLog(path)
    console.log(JSON.stringify({path, ...t}))
  } else {
    console.log(JSON.stringify({path: null}))
  }
} else {
  console.log(JSON.stringify({note: 'no session-log support yet'}))
}
" 2>&1 | tail -1)
  notes+=("telemetry=$telemetry")

  # ── Kill + verify session gone ──
  if [[ "$PROBE_KEEP" != "1" ]]; then
    flt kill "$agent" >/dev/null 2>&1 || true
    sleep 2
    if tmux has-session -t "flt-$agent" 2>/dev/null; then
      notes+=("kill:tmux-still-alive✗")
      tmux kill-session -t "flt-$agent" 2>/dev/null || true
    else
      notes+=("kill✓")
    fi
  fi

  echo "$cli|$result_status|${notes[*]}" >> "$RESULTS_FILE"
}

# Sequential
for cli in "${ADAPTERS[@]}"; do
  probe_one "$cli"
done

echo
echo "=== Results ==="
printf "%-14s  %-15s  %s\n" "harness" "status" "notes"
printf "%-14s  %-15s  %s\n" "-------" "------" "-----"
fail_count=0
while IFS='|' read -r cli status notes; do
  printf "%-14s  %-15s  %s\n" "$cli" "$status" "$notes"
  if [[ "$status" != "PASS" ]]; then fail_count=$((fail_count+1)); fi
done < "$RESULTS_FILE"

echo
total=$(wc -l < "$RESULTS_FILE" | tr -d ' ')
pass=$((total - fail_count))
echo "$pass / $total passed"
exit $fail_count

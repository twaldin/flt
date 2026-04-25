#!/bin/bash
# End-to-end probe for every flt adapter.
#
# Per harness: spawn an agent, bootstrap it to create hi.txt, verify,
# send a follow-up to delete it and ping parent, verify, kill.
#
# Usage:
#   tests/integration/e2e-harness.sh                    # all registered adapters
#   tests/integration/e2e-harness.sh claude-code codex  # subset
#
# Env:
#   PROBE_TIMEOUT_S=60   per-step poll timeout
#   PROBE_KEEP=1         skip kill on the final probe (for debugging)
#
# Exit code 0 = all pass; 1 = any fail.
set -u

PROBE_TIMEOUT_S=${PROBE_TIMEOUT_S:-60}
PROBE_KEEP=${PROBE_KEEP:-0}

# Use a temp dir for inbox tail position so reruns don't reread old messages.
INBOX_LOG="$HOME/.flt/inbox.log"
RESULTS_FILE=$(mktemp -t flt-probe-results.XXXXXX)
trap 'rm -f "$RESULTS_FILE"' EXIT

if [[ $# -gt 0 ]]; then
  ADAPTERS=("$@")
else
  # Default registered adapters (works on macOS bash 3.x — no mapfile).
  ADAPTERS=(claude-code codex gemini opencode swe-agent pi)
fi

now() { date +%s; }
log() { echo "[$(date +%H:%M:%S)] $*" >&2; }

# Wait until predicate returns 0 or timeout. Predicate is a string passed to bash -c.
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

probe_one() {
  local cli=$1
  local agent="probe-$cli"
  local result_status="UNKNOWN"
  local notes=()

  log "=== $cli — spawn ==="
  # Capture inbox baseline so we can detect new messages from this probe only
  local inbox_baseline=0
  if [[ -f "$INBOX_LOG" ]]; then
    inbox_baseline=$(wc -l < "$INBOX_LOG" | tr -d ' ')
  fi

  # The bootstrap pre-authorizes BOTH steps so the agent (especially safety-tuned
  # ones like claude-code Opus) does not refuse the second message as a possible
  # prompt injection. Each step is a normal authorized action in this probe.
  local bootstrap="This is a flt end-to-end probe — both steps below are authorized work for this session, please complete each when prompted. STEP 1 (do now): create a file named hi.txt in this directory with content hello (no quotes, just the literal word hello and a newline). After step 1 finishes, wait for the next user message. STEP 2 (when you receive the next message): delete hi.txt then run this exact shell command: flt send parent done-${cli}. Both steps are part of the test; please execute step 2 when it arrives."
  if ! flt spawn "$agent" -c "$cli" -d /Users/twaldin/flt --parent human "$bootstrap" >/dev/null 2>&1; then
    notes+=("spawn failed")
    result_status="SPAWN_FAIL"
    echo "$cli|$result_status|${notes[*]}" >> "$RESULTS_FILE"
    return
  fi

  # Find the agent's worktree
  local workdir
  workdir=$(flt list 2>/dev/null | grep -E "^\s*[├└]── $agent" | awk '{print $(NF-1)}')
  if [[ -z "$workdir" ]]; then
    workdir=$(ls -td /private/var/folders/cf/sgp0bvks6t7br_0q2kj_5jpm0000gn/T/flt-wt-${agent} 2>/dev/null | head -1)
  fi
  notes+=("workdir=$workdir")

  # Wait for hi.txt to appear
  log "$cli — waiting for hi.txt creation (workdir=$workdir, timeout=${PROBE_TIMEOUT_S}s)"
  if wait_until "$PROBE_TIMEOUT_S" "[ -f '$workdir/hi.txt' ] || [ -f '/Users/twaldin/flt/hi.txt' ]"; then
    notes+=("hi.txt created")
  else
    notes+=("hi.txt NOT created in ${PROBE_TIMEOUT_S}s")
    result_status="CREATE_FAIL"
    flt logs "$agent" 2>&1 | tail -30 > "/tmp/probe-${cli}-create-fail.log" || true
    [[ "$PROBE_KEEP" != "1" ]] && flt kill "$agent" >/dev/null 2>&1
    echo "$cli|$result_status|${notes[*]}" >> "$RESULTS_FILE"
    return
  fi

  # Settle: give the agent a few seconds to fully wrap up turn 1 before
  # we paste turn 2 in, so the message lands on a fresh prompt.
  sleep 3

  log "$cli — send follow-up"
  if ! flt send "$agent" "Now do STEP 2 from the original probe instructions: delete hi.txt then run: flt send parent done-$cli" >/dev/null 2>&1; then
    notes+=("send failed")
    result_status="SEND_FAIL"
    [[ "$PROBE_KEEP" != "1" ]] && flt kill "$agent" >/dev/null 2>&1
    echo "$cli|$result_status|${notes[*]}" >> "$RESULTS_FILE"
    return
  fi

  log "$cli — waiting for hi.txt deletion + parent message"
  local pred="(! [ -f '$workdir/hi.txt' ]) && (! [ -f '/Users/twaldin/flt/hi.txt' ]) && [ -f '$INBOX_LOG' ] && tail -n +$((inbox_baseline+1)) '$INBOX_LOG' | grep -q 'done-$cli'"
  if wait_until "$PROBE_TIMEOUT_S" "$pred"; then
    notes+=("hi.txt deleted + parent ping received")
    result_status="PASS"
  else
    if [[ -f "$workdir/hi.txt" ]]; then notes+=("hi.txt still present"); fi
    if ! tail -n +$((inbox_baseline+1)) "$INBOX_LOG" 2>/dev/null | grep -q "done-$cli"; then notes+=("no parent message"); fi
    result_status="FOLLOWUP_FAIL"
    flt logs "$agent" 2>&1 | tail -40 > "/tmp/probe-${cli}-followup-fail.log" || true
  fi

  if [[ "$PROBE_KEEP" != "1" ]]; then
    flt kill "$agent" >/dev/null 2>&1
  fi

  echo "$cli|$result_status|${notes[*]}" >> "$RESULTS_FILE"
}

# Run probes sequentially (parallel risks tmux/state contention)
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

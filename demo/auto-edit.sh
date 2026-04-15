#!/bin/bash
# Auto-edit pipeline: raw video + script → edited short
# Usage: auto-edit.sh <input.mov> <script.md> <output.mp4>
# Requires: ffmpeg, auto-editor, GEMINI_API_KEY in ~/.env

set -e

INPUT="${1:?Usage: auto-edit.sh <input> <script> <output>}"
SCRIPT="${2:?Usage: auto-edit.sh <input> <script> <output>}"
OUTPUT="${3:-$(dirname "$INPUT")/edited-$(basename "$INPUT" .mov).mp4}"

source ~/.env 2>/dev/null

if [ -z "$GEMINI_API_KEY" ]; then
  echo "Error: GEMINI_API_KEY not set"
  exit 1
fi

WORKDIR=$(mktemp -d)
echo "Working in: $WORKDIR"

# Step 1: Remove silence with auto-editor
echo "Step 1: Removing silence..."
auto-editor "$INPUT" --edit audio:threshold=0.04 --margin 0.15s -o "$WORKDIR/desilenced.mp4" 2>&1 | tail -3

# Step 2: Upload video to Gemini Files API
echo "Step 2: Uploading to Gemini..."
UPLOAD_RESP=$(curl -s -X POST \
  "https://generativelanguage.googleapis.com/upload/v1beta/files?key=$GEMINI_API_KEY" \
  -H "X-Goog-Upload-Command: start, upload, finalize" \
  -H "X-Goog-Upload-Header-Content-Type: video/mp4" \
  -H "Content-Type: video/mp4" \
  --data-binary "@$WORKDIR/desilenced.mp4")

FILE_URI=$(echo "$UPLOAD_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['file']['uri'])" 2>/dev/null)

if [ -z "$FILE_URI" ]; then
  echo "Upload failed: $UPLOAD_RESP"
  # Fall back to using original without Gemini
  echo "Falling back to auto-editor output only..."
  cp "$WORKDIR/desilenced.mp4" "$OUTPUT"
  rm -rf "$WORKDIR"
  exit 0
fi

echo "Uploaded: $FILE_URI"

# Wait for file to be processed
echo "Waiting for Gemini to process video..."
sleep 10

# Step 3: Ask Gemini to analyze and return edit decisions
echo "Step 3: Getting edit decisions from Gemini..."
SCRIPT_CONTENT=$(cat "$SCRIPT")

EDL_RESP=$(curl -s -X POST \
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=$GEMINI_API_KEY" \
  -H "Content-Type: application/json" \
  -d "$(python3 -c "
import json, sys
script = open('$SCRIPT').read()
req = {
    'contents': [{
        'parts': [
            {'file_data': {'mime_type': 'video/mp4', 'file_uri': '$FILE_URI'}},
            {'text': '''You are a video editor. Analyze this video and the script below.
Return a JSON array of segments to KEEP in the final edit. Each segment has start_seconds and end_seconds.
The goal is a <60 second final video. Keep the most compelling, on-script moments.
Cut: dead air, filler words, off-topic tangents, repeated takes, long pauses.
Keep: key demonstrations, clear explanations, visual moments, the hook, and the conclusion.

SCRIPT:
''' + script + '''

Return ONLY valid JSON, no markdown. Format:
{\"segments\": [{\"start\": 0.0, \"end\": 5.5, \"reason\": \"hook\"}, ...], \"total_duration\": 58.0}
'''}
        ]
    }],
    'generationConfig': {
        'temperature': 0.2,
        'maxOutputTokens': 2000
    }
}
print(json.dumps(req))
")")

# Extract the JSON from Gemini's response
EDL=$(echo "$EDL_RESP" | python3 -c "
import sys, json, re
resp = json.load(sys.stdin)
text = resp['candidates'][0]['content']['parts'][0]['text']
# Strip markdown code fences if present
text = re.sub(r'^\`\`\`json?\s*', '', text.strip())
text = re.sub(r'\`\`\`\s*$', '', text.strip())
data = json.loads(text)
print(json.dumps(data))
" 2>/dev/null)

if [ -z "$EDL" ]; then
  echo "Gemini EDL parsing failed. Response:"
  echo "$EDL_RESP" | python3 -c "import sys,json; r=json.load(sys.stdin); print(r.get('candidates',[{}])[0].get('content',{}).get('parts',[{}])[0].get('text','no text'))" 2>/dev/null || echo "$EDL_RESP" | head -20
  echo "Falling back to auto-editor output only..."
  cp "$WORKDIR/desilenced.mp4" "$OUTPUT"
  rm -rf "$WORKDIR"
  exit 0
fi

echo "EDL: $EDL"

# Step 4: Build ffmpeg filter from segments
echo "Step 4: Assembling final cut..."
SEGMENTS=$(echo "$EDL" | python3 -c "
import sys, json
data = json.load(sys.stdin)
segs = data['segments']
# Build ffmpeg complex filter
inputs = []
for i, seg in enumerate(segs):
    s, e = seg['start'], seg['end']
    inputs.append(f'[0:v]trim=start={s}:end={e},setpts=PTS-STARTPTS[v{i}]')
    inputs.append(f'[0:a]atrim=start={s}:end={e},asetpts=PTS-STARTPTS[a{i}]')
concat_v = ''.join(f'[v{i}]' for i in range(len(segs)))
concat_a = ''.join(f'[a{i}]' for i in range(len(segs)))
n = len(segs)
filter_str = ';'.join(inputs) + f';{concat_v}{concat_a}concat=n={n}:v=1:a=1[outv][outa]'
print(filter_str)
")

ffmpeg -y -i "$WORKDIR/desilenced.mp4" -filter_complex "$SEGMENTS" \
  -map "[outv]" -map "[outa]" \
  -c:v libx264 -preset fast -crf 20 \
  -c:a aac -b:a 128k \
  "$OUTPUT" 2>&1 | tail -3

# Cleanup
rm -rf "$WORKDIR"

# Report
DURATION=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1 "$OUTPUT" | cut -d. -f1)
echo ""
echo "Done! Output: $OUTPUT (${DURATION}s)"

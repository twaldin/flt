#!/bin/bash
# Kill all demo agents
flt kill demo-claude 2>/dev/null
flt kill demo-codex 2>/dev/null
flt kill demo-gemini 2>/dev/null
flt kill demo-oc 2>/dev/null
echo "demo agents killed"

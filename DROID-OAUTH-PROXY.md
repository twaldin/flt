# Droid OAuth proxy notes

This document records the local fix for using Factory Droid with OpenAI/Codex OAuth models through the local `openai-oauth` proxy.

## Goal

Factory Droid custom models for GPT-5/Codex should use Factory's native OpenAI provider:

```json
"provider": "openai",
"baseUrl": "http://localhost:10531/v1"
```

That makes Droid call the OpenAI Responses API (`/v1/responses`) instead of the generic chat-completions compatibility path. Benefits:

- no startup warning like `Your custom model "gpt-5.5" appears to be an OpenAI model...`
- real token usage instead of `0/0/0/0`
- native Responses API fields such as reasoning/thinking tokens

## Symptoms before the fix

With `~/.factory/settings.json` using:

```json
"provider": "generic-chat-completion-api"
```

Droid works, but Factory injects this warning into the session:

```text
Error: Your custom model "gpt-5.5" appears to be an OpenAI model, but is configured with provider "generic-chat-completion-api". For GPT-5+, GPT-4o, o-series, and Codex models, use "provider": "openai" (Responses API).
```

The local proxy's `/v1/chat/completions` route also returns usage as zero, so Droid reports:

```json
"usage": {
  "input_tokens": 0,
  "output_tokens": 0,
  "cache_read_input_tokens": 0,
  "cache_creation_input_tokens": 0
}
```

Simply switching Factory to `provider: "openai"` was not enough: Droid would retry/hang or fail because the local proxy/upstream Codex transport was not compatible with the exact request Droid sends.

## Components on this machine

Proxy launcher:

```text
/Users/twaldin/agentelo/bin/openai-oauth-proxy.mjs
```

Proxy package dist used by that launcher:

```text
/Users/twaldin/.npm/_npx/1afc27b2df6982f0/node_modules/openai-oauth/dist
```

Default proxy URL:

```text
http://127.0.0.1:10531/v1
```

Auth file:

```text
~/.codex/auth.json
```

Factory model config:

```text
~/.factory/settings.json
```

## Fix applied

### 1. Use the upstream Responses collector fix

NPM `openai-oauth` was still at `1.0.2`, but upstream PR #11 contains the important Responses API fix:

```text
https://github.com/EvanZhouDev/openai-oauth/pull/11
```

The PR rebuilds final non-streaming `/v1/responses` JSON from streamed `response.output_item.done` events when the final `response.completed.response.output` is empty. Without this, Responses clients can see empty/stuck turns even though the model generated output tokens.

Local procedure used:

```bash
git clone --branch fix/codex-empty-output-rebuild --depth 1 \
  https://github.com/srizzo/openai-oauth.git /tmp/openai-oauth-pr11
cd /tmp/openai-oauth-pr11
bun install
cd packages/openai-oauth
bun run build
```

Then back up and replace the installed dist:

```bash
ORIG="$HOME/.npm/_npx/1afc27b2df6982f0/node_modules/openai-oauth/dist"
BAK="$HOME/.npm/_npx/1afc27b2df6982f0/node_modules/openai-oauth/dist.bak-$(date +%Y%m%d-%H%M%S)"
cp -R "$ORIG" "$BAK"
rm -rf "$ORIG"/*
cp -R /tmp/openai-oauth-pr11/packages/openai-oauth/dist/* "$ORIG"/
```

### 2. Strip Droid/Factory fields rejected by Codex upstream

Factory's OpenAI provider sends some public Responses API parameters that the ChatGPT Codex backend rejects. A logging proxy showed these upstream errors:

```json
{"detail":"Unsupported parameter: prompt_cache_retention"}
{"detail":"Unsupported parameter: safety_identifier"}
```

Patch the built proxy chunk in `openai-oauth/dist` inside `normalizeCodexResponsesBody`, next to the existing `delete normalized.max_output_tokens` line:

```js
delete normalized.max_output_tokens
delete normalized.prompt_cache_retention
delete normalized.safety_identifier
delete normalized.user
delete normalized.temperature
delete normalized.top_p
```

The exact built chunk filename may change, e.g. `chunk-5YZRJBCQ.js`; grep for `delete normalized.max_output_tokens`.

### 3. Restart the proxy

```bash
lsof -tiTCP:10531 -sTCP:LISTEN | xargs kill
nohup node /Users/twaldin/agentelo/bin/openai-oauth-proxy.mjs \
  > /tmp/openai-oauth-proxy.log 2>&1 &
```

Verify:

```bash
curl -sS http://127.0.0.1:10531/v1/models
```

### 4. Switch Factory custom models to `provider: "openai"`

Update `~/.factory/settings.json` custom models to point at the local proxy with the native OpenAI provider:

```json
{
  "model": "gpt-5.5",
  "id": "custom:gpt-5.5-(codex-oauth)-0",
  "baseUrl": "http://localhost:10531/v1",
  "apiKey": "dummy",
  "displayName": "gpt-5.5 (codex-oauth)",
  "noImageSupport": true,
  "provider": "openai"
}
```

Apply the same provider/baseUrl pattern to the other local Codex OAuth custom models.

## Verification

Run a bounded Droid exec smoke test:

```bash
TMP=$(mktemp -d)
echo 'You are concise.' > "$TMP/AGENTS.md"
cd "$TMP"

droid exec --output-format json --skip-permissions-unsafe \
  --model custom:gpt-5.5-(codex-oauth)-0 \
  --spec-model custom:gpt-5.5-(codex-oauth)-0 \
  'Answer exactly: MAIN_OPENAI_OK'
```

Expected result:

```json
{
  "type": "result",
  "subtype": "success",
  "is_error": false,
  "result": "MAIN_OPENAI_OK",
  "usage": {
    "input_tokens": 12062,
    "output_tokens": 50,
    "cache_read_input_tokens": 0,
    "cache_creation_input_tokens": 0,
    "thinking_tokens": 40
  }
}
```

Also inspect the matching Factory session JSONL under `~/.factory/sessions/...`. It should not contain the `appears to be an OpenAI model` warning, and the settings file should show:

```json
"providerLock": "openai",
"tokenUsage": {
  "inputTokens": ...,
  "outputTokens": ...,
  "thinkingTokens": ...
}
```

## Caveats

- This is a local dist patch until the upstream PR is merged/released and the unsupported-parameter stripping is included upstream.
- Reinstalling or re-running `npx openai-oauth` may replace the patched dist. If the warning/zero-usage behavior returns, repeat the dist replacement and local strip patch.
- Keep `~/.factory/settings.json` on `provider: "openai"` after the proxy is patched; falling back to `generic-chat-completion-api` makes output work but reintroduces the warning and zero usage.

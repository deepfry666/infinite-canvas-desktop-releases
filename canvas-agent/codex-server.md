# Codex App Server references

The optional development bridge in `canvas-agent` integrates with Codex App Server.
The ordinary FourJ Canvas desktop workflow uses the built-in Chat interface and
does not require installing an external Codex plugin.

Use the authoritative upstream implementation and documentation rather than a
vendored copy of third-party documentation:

- App Server implementation and protocol: https://github.com/openai/codex/tree/main/codex-rs/app-server
- Public documentation index previously referenced by this project: https://learn.chatgpt.com/llms.txt
- Project bridge implementation: `src/agent/codex-client.ts` and `src/agent/codex-protocol.ts`.

The upstream sources and documentation retain their own terms. This index does
not relicense their contents or bundle any authentication credentials. Never
commit API keys, access tokens, local account state, or recorded user sessions.

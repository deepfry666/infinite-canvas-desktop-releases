# FourJ Canvas Documentation Index

## Overview

- [Quick Start](/docs/overview/quick-start)
- [Features](/docs/overview/features)
- [Third-party GitHub Prompt Repositories](/docs/overview/third-party-prompt-repositories)

## Canvas Guide

- [Canvas Node Guide](/docs/canvas/canvas-node-manual)
- [Canvas Shortcuts](/docs/canvas/canvas-shortcuts)

## Development and Data

- [Design System](/docs/development/design-system) (brand, tokens, fonts, motion, rollout plan)
- [Local Development](/docs/development/local-development)
- [Canvas Data Structure](/docs/development/canvas-data-structure)
- [How the Local Codex Connection Works](/docs/development/local-codex-canvas)

## Business

- [Open-source License](/docs/business/license)
- [Business Cooperation](/docs/business/business)

## Support and Security

- [Report a Vulnerability](/docs/support/security)
- [Sponsor the Project](/docs/support/sponsor)

## Project Progress

- [Changelog](/docs/progress/changelog)
- [Pending Tests](/docs/progress/pending-test)
- [TODO](/docs/progress/todo)
- [Desktop Product Plan v0.1](plans/desktop-product-plan-v0.1.zh-CN.md)

## Notes

- FourJ Canvas is distributed only as a desktop application. `web/` is its Electron renderer, not a separate web product.
- Canvas projects and My Assets are stored in the local desktop workspace. WebDAV can be configured for cross-device synchronization.
- The AI API key is stored in local application configuration; the desktop renderer sends requests directly to configured OpenAI-compatible endpoints.

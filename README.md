# Curlmate Pi Extension

Pi extension for Curlmate - Persistent OAuth for Agents.

## Overview

This extension provides tools for managing OAuth tokens via Curlmate. It allows AI agents to:
- Get available OAuth services (skill)
- Exchange API key for JWT
- List connected OAuth accounts
- Get fresh access tokens for connections
- Generate OAuth authentication URLs

## Setup

1. Set the `CURLMATE_API_KEY` environment variable with your Curlmate API key:
   ```
   export CURLMATE_API_KEY=cm_live_xxxxx
   ```

2. Add this extension to your Pi agent configuration.

## Tools

### curlmate

| Parameter | Type | Description |
|-----------|------|-------------|
| action | string | Action to perform: skill, jwt, connections, token, auth-url |
| connection | string (optional) | Connection id (for token action) |
| service | string (optional) | Service name (e.g., google-calendar, slack) for auth-url |

## Workflow

1. **Get available services:**
   ```
   curlmate(action="skill")
   ```

2. **Obtain JWT (one-time per session):**
   ```
   curlmate(action="jwt")
   ```

3. **List connections:**
   ```
   curlmate(action="connections")
   ```

4. **Get access token:**
   ```
   curlmate(action="token", connection="connection-id")
   ```

5. **Get auth URL for new connection:**
   ```
   curlmate(action="auth-url", service="google-calendar")
   ```

## Security

- Never embed secrets directly in prompts or messages
- Store `CURLMATE_API_KEY` in environment variables
- JWT is stored in session storage automatically

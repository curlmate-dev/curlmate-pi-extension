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
| connection | string (optional) | Connection id (from the `connections` action). For `token` and `auth-url`, it is combined with `service` as `<id>:<service>` for the `x-connection` header. |
| service | string (optional) | Service name (e.g., gmail, google-calendar, slack). Required for `token` and `auth-url` so the extension can form `<id>:<service>` for the `x-connection` header. |

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
   This returns objects like:
   ```json
   {
     "connections": [
       { "id": "299b4860eac34eeb3cbfabe895f8fd6a", "service": "gmail" }
     ]
   }
   ```

4. **Get access token for a connection:**
   ```
   curlmate(
     action="token",
     connection="299b4860eac34eeb3cbfabe895f8fd6a", // id from connections
     service="gmail"                                // service from connections
   )
   ```

5. **Get auth URL for a connection (re-auth):**
   ```
   curlmate(
     action="auth-url",
     connection="299b4860eac34eeb3cbfabe895f8fd6a", // id from connections
     service="gmail"                                // service from connections
   )
   ```

## Security

- Never embed secrets directly in prompts or messages
- Store `CURLMATE_API_KEY` in environment variables
- JWT is stored in session storage automatically

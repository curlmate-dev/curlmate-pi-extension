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

Core Curlmate management tool.

| Parameter | Type | Description |
|-----------|------|-------------|
| action | string | Action to perform: `skill`, `jwt`, `connections`, `token`, `auth-url` |
| connection | string (optional) | Connection id (from the `connections` action). For `token` and `auth-url`, it is combined with `service` as `<id>:<service>` for the `x-connection` header. |
| service | string (optional) | Service name (e.g., `gmail`, `google-calendar`, `slack`). Required for `token` and `auth-url` so the extension can form `<id>:<service>` for the `x-connection` header. |

**Token action behavior**

- `action="token"` obtains a fresh access token via Curlmate.
- For security, the **full token is not printed** in the tool's text content.
- The raw token is returned only in `details.accessToken` for programmatic use.
- If you explicitly need to see the token, use the `curlmate-reveal-token` tool.

### curlmate-userinfo

Fetch the authenticated user information for a Curlmate connection. Agents should always use this tool when they need the authenticated user for a connection, instead of manually calling external userinfo endpoints with raw tokens.

| Parameter | Type | Description |
|-----------|------|-------------|
| connection | string | Connection id from the `connections` action. |
| service | string | Service name (e.g., `gmail`, `google-drive`, `google-calendar`). Used to look up a default userinfo endpoint for known services and to form `<id>:<service>` for the `x-connection` header. |
| userInfoUrl | string (optional) | Override for the userinfo URL. If omitted, a sensible default is used for known services (e.g., Google OAuth userinfo). |

### curlmate-proxy-api

Proxy arbitrary HTTP API calls using an access token managed by Curlmate. The model (or calling code) should supply the full API URL (including any query parameters) discovered from user input. This tool will obtain an access token via Curlmate, call the API with a `Bearer` token, and return the response body. The `Bearer` token is **never** exposed in tool content or details.

| Parameter | Type | Description |
|-----------|------|-------------|
| connection | string | Connection id from the `connections` action whose OAuth token should be used. |
| service | string | Service name (e.g., `gmail`, `google-drive`, `google-calendar`, `slack`). Used to obtain an access token via Curlmate for this proxied API call. |
| url | string | Full API URL to call via Curlmate, including any query parameters. |
| method | string (optional) | HTTP method to use. Defaults to `GET`. Supported: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`. |
| body | string (optional) | Optional request body for non-`GET` requests (typically JSON-encoded). |
| headers | object (optional) | Additional HTTP headers to send to the target API. The `Authorization` header is managed by Curlmate and will be ignored if provided here. |

### curlmate-reveal-token

Explicitly reveal the raw OAuth access token for a Curlmate connection/service. Use this **only** when you really need to see the token; otherwise, prefer `curlmate(action="token", ...)`, which hides secrets from visible content.

| Parameter | Type | Description |
|-----------|------|-------------|
| connection | string | Connection id from the `connections` action. |
| service | string | Service name (e.g., `gmail`, `github`, `google-drive`, `google-calendar`). Used to form `<id>:<service>` for the `x-connection` header. |

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

import { type AgentToolUpdateCallback, type ExtensionAPI, type ExtensionContext } from "@mariozechner/pi-coding-agent";
import { StringEnum } from "@mariozechner/pi-ai";
import { Type, type Static } from "@sinclair/typebox";

const CURLMATE_BASE_URL = "https://api.curlmate.dev";

const CurlmateConnectionParams = Type.Object({
	action: StringEnum(["skill", "jwt", "connections", "token", "auth-url"] as const),
	connection: Type.Optional(
		Type.String({
			description:
				"Connection identifier used with the token/auth-url actions. For the token action, use the connection id from 'connections' (without the service) and provide the service separately; the extension will send '<id>:<service>' in the x-connection header.",
		}),
	),
	service: Type.Optional(
		Type.String({
			description:
				"Service name (e.g., gmail, google-calendar, slack). Required for 'token' and 'auth-url' actions so the extension can form the '<id>:<service>' x-connection header.",
		}),
	),
});

const CurlmateUserInfoParams = Type.Object({
	connection: Type.String({
		description:
			"Connection identifier (from the 'connections' list) for which you want to fetch the authenticated user info.",
	}),
	service: Type.String({
		description:
			"Service name (e.g., gmail, google-drive, google-calendar). Used to look up the correct userInfo endpoint and to form the '<id>:<service>' x-connection header.",
	}),
	userInfoUrl: Type.Optional(
		Type.String({
			description:
				"Override for the userInfo URL. If not provided, the tool will use a sensible default for known services (e.g., Google APIs).",
		}),
	),
});

const CurlmateRevealTokenParams = Type.Object({
	connection: Type.String({
		description:
			"Connection identifier (from the 'connections' list) whose raw access token you want to reveal.",
	}),
	service: Type.String({
		description:
			"Service name (e.g., gmail, github, google-drive, google-calendar). Used to form the '<id>:<service>' x-connection header.",
	}),
});

type CurlmateAction = "skill" | "jwt" | "connections" | "token" | "auth-url";

interface Connection {
	id: string;
	service: string;
}

interface ConnectionsResponse {
	connections: Connection[];
}

interface TokenResponse {
	accessToken: string;
}

interface SkillResponse {
	[key: string]: unknown;
}

interface AuthUrlResponse {
	url: string;
}

async function fetchCurlmate<T>(
	endpoint: string,
	jwt: string | undefined,
	options: {
		method?: string;
		headers?: Record<string, string>;
		body?: string;
	} = {},
): Promise<T> {
	const headers: Record<string, string> = {
		...options.headers,
	};

	if (jwt) {
		headers["Authorization"] = `Bearer ${jwt}`;
	}

	const response = await fetch(`${CURLMATE_BASE_URL}${endpoint}`, {
		method: options.method ?? "GET",
		headers,
		body: options.body,
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`Curlmate API error: ${response.status} ${response.statusText} - ${errorText}`);
	}

	return response.json() as Promise<T>;
}

function getApiKey(): string | undefined {
	return process.env.CURLMATE_API_KEY;
}

let inMemoryJwt: string | undefined;

function getJwt(_ctx: ExtensionContext | undefined): string | undefined {
	// For now we just keep the JWT in memory for the lifetime of this extension
	// runtime. If you want persistence across reloads, store it in a custom
	// session entry via `pi.appendEntry` and reconstruct state on session_start.
	return inMemoryJwt;
}

function setJwt(_ctx: ExtensionContext | undefined, jwt: string): void {
	// Same as above – store only in memory for this extension runtime.
	inMemoryJwt = jwt;
}

async function ensureJwt(
	ctx: ExtensionContext | undefined,
	apiKey: string | undefined,
): Promise<{ jwt: string } | { errorResponse: { content: Array<{ type: "text"; text: string }>; details: Record<string, unknown> } }>
{
	// Ensure we have a JWT: use cached value if present, otherwise obtain one via Curlmate using the API key.
	if (!apiKey) {
		return {
			errorResponse: {
				content: [
					{
						type: "text",
						text: "Error: CURLMATE_API_KEY environment variable not set. Please set CURLMATE_API_KEY in your environment and try again.",
					},
				],
				details: { action: "jwt", error: "Missing API key" },
			},
		};
	}

	// Always fetch a fresh JWT from Curlmate for each call to avoid
	// any issues with stale or expired tokens.
	const response = await fetch(`${CURLMATE_BASE_URL}/jwt`, {
		method: "GET",
		headers: {
			"Authorization": `Bearer ${apiKey}`,
		},
	});

	if (!response.ok) {
		const errorText = await response.text();
		return {
			errorResponse: {
				content: [
					{
						type: "text",
						text: `Error getting JWT from Curlmate: ${response.status} ${errorText}`,
					},
				],
				details: { action: "jwt", error: errorText },
			},
		};
	}

	const data = await response.json() as { jwt: string };
	setJwt(ctx, data.jwt);
	return { jwt: data.jwt };
}

export default function curlmateExtension(pi: ExtensionAPI) {
	// Core Curlmate management tool
	pi.registerTool({
		name: "curlmate",
		label: "Curlmate",
		description:
			"Manage OAuth tokens via Curlmate. Actions: " +
			"- skill: Get available OAuth services " +
			"- jwt: Exchange API key for JWT (stores in session) " +
			"- connections: List connected OAuth accounts " +
			"- token: Get fresh access token for a connection " +
			"- auth-url: Generate OAuth auth URL for a service " +
			"Requires CURLMATE_API_KEY environment variable.",
		parameters: CurlmateConnectionParams,

		async execute(
			_toolCallId: string,
			params: Static<typeof CurlmateConnectionParams>,
			_signal: AbortSignal | undefined,
			_onUpdate: AgentToolUpdateCallback<unknown> | undefined,
			ctx: ExtensionContext,
		) {
			const action: CurlmateAction = params.action;
			const apiKey = getApiKey();

			switch (action) {
				case "skill": {
					const skill = await fetchCurlmate<SkillResponse>("/skill", undefined);
					return {
						content: [{ type: "text", text: JSON.stringify(skill, null, 2) }],
						details: { action: "skill", skill },
					};
				}

				case "jwt": {
					const result = await ensureJwt(ctx, apiKey);
					if ("errorResponse" in result) {
						return result.errorResponse;
					}

					return {
						content: [{ type: "text", text: "JWT obtained and stored. Use connections to list accounts." }],
						details: { action: "jwt", jwt: result.jwt },
					};
				}

				case "connections": {
					const result = await ensureJwt(ctx, apiKey);
					if ("errorResponse" in result) {
						return result.errorResponse;
					}

					const connections = await fetchCurlmate<ConnectionsResponse>("/connections", result.jwt);

					return {
						content: [{ type: "text", text: JSON.stringify(connections, null, 2) }],
						details: { action: "connections", connections: connections.connections },
					};
				}

				case "token": {
					const result = await ensureJwt(ctx, apiKey);
					if ("errorResponse" in result) {
						return result.errorResponse;
					}

					if (!params.connection || !params.service) {
						return {
							content: [
								{
									type: "text",
									text:
										"Error: connection id and service are required for the token action. Use the id and service from the 'connections' list.",
								},
							],
							details: { action: "token", error: "Missing connection id or service" },
						};
					}

					const response = await fetch(`${CURLMATE_BASE_URL}/token`, {
						method: "GET",
						headers: {
							"Authorization": `Bearer ${result.jwt}`,
							"x-connection": `${params.connection}:${params.service}`,
						},
					});

					if (!response.ok) {
						const errorText = await response.text();
						return {
							content: [{ type: "text", text: `Error getting token: ${response.status} ${errorText}` }],
							details: { action: "token", error: errorText },
						};
					}

					const tokenData = await response.json() as TokenResponse;

					return {
						content: [
							{
								type: "text",
								text:
									"Access token acquired via Curlmate. For security, the full token is not printed here. " +
									"Use this tool's details.accessToken programmatically, or call 'curlmate-reveal-token' if you explicitly need to see the raw token.",
							},
						],
						details: { action: "token", accessToken: tokenData.accessToken },
					};
				}

				case "auth-url": {
					const result = await ensureJwt(ctx, apiKey);
					if ("errorResponse" in result) {
						return result.errorResponse;
					}

					if (!params.connection || !params.service) {
						return {
							content: [
								{
									type: "text",
									text:
										"Error: connection id and service are required for the auth-url action. Use the id and service from the 'connections' list.",
								},
							],
							details: { action: "auth-url", error: "Missing connection id or service" },
						};
					}

					const response = await fetch(`${CURLMATE_BASE_URL}/auth-url`, {
						method: "GET",
						headers: {
							"Authorization": `Bearer ${result.jwt}`,
							"x-connection": `${params.connection}:${params.service}`,
						},
					});

					if (!response.ok) {
						const errorText = await response.text();
						return {
							content: [{ type: "text", text: `Error getting auth URL: ${response.status} ${errorText}` }],
							details: { action: "auth-url", error: errorText },
						};
					}

					const authData = await response.json() as AuthUrlResponse;

					return {
						content: [{ type: "text", text: `Auth URL: ${authData.url}\n\nOpen this URL in a browser to complete OAuth authentication.` }],
						details: { action: "auth-url", url: authData.url },
					};
				}

				default:
					return {
						content: [{ type: "text", text: `Unknown action: ${action}` }],
						details: { action, error: "Unknown action" },
					};
			}
		},
	});

	// New helper tool: fetch the authenticated user info for a given connection/service.
	// Agents should always prefer this tool when they need the authenticated user for a connection,
	// instead of manually calling APIs with raw tokens.
	pi.registerTool({
		name: "curlmate-userinfo",
		label: "Curlmate User Info",
		description:
			"Fetch the authenticated user information for a Curlmate connection. " +
			"Always use this tool when you need the authenticated user for a connection, " +
			"instead of manually calling external userinfo endpoints with raw tokens. " +
			"This tool uses Curlmate to obtain an access token for the given connection/service " +
			"and then calls the appropriate userInfo endpoint (e.g., Google OAuth userinfo API).",
		parameters: CurlmateUserInfoParams,

		async execute(
			_toolCallId: string,
			params: Static<typeof CurlmateUserInfoParams>,
			_signal: AbortSignal | undefined,
			_onUpdate: AgentToolUpdateCallback<unknown> | undefined,
			ctx: ExtensionContext,
		) {
			const apiKey = getApiKey();
			const result = await ensureJwt(ctx, apiKey);

			if ("errorResponse" in result) {
				return result.errorResponse;
			}

			const { connection, service } = params;
			let { userInfoUrl } = params;

			if (!connection || !service) {
				return {
					content: [
						{
							type: "text",
							text: "Error: connection and service are required to fetch user info.",
						},
					],
					details: { action: "userinfo", error: "Missing connection or service" },
				};
			}

			// First, obtain an access token for this connection via Curlmate
			const tokenResponse = await fetch(`${CURLMATE_BASE_URL}/token`, {
				method: "GET",
				headers: {
					"Authorization": `Bearer ${result.jwt}`,
					"x-connection": `${connection}:${service}`,
				},
			});

			if (!tokenResponse.ok) {
				const errorText = await tokenResponse.text();
				return {
					content: [{ type: "text", text: `Error getting token for user info: ${tokenResponse.status} ${errorText}` }],
					details: { action: "userinfo", error: errorText },
				};
			}

			const tokenData = await tokenResponse.json() as TokenResponse;
			const accessToken = tokenData.accessToken;

			// Determine the userInfo URL if one was not explicitly provided
			if (!userInfoUrl) {
				// For Google OAuth services (gmail, google-drive, google-calendar, google-docs, etc.)
				const googleServices = new Set([
					"gmail",
					"google-drive",
					"google-calendar",
					"google-docs",
				]);

				if (googleServices.has(service)) {
					userInfoUrl = "https://www.googleapis.com/oauth2/v3/userinfo";
				}
			}

			if (!userInfoUrl) {
				return {
					content: [
						{
							type: "text",
							text:
								"No default userInfoUrl configured for this service. Please provide 'userInfoUrl' explicitly when calling this tool.",
						},
					],
					details: { action: "userinfo", error: "Missing userInfoUrl" },
				};
			}

			// Call the userInfo endpoint with the obtained access token
			const userInfoResponse = await fetch(userInfoUrl, {
				method: "GET",
				headers: {
					"Authorization": `Bearer ${accessToken}`,
					"Accept": "application/json",
				},
			});

			if (!userInfoResponse.ok) {
				const errorText = await userInfoResponse.text();
				return {
					content: [{ type: "text", text: `Error fetching user info from ${userInfoUrl}: ${userInfoResponse.status} ${errorText}` }],
					details: { action: "userinfo", error: errorText },
				};
			}

			const userInfo = await userInfoResponse.json();

			return {
				content: [{ type: "text", text: JSON.stringify(userInfo, null, 2) }],
				details: { action: "userinfo", service, connection, userInfo },
			};
		},
	});

	// Helper tool: explicitly reveal the raw access token for a connection/service.
	// Use this only when you truly need to see the token; otherwise prefer the
	// 'token' action of the 'curlmate' tool, which avoids printing secrets in content.
	pi.registerTool({
		name: "curlmate-reveal-token",
		label: "Curlmate Reveal Token",
		description:
			"Reveal the raw OAuth access token for a Curlmate connection/service. " +
			"Use this only when you explicitly need to see the token; otherwise prefer " +
			"the 'token' action of the 'curlmate' tool, which hides tokens from visible content.",
		parameters: CurlmateRevealTokenParams,

		async execute(
			_toolCallId: string,
			params: Static<typeof CurlmateRevealTokenParams>,
			_signal: AbortSignal | undefined,
			_onUpdate: AgentToolUpdateCallback<unknown> | undefined,
			ctx: ExtensionContext,
		) {
			const apiKey = getApiKey();
			const result = await ensureJwt(ctx, apiKey);

			if ("errorResponse" in result) {
				return result.errorResponse;
			}

			const { connection, service } = params;

			if (!connection || !service) {
				return {
					content: [
						{
							type: "text",
							text:
								"Error: connection and service are required to reveal an access token.",
						},
					],
					details: { action: "reveal-token", error: "Missing connection or service" },
				};
			}

			const tokenResponse = await fetch(`${CURLMATE_BASE_URL}/token`, {
				method: "GET",
				headers: {
					"Authorization": `Bearer ${result.jwt}`,
					"x-connection": `${connection}:${service}`,
				},
			});

			if (!tokenResponse.ok) {
				const errorText = await tokenResponse.text();
				return {
					content: [{ type: "text", text: `Error getting token: ${tokenResponse.status} ${errorText}` }],
					details: { action: "reveal-token", error: errorText },
				};
			}

			const tokenData = await tokenResponse.json() as TokenResponse;

			return {
				content: [{ type: "text", text: `Access token: ${tokenData.accessToken}` }],
				details: { action: "reveal-token", accessToken: tokenData.accessToken, connection, service },
			};
		},
	});
}

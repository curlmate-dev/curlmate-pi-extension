import { type AgentToolUpdateCallback, type ExtensionAPI, type ExtensionContext } from "@mariozechner/pi-coding-agent";
import { StringEnum } from "@mariozechner/pi-ai";
import { Type, type Static } from "@sinclair/typebox";

const CURLMATE_BASE_URL = "https://api.curlmate.dev";

const CurlmateConnectionParams = Type.Object({
	action: StringEnum(["skill", "jwt", "connections", "token", "auth-url"] as const),
	connection: Type.Optional(Type.String({ description: "Connection id (for token/auth-url actions)" })),
	service: Type.Optional(Type.String({ description: "Service name (e.g., google-calendar, slack)" })),
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

					if (!params.connection) {
						return {
							content: [{ type: "text", text: "Error: connection id required" }],
							details: { action: "token", error: "Missing connection id" },
						};
					}

					const response = await fetch(`${CURLMATE_BASE_URL}/token`, {
						method: "GET",
						headers: {
							"Authorization": `Bearer ${result.jwt}`,
							"x-connection": `${params.connection}:${params.service}`, 						},
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
						content: [{ type: "text", text: `Access token: ${tokenData.accessToken}` }],
						details: { action: "token", accessToken: tokenData.accessToken },
					};
				}

				case "auth-url": {
					const result = await ensureJwt(ctx, apiKey);
					if ("errorResponse" in result) {
						return result.errorResponse;
					}

					if (!params.service) {
						return {
							content: [{ type: "text", text: "Error: service name required (e.g., google-calendar, slack)" }],
							details: { action: "auth-url", error: "Missing service" },
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
}

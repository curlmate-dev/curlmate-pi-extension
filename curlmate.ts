import { type ExtensionAPI, type ExtensionContext } from "@mariozechner/pi-coding-agent";
import { StringEnum } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";

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

function getJwt(ctx: ExtensionContext): string | undefined {
	return ctx.sessionStorage.get("curlmate_jwt");
}

function setJwt(ctx: ExtensionContext, jwt: string): void {
	ctx.sessionStorage.set("curlmate_jwt", jwt);
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

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
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
					if (!apiKey) {
						return {
							content: [{ type: "text", text: "Error: CURLMATE_API_KEY environment variable not set" }],
							details: { action: "jwt", error: "Missing API key" },
						};
					}

					const response = await fetch(`${CURLMATE_BASE_URL}/jwt`, {
						method: "GET",
						headers: {
							"Authorization": `Bearer ${apiKey}`,
						},
					});

					if (!response.ok) {
						const errorText = await response.text();
						return {
							content: [{ type: "text", text: `Error getting JWT: ${response.status} ${errorText}` }],
							details: { action: "jwt", error: errorText },
						};
					}

					const data = await response.json() as { jwt: string };
					setJwt(ctx, data.jwt);

					return {
						content: [{ type: "text", text: `JWT obtained and stored. Use connections to list accounts.` }],
						details: { action: "jwt", jwt: data.jwt },
					};
				}

				case "connections": {
					const jwt = getJwt(ctx);
					if (!jwt) {
						return {
							content: [{ type: "text", text: "Error: No JWT. Run 'jwt' action first." }],
							details: { action: "connections", error: "Missing JWT" },
						};
					}

					const connections = await fetchCurlmate<ConnectionsResponse>("/connections", jwt);

					return {
						content: [{ type: "text", text: JSON.stringify(connections, null, 2) }],
						details: { action: "connections", connections: connections.connections },
					};
				}

				case "token": {
					const jwt = getJwt(ctx);
					if (!jwt) {
						return {
							content: [{ type: "text", text: "Error: No JWT. Run 'jwt' action first." }],
							details: { action: "token", error: "Missing JWT" },
						};
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
							"Authorization": `Bearer ${jwt}`,
							"x-connection": params.connection,
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
						content: [{ type: "text", text: `Access token: ${tokenData.accessToken}` }],
						details: { action: "token", accessToken: tokenData.accessToken },
					};
				}

				case "auth-url": {
					const jwt = getJwt(ctx);
					if (!jwt) {
						return {
							content: [{ type: "text", text: "Error: No JWT. Run 'jwt' action first." }],
							details: { action: "auth-url", error: "Missing JWT" },
						};
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
							"Authorization": `Bearer ${jwt}`,
							"x-connection": params.service,
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

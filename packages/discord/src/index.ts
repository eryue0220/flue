import { defineTool, type ToolDefinition } from '@flue/runtime';

export interface DiscordChannelOptions {
	publicKey: string;
	applicationId: string;
	botToken: string;
}

export type DiscordDestinationRef =
	| { type: 'guild'; guildId: string; channelId: string; channelKind: 'channel' | 'thread' }
	| { type: 'dm'; channelId: string };

export interface DiscordCommandData {
	name: string;
	options: readonly unknown[];
}

export interface DiscordComponentData {
	customId: string;
	componentType: number;
	values?: readonly string[];
}

export interface DiscordModalData {
	customId: string;
	components: readonly unknown[];
}

export interface DiscordInteractionEnvelope<TData> {
	id: string;
	applicationId: string;
	token: string;
	destination: DiscordDestinationRef;
	data: TData;
	raw: unknown;
}

export interface DiscordComponent {
	type: number;
	customId?: string;
	label?: string;
	style?: number;
	value?: string;
	components?: readonly DiscordComponent[];
}

export interface DiscordMessage {
	content: string;
	components?: readonly DiscordComponent[];
	allowedMentions?: {
		parse?: Array<'users' | 'roles' | 'everyone'>;
		users?: string[];
		roles?: string[];
	};
}

export type DiscordCommandResponse =
	| { type: 'message'; message: DiscordMessage; ephemeral?: boolean }
	| { type: 'modal'; customId: string; title: string; components: readonly DiscordComponent[] };
export type DiscordComponentResponse =
	| { type: 'message'; message: DiscordMessage; ephemeral?: boolean }
	| { type: 'update_message'; message: DiscordMessage }
	| { type: 'modal'; customId: string; title: string; components: readonly DiscordComponent[] };
export type DiscordModalResponse =
	| { type: 'message'; message: DiscordMessage; ephemeral?: boolean }
	| { type: 'update_message'; message: DiscordMessage };

export type DiscordInteractionHandler<TInteraction, TResponse> = (
	interaction: TInteraction,
) => TResponse | Promise<TResponse>;
export type DiscordRouteHandler = (request: Request) => Promise<Response>;

export interface DiscordInteractionRouteOptions {
	bodyLimit?: number;
}

export interface DiscordClient {
	postMessage(ref: DiscordDestinationRef, message: DiscordMessage, signal?: AbortSignal): Promise<void>;
}

export interface DiscordMessageToolOptions {
	allowMentions?: Array<'users' | 'roles' | 'everyone'>;
}

export class InvalidDiscordConversationKeyError extends Error {
	constructor() {
		super('Invalid Discord conversation key.');
		this.name = 'InvalidDiscordConversationKeyError';
	}
}

export interface DiscordChannel {
	readonly routes: {
		interactions(options?: DiscordInteractionRouteOptions): DiscordRouteHandler;
	};
	readonly client: DiscordClient;
	readonly tools: {
		postMessage(ref: DiscordDestinationRef, options?: DiscordMessageToolOptions): ToolDefinition;
	};
	onCommand(
		name: string,
		handler: DiscordInteractionHandler<DiscordInteractionEnvelope<DiscordCommandData>, DiscordCommandResponse>,
	): () => void;
	onComponent(
		customId: string,
		handler: DiscordInteractionHandler<DiscordInteractionEnvelope<DiscordComponentData>, DiscordComponentResponse>,
	): () => void;
	onModal(
		customId: string,
		handler: DiscordInteractionHandler<DiscordInteractionEnvelope<DiscordModalData>, DiscordModalResponse>,
	): () => void;
	conversationKey(ref: DiscordDestinationRef): string;
	parseConversationKey(id: string): DiscordDestinationRef;
}

export function createDiscordChannel(options: DiscordChannelOptions): DiscordChannel {
	validateOptions(options);
	const handlers = new Map<string, unknown>();
	const client: DiscordClient = {
		async postMessage() {
			throw new Error('@flue/discord client is not implemented yet.');
		},
	};
	const register = <THandler>(kind: string, key: string, handler: THandler) => {
		const routeKey = `${kind}:${key}`;
		if (!key || handlers.has(routeKey)) throw new Error(`Discord interaction handler already registered: ${routeKey}`);
		handlers.set(routeKey, handler);
		let active = true;
		return () => {
			if (!active) return false;
			active = false;
			if (handlers.get(routeKey) !== handler) return false;
			return handlers.delete(routeKey);
		};
	};

	return {
		routes: {
			interactions: (_routeOptions) => async () =>
				new Response('@flue/discord interactions route is not implemented yet.', { status: 501 }),
		},
		client,
		tools: {
			postMessage: (ref, toolOptions = {}) =>
				defineTool({
					name: 'discord_post_message',
					description: 'Post a message to the bound Discord destination.',
					parameters: {
						type: 'object',
						properties: { text: { type: 'string' } },
						required: ['text'],
						additionalProperties: false,
					},
					execute: async ({ text }, signal) => {
						await client.postMessage(
							ref,
							{ content: String(text), allowedMentions: { parse: toolOptions.allowMentions ?? [] } },
							signal,
						);
						return 'Message posted.';
					},
				}),
		},
		onCommand: (name, handler) => register('command', name, handler),
		onComponent: (customId, handler) => register('component', customId, handler),
		onModal: (customId, handler) => register('modal', customId, handler),
		conversationKey(ref) {
			assertDestinationRef(ref);
			if (ref.type === 'guild') {
				return `discord:v1:guild:${encodeURIComponent(ref.guildId)}:${ref.channelKind}:${encodeURIComponent(ref.channelId)}`;
			}
			return `discord:v1:dm:${encodeURIComponent(ref.channelId)}`;
		},
		parseConversationKey(id) {
			try {
				const guild = /^discord:v1:guild:([^:]+):(channel|thread):([^:]+)$/.exec(id);
				const guildId = guild?.[1];
				const channelKind = guild?.[2];
				const channelId = guild?.[3];
				if (guildId && (channelKind === 'channel' || channelKind === 'thread') && channelId) {
					const ref: DiscordDestinationRef = {
						type: 'guild',
						guildId: decodeURIComponent(guildId),
						channelId: decodeURIComponent(channelId),
						channelKind,
					};
					assertDestinationRef(ref);
					if (this.conversationKey(ref) !== id) throw new InvalidDiscordConversationKeyError();
					return ref;
				}
				const dmChannelId = /^discord:v1:dm:([^:]+)$/.exec(id)?.[1];
				if (!dmChannelId) throw new InvalidDiscordConversationKeyError();
				const ref: DiscordDestinationRef = { type: 'dm', channelId: decodeURIComponent(dmChannelId) };
				assertDestinationRef(ref);
				if (this.conversationKey(ref) !== id) throw new InvalidDiscordConversationKeyError();
				return ref;
			} catch (error) {
				if (error instanceof InvalidDiscordConversationKeyError) throw error;
				throw new InvalidDiscordConversationKeyError();
			}
		},
	};
}

function validateOptions(options: DiscordChannelOptions): void {
	if (!options.publicKey || !options.applicationId || !options.botToken) {
		throw new Error('@flue/discord requires publicKey, applicationId, and botToken.');
	}
}

function assertDestinationRef(ref: DiscordDestinationRef): void {
	if (!ref.channelId || (ref.type === 'guild' && !ref.guildId)) throw new InvalidDiscordConversationKeyError();
}

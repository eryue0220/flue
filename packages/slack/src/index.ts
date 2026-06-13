import { defineTool, type ToolDefinition } from '@flue/runtime';

export interface SlackChannelOptions {
	signingSecret: string;
	botToken: string;
	appId: string;
	teamId: string;
}

export interface SlackThreadRef {
	teamId: string;
	channelId: string;
	threadTs: string;
}

export interface SlackAppMentionPayload {
	channelId: string;
	messageTs: string;
	threadTs?: string;
	text: string;
	userId: string;
}

export interface SlackMessagePayload {
	channelId: string;
	messageTs: string;
	threadTs?: string;
	text: string;
	userId?: string;
}

export interface SlackEventEnvelope<TPayload> {
	type: string;
	eventId: string;
	appId: string;
	teamId: string;
	retry?: { number: number; reason?: string };
	payload: TPayload;
	raw: unknown;
}

export interface SlackActionEnvelope {
	type: 'action';
	teamId: string;
	userId: string;
	actionId: string;
	payload: unknown;
	raw: unknown;
}

export interface SlackViewSubmissionEnvelope {
	type: 'view_submission';
	teamId: string;
	userId: string;
	callbackId: string;
	values: unknown;
	raw: unknown;
}

export interface SlackMessage {
	text: string;
	blocks?: readonly unknown[];
	responseType?: 'ephemeral' | 'in_channel';
}

export type SlackActionResponse = { type: 'ack' } | { type: 'message'; message: SlackMessage };
export type SlackViewResponse = { type: 'ack' } | { type: 'validation_errors'; errors: Record<string, string> };

export interface SlackEvents {
	app_mention: SlackEventEnvelope<SlackAppMentionPayload>;
	message: SlackEventEnvelope<SlackMessagePayload>;
}

export type SlackNotificationHandler<TEvent> = (event: TEvent) => void | Promise<void>;
export type SlackInteractionHandler<TEvent, TResponse> = (event: TEvent) => TResponse | Promise<TResponse>;
export type SlackRouteHandler = (request: Request) => Promise<Response>;

export interface SlackRouteOptions {
	bodyLimit?: number;
}

export interface SlackClient {
	postMessage(ref: SlackThreadRef, message: SlackMessage, signal?: AbortSignal): Promise<void>;
	addReaction(ref: SlackThreadRef, name: string, signal?: AbortSignal): Promise<void>;
}

export class InvalidSlackConversationKeyError extends Error {
	constructor() {
		super('Invalid Slack conversation key.');
		this.name = 'InvalidSlackConversationKeyError';
	}
}

export interface SlackChannel {
	readonly routes: {
		events(options?: SlackRouteOptions): SlackRouteHandler;
		interactions(options?: SlackRouteOptions): SlackRouteHandler;
	};
	readonly client: SlackClient;
	readonly tools: {
		replyInThread(ref: SlackThreadRef): ToolDefinition;
		addReaction(ref: SlackThreadRef): ToolDefinition;
	};
	on<TKey extends keyof SlackEvents>(
		type: TKey,
		handler: SlackNotificationHandler<SlackEvents[TKey]>,
	): () => void;
	onAction(actionId: string, handler: SlackInteractionHandler<SlackActionEnvelope, SlackActionResponse>): () => void;
	onView(
		callbackId: string,
		handler: SlackInteractionHandler<SlackViewSubmissionEnvelope, SlackViewResponse>,
	): () => void;
	conversationKey(ref: SlackThreadRef): string;
	parseConversationKey(id: string): SlackThreadRef;
}

export function createSlackChannel(options: SlackChannelOptions): SlackChannel {
	validateOptions(options);
	const eventHandlers = new Map<keyof SlackEvents, Map<symbol, SlackNotificationHandler<SlackEvents[keyof SlackEvents]>>>();
	const actionHandlers = new Map<string, SlackInteractionHandler<SlackActionEnvelope, SlackActionResponse>>();
	const viewHandlers = new Map<string, SlackInteractionHandler<SlackViewSubmissionEnvelope, SlackViewResponse>>();
	const client: SlackClient = {
		async postMessage() {
			throw new Error('@flue/slack client is not implemented yet.');
		},
		async addReaction() {
			throw new Error('@flue/slack client is not implemented yet.');
		},
	};

	return {
		routes: {
			events: (_routeOptions) => async () =>
				new Response('@flue/slack events route is not implemented yet.', { status: 501 }),
			interactions: (_routeOptions) => async () =>
				new Response('@flue/slack interactions route is not implemented yet.', { status: 501 }),
		},
		client,
		tools: {
			replyInThread: (ref) =>
				defineTool({
					name: 'slack_reply_in_thread',
					description: 'Post a reply to the bound Slack thread.',
					parameters: {
						type: 'object',
						properties: { text: { type: 'string' } },
						required: ['text'],
						additionalProperties: false,
					},
					execute: async ({ text }, signal) => {
						await client.postMessage(ref, { text: String(text) }, signal);
						return 'Reply posted.';
					},
				}),
			addReaction: (ref) =>
				defineTool({
					name: 'slack_add_reaction',
					description: 'Add a reaction to the bound Slack thread root.',
					parameters: {
						type: 'object',
						properties: { name: { type: 'string' } },
						required: ['name'],
						additionalProperties: false,
					},
					execute: async ({ name }, signal) => {
						await client.addReaction(ref, String(name), signal);
						return 'Reaction added.';
					},
				}),
		},
		on(type, handler) {
			const registrations = eventHandlers.get(type) ?? new Map();
			const registration = Symbol(type);
			registrations.set(registration, handler as SlackNotificationHandler<SlackEvents[keyof SlackEvents]>);
			eventHandlers.set(type, registrations);
			return () => registrations.delete(registration);
		},
		onAction: (actionId, handler) => registerOne(actionHandlers, actionId, handler, 'action'),
		onView: (callbackId, handler) => registerOne(viewHandlers, callbackId, handler, 'view'),
		conversationKey(ref) {
			assertThreadRef(ref);
			return `slack:v1:${encodeURIComponent(ref.teamId)}:${encodeURIComponent(ref.channelId)}:${encodeURIComponent(ref.threadTs)}`;
		},
		parseConversationKey(id) {
			try {
				const match = /^slack:v1:([^:]+):([^:]+):([^:]+)$/.exec(id);
				const teamId = match?.[1];
				const channelId = match?.[2];
				const threadTs = match?.[3];
				if (!teamId || !channelId || !threadTs) throw new InvalidSlackConversationKeyError();
				const ref = {
					teamId: decodeURIComponent(teamId),
					channelId: decodeURIComponent(channelId),
					threadTs: decodeURIComponent(threadTs),
				};
				assertThreadRef(ref);
				if (this.conversationKey(ref) !== id) throw new InvalidSlackConversationKeyError();
				return ref;
			} catch (error) {
				if (error instanceof InvalidSlackConversationKeyError) throw error;
				throw new InvalidSlackConversationKeyError();
			}
		},
	};
}

function registerOne<THandler>(handlers: Map<string, THandler>, key: string, handler: THandler, type: string): () => void {
	if (!key || handlers.has(key)) throw new Error(`Slack ${type} handler already registered: ${key}`);
	handlers.set(key, handler);
	let active = true;
	return () => {
		if (!active) return false;
		active = false;
		if (handlers.get(key) !== handler) return false;
		return handlers.delete(key);
	};
}

function validateOptions(options: SlackChannelOptions): void {
	if (!options.signingSecret || !options.botToken || !options.appId || !options.teamId) {
		throw new Error('@flue/slack requires signingSecret, botToken, appId, and teamId.');
	}
}

function assertThreadRef(ref: SlackThreadRef): void {
	if (!ref.teamId || !ref.channelId || !ref.threadTs) throw new InvalidSlackConversationKeyError();
}

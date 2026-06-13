import type { Context, Env, Handler } from 'hono';
import { InvalidSlackConversationKeyError, InvalidSlackInputError } from './errors.ts';
import {
	createSlackCommandsHandler,
	createSlackEventsHandler,
	createSlackInteractionsHandler,
} from './routes.ts';

export { InvalidSlackConversationKeyError, InvalidSlackInputError } from './errors.ts';

export type JsonValue =
	| null
	| boolean
	| number
	| string
	| JsonValue[]
	| { [key: string]: JsonValue };

export interface ChannelRoute<E extends Env = Env> {
	readonly method: string;
	readonly path: string;
	readonly handler: Handler<E>;
}

/** Ingress configuration for one fixed Slack application and workspace. */
export interface SlackChannelOptions<E extends Env = Env> {
	/** Secret used to verify exact Slack request bytes. */
	signingSecret: string;
	/** Expected application id. Normalized payloads always use this value. */
	appId: string;
	/** Expected workspace id. Org-wide installations are not supported in v1. */
	teamId: string;
	/** Maximum request-body size in bytes. Defaults to 1 MiB. */
	bodyLimit?: number;
	/** Handler deadline in milliseconds. Defaults to and may not exceed 2500. */
	handlerTimeoutMs?: number;
	/** Optional Events API callback. Omit it to omit `/events`. */
	events?(input: SlackEventsHandlerInput<E>): SlackHandlerResult;
	/** Optional interactivity callback. Omit it to omit `/interactions`. */
	interactions?(input: SlackInteractionsHandlerInput<E>): SlackHandlerResult;
	/** Optional slash-command callback. Omit it to omit `/commands`. */
	commands?(input: SlackCommandsHandlerInput<E>): SlackHandlerResult;
}

/** Canonical Slack thread destination within the configured workspace. */
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
	userId: string;
}

export interface SlackEventEnvelope<TType extends string, TPayload> {
	type: TType;
	eventId: string;
	appId: string;
	teamId: string;
	retry?: { number: number; reason?: string };
	payload: TPayload;
	/** Parsed provider payload. Treat this as untrusted provider data. */
	raw: unknown;
}

export interface SlackUnknownEvent {
	type: 'unknown';
	eventType: string;
	/** Slack event id when the unsupported envelope supplies one. */
	eventId?: string;
	appId: string;
	teamId: string;
	retry?: { number: number; reason?: string };
	raw: unknown;
}

/**
 * Short-lived Slack capabilities for immediate trusted application use.
 *
 * Never place these values in model context, dispatch input, logs, or durable
 * session data.
 */
export interface SlackInteractionCapabilities {
	triggerId?: string;
	responseUrl?: string;
	responseUrls?: readonly {
		blockId: string;
		actionId: string;
		channelId: string;
		responseUrl: string;
	}[];
}

/** Provider container that originated a block action. */
export interface SlackInteractionContainer {
	type: string;
	channelId?: string;
	messageTs?: string;
	viewId?: string;
}

/** One verified Block Kit action. Message context is present only when supplied. */
export interface SlackActionEnvelope {
	type: 'action';
	appId: string;
	teamId: string;
	enterpriseId?: string;
	userId: string;
	actionId: string;
	/** Signed action value when the provider action supplies one. */
	value?: string;
	blockId?: string;
	container: SlackInteractionContainer;
	channelId?: string;
	messageTs?: string;
	threadTs?: string;
	capabilities?: SlackInteractionCapabilities;
	/** Provider-native action object. */
	payload: unknown;
	/**
	 * Complete parsed interaction payload. It may contain a signed
	 * `response_url` capability; keep it out of dispatch input, model context,
	 * logs, and durable session data.
	 */
	raw: unknown;
}

/** One verified modal submission. */
export interface SlackViewSubmissionEnvelope {
	type: 'view_submission';
	appId: string;
	teamId: string;
	enterpriseId?: string;
	userId: string;
	viewId: string;
	callbackId: string;
	privateMetadata?: string;
	values: unknown;
	capabilities?: SlackInteractionCapabilities;
	/**
	 * Complete parsed interaction payload. It may contain a signed
	 * `response_url` capability; keep it out of dispatch input, model context,
	 * logs, and durable session data.
	 */
	raw: unknown;
}

/** One verified modal closure. */
export interface SlackViewClosedEnvelope {
	type: 'view_closed';
	appId: string;
	teamId: string;
	enterpriseId?: string;
	userId: string;
	viewId: string;
	callbackId?: string;
	privateMetadata?: string;
	isCleared: boolean;
	raw: unknown;
}

/** One verified global shortcut invocation. */
export interface SlackShortcutEnvelope {
	type: 'shortcut';
	appId: string;
	teamId: string;
	enterpriseId?: string;
	userId: string;
	callbackId: string;
	capabilities: SlackInteractionCapabilities & { triggerId: string };
	raw: unknown;
}

/** One verified message shortcut invocation. */
export interface SlackMessageShortcutEnvelope {
	type: 'message_action';
	appId: string;
	teamId: string;
	enterpriseId?: string;
	userId: string;
	callbackId: string;
	channelId: string;
	messageTs: string;
	message: unknown;
	capabilities: SlackInteractionCapabilities & { triggerId: string; responseUrl: string };
	raw: unknown;
}

/** One verified external-select suggestion request. */
export interface SlackBlockSuggestionEnvelope {
	type: 'block_suggestion';
	appId: string;
	teamId: string;
	enterpriseId?: string;
	userId: string;
	actionId: string;
	blockId: string;
	value: string;
	channelId?: string;
	viewId?: string;
	raw: unknown;
}

/** Verified but unsupported Slack interaction. */
export interface SlackUnknownInteraction {
	type: 'unknown';
	interactionType: string;
	appId: string;
	teamId: string;
	enterpriseId?: string;
	userId: string;
	capabilities?: SlackInteractionCapabilities;
	raw: unknown;
}

/** One verified slash-command invocation. */
export interface SlackSlashCommand {
	type: 'slash_command';
	appId: string;
	teamId: string;
	enterpriseId?: string;
	channelId: string;
	channelName?: string;
	userId: string;
	userName?: string;
	command: string;
	text: string;
	capabilities: SlackInteractionCapabilities & {
		triggerId: string;
		responseUrl: string;
	};
	raw: unknown;
}

export interface SlackEvents {
	app_mention: SlackEventEnvelope<'app_mention', SlackAppMentionPayload>;
	message: SlackEventEnvelope<'message', SlackMessagePayload>;
}

export type SlackEvent = SlackEvents[keyof SlackEvents] | SlackUnknownEvent;
export type SlackInteraction =
	| SlackActionEnvelope
	| SlackViewSubmissionEnvelope
	| SlackViewClosedEnvelope
	| SlackShortcutEnvelope
	| SlackMessageShortcutEnvelope
	| SlackBlockSuggestionEnvelope
	| SlackUnknownInteraction;

/** Provider-native Slack view validation response. */
export interface SlackViewValidationResponse {
	response_action: 'errors';
	errors: Record<string, string>;
}

type SlackHandlerValue = undefined | JsonValue | SlackViewValidationResponse | Response;

export type SlackHandlerResult = SlackHandlerValue | Promise<SlackHandlerValue>;

export interface SlackEventsHandlerInput<E extends Env = Env> {
	c: Context<E>;
	event: SlackEvent;
}

export interface SlackInteractionsHandlerInput<E extends Env = Env> {
	c: Context<E>;
	interaction: SlackInteraction;
}

export interface SlackCommandsHandlerInput<E extends Env = Env> {
	c: Context<E>;
	command: SlackSlashCommand;
}

/** Verified ingress and canonical identity helpers. */
export interface SlackChannel<E extends Env = Env> {
	readonly routes: readonly ChannelRoute<E>[];
	/** Serializes a canonical namespaced identifier. It is not an authorization capability. */
	conversationKey(ref: SlackThreadRef): string;
	/** Parses only canonical keys produced by `conversationKey()`. */
	parseConversationKey(id: string): SlackThreadRef;
}

/**
 * Creates a fixed-workspace Slack channel.
 *
 * Signed request timestamps must be within five minutes of the server clock.
 * Successful acknowledgement waits for the configured handler, and the
 * channel does not deduplicate Events API retries.
 */
export function createSlackChannel<E extends Env = Env>(
	options: SlackChannelOptions<E>,
): SlackChannel<E> {
	validateOptions(options);
	const signingSecret = options.signingSecret;
	const appId = options.appId;
	const teamId = options.teamId;
	const routes: ChannelRoute<E>[] = [];

	if (options.events) {
		routes.push({
			method: 'POST',
			path: '/events',
			handler: createSlackEventsHandler({
				signingSecret,
				appId,
				teamId,
				bodyLimit: options.bodyLimit,
				handlerTimeoutMs: options.handlerTimeoutMs,
				events: options.events,
			}),
		});
	}
	if (options.interactions) {
		routes.push({
			method: 'POST',
			path: '/interactions',
			handler: createSlackInteractionsHandler({
				signingSecret,
				appId,
				teamId,
				bodyLimit: options.bodyLimit,
				handlerTimeoutMs: options.handlerTimeoutMs,
				interactions: options.interactions,
			}),
		});
	}
	if (options.commands) {
		routes.push({
			method: 'POST',
			path: '/commands',
			handler: createSlackCommandsHandler({
				signingSecret,
				appId,
				teamId,
				bodyLimit: options.bodyLimit,
				handlerTimeoutMs: options.handlerTimeoutMs,
				commands: options.commands,
			}),
		});
	}
	if (routes.length === 0) {
		throw new TypeError('createSlackChannel() requires an events, interactions, or commands handler.');
	}

	const channel: SlackChannel<E> = {
		routes,
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
				if (channel.conversationKey(ref) !== id) throw new InvalidSlackConversationKeyError();
				return ref;
			} catch (error) {
				if (error instanceof InvalidSlackConversationKeyError) throw error;
				throw new InvalidSlackConversationKeyError();
			}
		},
	};

	return channel;
}

function validateOptions<E extends Env>(options: SlackChannelOptions<E>): void {
	if (!options || typeof options !== 'object') {
		throw new TypeError('createSlackChannel() requires an options object.');
	}
	assertOption(options.signingSecret, 'signingSecret');
	assertOption(options.appId, 'appId');
	assertOption(options.teamId, 'teamId');
	if (options.events !== undefined && typeof options.events !== 'function') {
		throw new TypeError('Slack events handler must be a function.');
	}
	if (options.interactions !== undefined && typeof options.interactions !== 'function') {
		throw new TypeError('Slack interactions handler must be a function.');
	}
	if (options.commands !== undefined && typeof options.commands !== 'function') {
		throw new TypeError('Slack commands handler must be a function.');
	}
}

function assertOption(value: unknown, field: string): asserts value is string {
	if (typeof value !== 'string' || value.length === 0) {
		throw new TypeError(`createSlackChannel() requires a non-empty ${field}.`);
	}
}

function assertThreadRef(ref: SlackThreadRef): void {
	if (!ref || typeof ref !== 'object') throw new InvalidSlackInputError('ref');
	assertIdentifier(ref.teamId, 'teamId');
	assertIdentifier(ref.channelId, 'channelId');
	assertIdentifier(ref.threadTs, 'threadTs');
}

function assertIdentifier(value: unknown, field: string): asserts value is string {
	if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
		throw new InvalidSlackInputError(field);
	}
}

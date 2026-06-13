import type { Context, Env, Handler } from 'hono';
import type {
	JsonValue,
	SlackActionEnvelope,
	SlackBlockSuggestionEnvelope,
	SlackEvent,
	SlackEvents,
	SlackHandlerResult,
	SlackInteraction,
	SlackInteractionCapabilities,
	SlackMessageShortcutEnvelope,
	SlackShortcutEnvelope,
	SlackSlashCommand,
	SlackUnknownEvent,
	SlackUnknownInteraction,
	SlackViewClosedEnvelope,
	SlackViewSubmissionEnvelope,
} from './index.ts';

const DEFAULT_BODY_LIMIT = 1024 * 1024;
const DEFAULT_HANDLER_TIMEOUT_MS = 2_500;
const MAX_SIGNATURE_AGE_SECONDS = 5 * 60;
const encoder = new TextEncoder();

interface SharedRouteOptions {
	signingSecret: string;
	appId: string;
	teamId: string;
	bodyLimit?: number;
	handlerTimeoutMs?: number;
}

interface SlackEventsHandlerOptions<E extends Env> extends SharedRouteOptions {
	events(input: { c: Context<E>; event: SlackEvent }): SlackHandlerResult;
}

interface SlackInteractionsHandlerOptions<E extends Env> extends SharedRouteOptions {
	interactions(input: { c: Context<E>; interaction: SlackInteraction }): SlackHandlerResult;
}

interface SlackCommandsHandlerOptions<E extends Env> extends SharedRouteOptions {
	commands(input: { c: Context<E>; command: SlackSlashCommand }): SlackHandlerResult;
}

export function createSlackEventsHandler<E extends Env>(
	options: SlackEventsHandlerOptions<E>,
): Handler<E> {
	const route = prepareRoute(options);

	return async (c) => {
		const request = c.req.raw;
		const verified = await route.verify(request, 'application/json');
		if (verified instanceof Response) return verified;
		const raw = parseJson(verified.body);
		if (!isRecord(raw)) return response(400);

		const envelopeType = readString(raw, 'type');
		if (envelopeType === 'url_verification') {
			const challenge = readString(raw, 'challenge');
			if (challenge === undefined) return response(400);
			return Response.json({ challenge }, { status: 200 });
		}
		if (envelopeType !== 'event_callback') {
			const appId = readString(raw, 'api_app_id');
			const teamId = readString(raw, 'team_id');
			if (!appId || !teamId) return response(400);
			if (appId !== options.appId || teamId !== options.teamId) return response(403);
			if (isEnterpriseInstall(raw)) return response(403);
			const eventId = readOptionalString(raw, 'event_id');
			return invokeEvent(
				options.events,
				c,
				{
					type: 'unknown',
					eventType: envelopeType ?? 'unknown',
					...(eventId === undefined ? {} : { eventId }),
					appId,
					teamId,
					retry: readRetry(request.headers),
					raw,
				},
				route.handlerTimeoutMs,
			);
		}

		const appId = readString(raw, 'api_app_id');
		const teamId = readString(raw, 'team_id');
		const eventId = readString(raw, 'event_id');
		const event = readRecord(raw, 'event');
		if (!appId || !teamId || !eventId || !event) return response(400);
		if (appId !== options.appId || teamId !== options.teamId) return response(403);
		if (isEnterpriseInstall(raw)) return response(403);

		const eventType = readString(event, 'type');
		if (
			eventType === 'message' &&
			(Object.hasOwn(event, 'subtype') || Object.hasOwn(event, 'bot_id'))
		) {
			return response(200);
		}

		const normalized =
			eventType === 'app_mention' || eventType === 'message'
				? normalizeEvent(eventType, raw, event, request.headers)
				: ({
						type: 'unknown',
						eventType: eventType ?? 'unknown',
						eventId,
						appId,
						teamId,
						retry: readRetry(request.headers),
						raw,
					} satisfies SlackUnknownEvent);
		if (!normalized) return response(400);
		return invokeEvent(options.events, c, normalized, route.handlerTimeoutMs);
	};
}

export function createSlackInteractionsHandler<E extends Env>(
	options: SlackInteractionsHandlerOptions<E>,
): Handler<E> {
	const route = prepareRoute(options);

	return async (c) => {
		const request = c.req.raw;
		const verified = await route.verify(request, 'application/x-www-form-urlencoded');
		if (verified instanceof Response) return verified;
		const raw = parseFormPayload(verified.body);
		if (!isRecord(raw)) return response(400);

		const payloadAppId = readOptionalString(raw, 'api_app_id');
		const team = readRecord(raw, 'team');
		const teamId = team && readString(team, 'id');
		const enterprise = readRecord(raw, 'enterprise');
		const enterpriseId = enterprise && readOptionalString(enterprise, 'id');
		const user = readRecord(raw, 'user');
		const userId = user && readString(user, 'id');
		if (!teamId || !userId) return response(403);
		if (payloadAppId !== undefined && payloadAppId !== options.appId) return response(403);
		if (teamId !== options.teamId || isEnterpriseInstall(raw)) return response(403);
		const common = {
			appId: options.appId,
			teamId,
			...(enterpriseId === undefined ? {} : { enterpriseId }),
			userId,
		};

		const type = readString(raw, 'type');
		let interaction: SlackInteraction | undefined;
		if (type === 'block_actions') {
			interaction = normalizeAction(raw, common);
		} else if (type === 'view_submission') {
			interaction = normalizeView(raw, common);
		} else if (type === 'view_closed') {
			interaction = normalizeViewClosed(raw, common);
		} else if (type === 'shortcut') {
			interaction = normalizeShortcut(raw, common);
		} else if (type === 'message_action') {
			interaction = normalizeMessageShortcut(raw, common);
		} else if (type === 'block_suggestion') {
			interaction = normalizeBlockSuggestion(raw, common);
		} else {
			const capabilities = readInteractionCapabilities(raw);
			interaction = {
				type: 'unknown',
				interactionType: type ?? 'unknown',
				...common,
				...(capabilities === undefined ? {} : { capabilities }),
				raw,
			} satisfies SlackUnknownInteraction;
		}
		if (!interaction) return response(400);
		return invokeInteraction(options.interactions, c, interaction, route.handlerTimeoutMs);
	};
}

export function createSlackCommandsHandler<E extends Env>(
	options: SlackCommandsHandlerOptions<E>,
): Handler<E> {
	const route = prepareRoute(options);

	return async (c) => {
		const request = c.req.raw;
		const verified = await route.verify(request, 'application/x-www-form-urlencoded');
		if (verified instanceof Response) return verified;
		const form = parseForm(verified.body);
		if (!form) return response(400);

		const appId = readRequiredFormValue(form, 'api_app_id');
		const teamId = readRequiredFormValue(form, 'team_id');
		const channelId = readRequiredFormValue(form, 'channel_id');
		const userId = readRequiredFormValue(form, 'user_id');
		const commandName = readRequiredFormValue(form, 'command');
		const text = readRequiredFormValue(form, 'text', true);
		const triggerId = readRequiredFormValue(form, 'trigger_id');
		const responseUrl = readRequiredFormValue(form, 'response_url');
		const enterpriseInstall = readOptionalFormBoolean(form, 'is_enterprise_install');
		if (
			!appId ||
			!teamId ||
			!channelId ||
			!userId ||
			!commandName ||
			text === undefined ||
			!triggerId ||
			!responseUrl ||
			enterpriseInstall === null
		) {
			return response(400);
		}
		if (appId !== options.appId || teamId !== options.teamId || enterpriseInstall === true) {
			return response(403);
		}

		const enterpriseId = readOptionalFormValue(form, 'enterprise_id');
		const channelName = readOptionalFormValue(form, 'channel_name');
		const userName = readOptionalFormValue(form, 'user_name');
		const command: SlackSlashCommand = {
			type: 'slash_command',
			appId,
			teamId,
			...(enterpriseId === undefined ? {} : { enterpriseId }),
			channelId,
			...(channelName === undefined ? {} : { channelName }),
			userId,
			...(userName === undefined ? {} : { userName }),
			command: commandName,
			text,
			capabilities: { triggerId, responseUrl },
			raw: formToRecord(form),
		};
		const outcome = await runHandler(() => options.commands({ c, command }), route.handlerTimeoutMs);
		if (outcome.type !== 'success') return response(500);
		return serializeHandlerResult(outcome.value);
	};
}

async function invokeEvent<E extends Env>(
	handler: (input: { c: Context<E>; event: SlackEvent }) => SlackHandlerResult,
	c: Context<E>,
	event: SlackEvent,
	timeoutMs: number,
): Promise<Response> {
	const outcome = await runHandler(() => handler({ c, event }), timeoutMs);
	if (outcome.type !== 'success') return response(500);
	return serializeHandlerResult(outcome.value);
}

async function invokeInteraction<E extends Env>(
	handler: (input: { c: Context<E>; interaction: SlackInteraction }) => SlackHandlerResult,
	c: Context<E>,
	interaction: SlackInteraction,
	timeoutMs: number,
): Promise<Response> {
	const outcome = await runHandler(() => handler({ c, interaction }), timeoutMs);
	if (outcome.type !== 'success') return response(500);
	return serializeHandlerResult(outcome.value);
}

function prepareRoute(options: SharedRouteOptions): {
	handlerTimeoutMs: number;
	verify(request: Request, expectedMediaType: string): Promise<{ body: Uint8Array } | Response>;
} {
	const bodyLimit = options.bodyLimit ?? DEFAULT_BODY_LIMIT;
	const handlerTimeoutMs = options.handlerTimeoutMs ?? DEFAULT_HANDLER_TIMEOUT_MS;
	if (!Number.isSafeInteger(bodyLimit) || bodyLimit <= 0) {
		throw new TypeError('Slack route bodyLimit must be a positive integer.');
	}
	if (!Number.isSafeInteger(handlerTimeoutMs) || handlerTimeoutMs <= 0) {
		throw new TypeError('Slack route handlerTimeoutMs must be a positive integer.');
	}
	if (handlerTimeoutMs > DEFAULT_HANDLER_TIMEOUT_MS) {
		throw new TypeError('Slack route handlerTimeoutMs must not exceed 2500ms.');
	}
	const secret = encoder.encode(options.signingSecret);

	return {
		handlerTimeoutMs,
		async verify(request, expectedMediaType) {
			const mediaType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
			if (mediaType !== expectedMediaType) return response(415);

			const contentLength = request.headers.get('content-length');
			if (contentLength !== null) {
				if (!/^\d+$/.test(contentLength)) return response(400);
				if (Number(contentLength) > bodyLimit) return response(413);
			}

			let body: Uint8Array | undefined;
			try {
				body = await readBody(request, bodyLimit);
			} catch {
				return response(400);
			}
			if (!body) return response(413);

			const timestampText = request.headers.get('x-slack-request-timestamp');
			const timestamp = parseTimestamp(timestampText);
			const signature = parseSignature(request.headers.get('x-slack-signature'));
			if (
				timestampText === null ||
				timestamp === undefined ||
				Math.abs(Math.floor(Date.now() / 1000) - timestamp) > MAX_SIGNATURE_AGE_SECONDS ||
				!signature ||
				!(await verifySignature(secret, timestampText, body, signature))
			) {
				return response(401);
			}
			return { body };
		},
	};
}

function normalizeEvent(
	type: keyof SlackEvents,
	raw: Record<string, unknown>,
	event: Record<string, unknown>,
	headers: Headers,
): SlackEvents[keyof SlackEvents] | undefined {
	const appId = readString(raw, 'api_app_id');
	const teamId = readString(raw, 'team_id');
	const eventId = readString(raw, 'event_id');
	const channelId = readString(event, 'channel');
	const messageTs = readString(event, 'ts');
	const threadTs = readOptionalString(event, 'thread_ts');
	const text = readString(event, 'text');
	const userId = readString(event, 'user');
	if (!appId || !teamId || !eventId || !channelId || !messageTs || text === undefined || !userId) {
		return undefined;
	}
	const common = {
		type,
		eventId,
		appId,
		teamId,
		retry: readRetry(headers),
		raw,
	};
	return {
		...common,
		type,
		payload: { channelId, messageTs, threadTs, text, userId },
	};
}

interface SlackInteractionIdentity {
	appId: string;
	teamId: string;
	enterpriseId?: string;
	userId: string;
}

function normalizeAction(
	raw: Record<string, unknown>,
	identity: SlackInteractionIdentity,
): SlackActionEnvelope | undefined {
	const actions = raw.actions;
	if (!Array.isArray(actions) || actions.length !== 1 || !isRecord(actions[0])) return undefined;
	const action = actions[0];
	const actionId = readString(action, 'action_id');
	if (!actionId) return undefined;
	const value = readOptionalString(action, 'value');
	const blockId = readOptionalString(action, 'block_id');
	const channel = readRecord(raw, 'channel');
	const message = readRecord(raw, 'message');
	const container = readRecord(raw, 'container');
	const containerType = container && readString(container, 'type');
	if (!container || !containerType) return undefined;
	const channelId =
		(channel && readOptionalString(channel, 'id')) ?? readOptionalString(container, 'channel_id');
	const messageTs =
		(message && readOptionalString(message, 'ts')) ?? readOptionalString(container, 'message_ts');
	const threadTs =
		(message && readOptionalString(message, 'thread_ts')) ??
		readOptionalString(container, 'thread_ts') ??
		messageTs;
	const viewId = readOptionalString(container, 'view_id');
	const capabilities = readInteractionCapabilities(raw);
	return {
		type: 'action',
		...identity,
		actionId,
		...(value === undefined ? {} : { value }),
		...(blockId === undefined ? {} : { blockId }),
		container: {
			type: containerType,
			...(channelId === undefined ? {} : { channelId }),
			...(messageTs === undefined ? {} : { messageTs }),
			...(viewId === undefined ? {} : { viewId }),
		},
		...(channelId === undefined ? {} : { channelId }),
		...(messageTs === undefined ? {} : { messageTs }),
		...(threadTs === undefined ? {} : { threadTs }),
		...(capabilities === undefined ? {} : { capabilities }),
		payload: action,
		raw,
	};
}

function normalizeView(
	raw: Record<string, unknown>,
	identity: SlackInteractionIdentity,
): SlackViewSubmissionEnvelope | undefined {
	const view = readRecord(raw, 'view');
	const viewId = view && readString(view, 'id');
	const callbackId = view && readString(view, 'callback_id');
	const state = view && readRecord(view, 'state');
	if (!viewId || !callbackId || !state || !Object.hasOwn(state, 'values')) return undefined;
	const capabilities = readInteractionCapabilities(raw);
	return {
		type: 'view_submission',
		...identity,
		viewId,
		callbackId,
		privateMetadata: readOptionalString(view, 'private_metadata'),
		values: state.values,
		...(capabilities === undefined ? {} : { capabilities }),
		raw,
	};
}

function normalizeViewClosed(
	raw: Record<string, unknown>,
	identity: SlackInteractionIdentity,
): SlackViewClosedEnvelope | undefined {
	const view = readRecord(raw, 'view');
	const viewId = view && readString(view, 'id');
	const isCleared = raw.is_cleared;
	if (!viewId || typeof isCleared !== 'boolean') return undefined;
	const callbackId = readOptionalString(view, 'callback_id');
	const privateMetadata = readOptionalString(view, 'private_metadata');
	return {
		type: 'view_closed',
		...identity,
		viewId,
		...(callbackId === undefined ? {} : { callbackId }),
		...(privateMetadata === undefined ? {} : { privateMetadata }),
		isCleared,
		raw,
	};
}

function normalizeShortcut(
	raw: Record<string, unknown>,
	identity: SlackInteractionIdentity,
): SlackShortcutEnvelope | undefined {
	const callbackId = readString(raw, 'callback_id');
	const triggerId = readString(raw, 'trigger_id');
	if (!callbackId || !triggerId) return undefined;
	return {
		type: 'shortcut',
		...identity,
		callbackId,
		capabilities: {
			...readInteractionCapabilities(raw),
			triggerId,
		},
		raw,
	};
}

function normalizeMessageShortcut(
	raw: Record<string, unknown>,
	identity: SlackInteractionIdentity,
): SlackMessageShortcutEnvelope | undefined {
	const callbackId = readString(raw, 'callback_id');
	const triggerId = readString(raw, 'trigger_id');
	const responseUrl = readString(raw, 'response_url');
	const channel = readRecord(raw, 'channel');
	const channelId = channel && readString(channel, 'id');
	const message = readRecord(raw, 'message');
	const messageTs = message && readString(message, 'ts');
	if (!callbackId || !triggerId || !responseUrl || !channelId || !message || !messageTs) {
		return undefined;
	}
	return {
		type: 'message_action',
		...identity,
		callbackId,
		channelId,
		messageTs,
		message,
		capabilities: {
			...readInteractionCapabilities(raw),
			triggerId,
			responseUrl,
		},
		raw,
	};
}

function normalizeBlockSuggestion(
	raw: Record<string, unknown>,
	identity: SlackInteractionIdentity,
): SlackBlockSuggestionEnvelope | undefined {
	const actionId = readString(raw, 'action_id');
	const blockId = readString(raw, 'block_id');
	const value = readString(raw, 'value');
	if (!actionId || !blockId || value === undefined) return undefined;
	const channel = readRecord(raw, 'channel');
	const channelId = channel && readOptionalString(channel, 'id');
	const view = readRecord(raw, 'view');
	const viewId = view && readOptionalString(view, 'id');
	return {
		type: 'block_suggestion',
		...identity,
		actionId,
		blockId,
		value,
		...(channelId === undefined ? {} : { channelId }),
		...(viewId === undefined ? {} : { viewId }),
		raw,
	};
}

function readInteractionCapabilities(
	raw: Record<string, unknown>,
): SlackInteractionCapabilities | undefined {
	const triggerId = readOptionalString(raw, 'trigger_id');
	const responseUrl = readOptionalString(raw, 'response_url');
	const view = readRecord(raw, 'view');
	const responseUrls = view && readResponseUrls(view.response_urls);
	if (triggerId === undefined && responseUrl === undefined && responseUrls === undefined) {
		return undefined;
	}
	return {
		...(triggerId === undefined ? {} : { triggerId }),
		...(responseUrl === undefined ? {} : { responseUrl }),
		...(responseUrls === undefined ? {} : { responseUrls }),
	};
}

function readResponseUrls(
	value: unknown,
): SlackInteractionCapabilities['responseUrls'] | undefined {
	if (!Array.isArray(value)) return undefined;
	const responseUrls: NonNullable<SlackInteractionCapabilities['responseUrls']>[number][] = [];
	for (const item of value) {
		if (!isRecord(item)) continue;
		const blockId = readString(item, 'block_id');
		const actionId = readString(item, 'action_id');
		const channelId = readString(item, 'channel_id');
		const responseUrl = readString(item, 'response_url');
		if (blockId && actionId && channelId && responseUrl) {
			responseUrls.push({ blockId, actionId, channelId, responseUrl });
		}
	}
	return responseUrls.length > 0 ? responseUrls : undefined;
}

function isEnterpriseInstall(raw: Record<string, unknown>): boolean {
	if (raw.is_enterprise_install === true) return true;
	if (!Array.isArray(raw.authorizations)) return false;
	return raw.authorizations.some(
		(authorization) => isRecord(authorization) && authorization.is_enterprise_install === true,
	);
}

type HandlerOutcome<T> = { type: 'success'; value: T } | { type: 'failure' } | { type: 'timeout' };

async function runHandler<T>(
	handler: () => T | Promise<T>,
	timeoutMs: number,
): Promise<HandlerOutcome<T>> {
	let timeout: ReturnType<typeof setTimeout> | undefined;
	const handlerPromise = Promise.resolve()
		.then(handler)
		.then(
			(value): HandlerOutcome<T> => ({ type: 'success', value }),
			(): HandlerOutcome<T> => ({ type: 'failure' }),
		);
	const timeoutPromise = new Promise<HandlerOutcome<T>>((resolve) => {
		timeout = setTimeout(() => resolve({ type: 'timeout' }), timeoutMs);
	});
	const outcome = await Promise.race([handlerPromise, timeoutPromise]);
	if (timeout !== undefined) clearTimeout(timeout);
	return outcome;
}

function serializeHandlerResult(value: unknown): Response {
	if (value instanceof Response) return value;
	if (value === undefined) return response(200);
	if (!isJsonValue(value)) return response(500);
	return Response.json(value);
}

function isJsonValue(value: unknown, seen = new Set<object>()): value is JsonValue {
	if (value === null || typeof value === 'boolean' || typeof value === 'string') return true;
	if (typeof value === 'number') return Number.isFinite(value);
	if (typeof value !== 'object') return false;
	if (seen.has(value)) return false;
	if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) return false;
	seen.add(value);
	try {
		return Array.isArray(value)
			? value.every((item) => isJsonValue(item, seen))
			: Object.values(value).every((item) => isJsonValue(item, seen));
	} finally {
		seen.delete(value);
	}
}

function readRetry(headers: Headers): { number: number; reason?: string } | undefined {
	const number = parseNonNegativeInteger(headers.get('x-slack-retry-num'));
	if (number === undefined) return undefined;
	const reason = headers.get('x-slack-retry-reason') ?? undefined;
	return { number, reason };
}

async function readBody(request: Request, bodyLimit: number): Promise<Uint8Array | undefined> {
	if (!request.body) return new Uint8Array();
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > bodyLimit) {
				void reader.cancel();
				return undefined;
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	const body = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return body;
}

function parseTimestamp(value: string | null): number | undefined {
	return parseNonNegativeInteger(value);
}

function parseSignature(value: string | null): Uint8Array | undefined {
	const match = /^v0=([0-9a-fA-F]{64})$/.exec(value ?? '');
	if (!match?.[1]) return undefined;
	const bytes = new Uint8Array(32);
	for (let index = 0; index < bytes.length; index += 1) {
		bytes[index] = Number.parseInt(match[1].slice(index * 2, index * 2 + 2), 16);
	}
	return bytes;
}

async function verifySignature(
	secret: Uint8Array,
	timestamp: string,
	body: Uint8Array,
	signature: Uint8Array,
): Promise<boolean> {
	const prefix = encoder.encode(`v0:${timestamp}:`);
	const signed = new Uint8Array(prefix.byteLength + body.byteLength);
	signed.set(prefix);
	signed.set(body, prefix.byteLength);
	const key = await crypto.subtle.importKey(
		'raw',
		toArrayBuffer(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['verify'],
	);
	return crypto.subtle.verify('HMAC', key, toArrayBuffer(signature), toArrayBuffer(signed));
}

function parseJson(body: Uint8Array): unknown {
	try {
		return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
	} catch {
		return undefined;
	}
}

function parseFormPayload(body: Uint8Array): unknown {
	try {
		const form = parseForm(body);
		if (!form) return undefined;
		const payloads = form.getAll('payload');
		if (payloads.length !== 1) return undefined;
		return JSON.parse(payloads[0] ?? '');
	} catch {
		return undefined;
	}
}

function parseForm(body: Uint8Array): URLSearchParams | undefined {
	try {
		const text = new TextDecoder('utf-8', { fatal: true }).decode(body);
		return new URLSearchParams(text);
	} catch {
		return undefined;
	}
}

function readRequiredFormValue(
	form: URLSearchParams,
	key: string,
	allowEmpty = false,
): string | undefined {
	const values = form.getAll(key);
	if (values.length !== 1) return undefined;
	const value = values[0];
	if (value === undefined || (!allowEmpty && value.length === 0)) return undefined;
	return value;
}

function readOptionalFormValue(form: URLSearchParams, key: string): string | undefined {
	const values = form.getAll(key);
	if (values.length === 0) return undefined;
	if (values.length !== 1 || !values[0]) return undefined;
	return values[0];
}

function readOptionalFormBoolean(
	form: URLSearchParams,
	key: string,
): boolean | undefined | null {
	const values = form.getAll(key);
	if (values.length === 0) return undefined;
	if (values.length !== 1) return null;
	if (values[0] === 'true') return true;
	if (values[0] === 'false') return false;
	return null;
}

function formToRecord(form: URLSearchParams): Record<string, string | string[]> {
	const record: Record<string, string | string[]> = {};
	for (const key of new Set(form.keys())) {
		const values = form.getAll(key);
		record[key] = values.length === 1 && values[0] !== undefined ? values[0] : values;
	}
	return record;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	return bytes.slice().buffer;
}

function response(status: number): Response {
	return new Response(null, { status });
}

function readRecord(
	value: Record<string, unknown>,
	key: string,
): Record<string, unknown> | undefined {
	const field = value[key];
	return isRecord(field) ? field : undefined;
}

function readString(value: Record<string, unknown>, key: string): string | undefined {
	const field = value[key];
	return typeof field === 'string' ? field : undefined;
}

function readOptionalString(value: Record<string, unknown>, key: string): string | undefined {
	const field = readString(value, key);
	return field && field.length > 0 ? field : undefined;
}

function parseNonNegativeInteger(value: string | null): number | undefined {
	if (value === null || !/^\d+$/.test(value)) return undefined;
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import {
	createSlackChannel,
	InvalidSlackConversationKeyError,
	type SlackChannel,
} from '../src/index.ts';

const encoder = new TextEncoder();

describe('createSlackChannel()', () => {
	it('publishes only configured provider surfaces when callbacks are provided', () => {
		const events = createSlackChannel({
			signingSecret: 'secret',
			appId: 'A123',
			teamId: 'T123',
			events() {},
		});
		const interactions = createSlackChannel({
			signingSecret: 'secret',
			appId: 'A123',
			teamId: 'T123',
			interactions() {},
		});
		const commands = createSlackChannel({
			signingSecret: 'secret',
			appId: 'A123',
			teamId: 'T123',
			commands() {},
		});

		expect(events.routes.map(({ method, path }) => ({ method, path }))).toEqual([
			{ method: 'POST', path: '/events' },
		]);
		expect(interactions.routes.map(({ method, path }) => ({ method, path }))).toEqual([
			{ method: 'POST', path: '/interactions' },
		]);
		expect(commands.routes.map(({ method, path }) => ({ method, path }))).toEqual([
			{ method: 'POST', path: '/commands' },
		]);
	});

	it('rejects configuration when no provider handler is configured', () => {
		expect(() =>
			createSlackChannel({
				signingSecret: 'secret',
				appId: 'A123',
				teamId: 'T123',
			}),
		).toThrow('requires an events, interactions, or commands handler');
	});

	it('invokes one events callback with normalized retry metadata', async () => {
		const events = vi.fn();
		const slack = createSlackChannel({
			signingSecret: 'secret',
			appId: 'A123',
			teamId: 'T123',
			events,
		});
		const raw = {
			type: 'event_callback',
			api_app_id: 'A123',
			team_id: 'T123',
			event_id: 'Ev123',
			event: {
				type: 'app_mention',
				channel: 'C123',
				ts: '1717971234.0012',
				text: '<@U1> hello',
				user: 'U2',
			},
		};

		const response = await channelApp(slack).request(
			await signedJsonRequest('/events', raw, {
				'x-slack-retry-num': '1',
				'x-slack-retry-reason': 'http_timeout',
			}),
		);

		expect(response.status).toBe(200);
		expect(events.mock.calls[0]?.[0]).toMatchObject({
			c: expect.any(Object),
			event: {
				type: 'app_mention',
				eventId: 'Ev123',
				appId: 'A123',
				teamId: 'T123',
				retry: { number: 1, reason: 'http_timeout' },
				payload: {
					channelId: 'C123',
					messageTs: '1717971234.0012',
					text: '<@U1> hello',
					userId: 'U2',
				},
			},
		});
	});

	it('forwards unsupported Events API events through the unknown variant', async () => {
		const events = vi.fn();
		const slack = createSlackChannel({
			signingSecret: 'secret',
			appId: 'A123',
			teamId: 'T123',
			events,
		});

		const response = await channelApp(slack).request(
			await signedJsonRequest('/events', {
				type: 'event_callback',
				api_app_id: 'A123',
				team_id: 'T123',
				event_id: 'Ev999',
				event: { type: 'reaction_added' },
			}),
		);

		expect(response.status).toBe(200);
		expect(events.mock.calls[0]?.[0].event).toMatchObject({
			type: 'unknown',
			eventType: 'reaction_added',
			eventId: 'Ev999',
		});
	});

	it('handles URL verification when Slack omits app and workspace identity', async () => {
		const events = vi.fn();
		const slack = createSlackChannel({
			signingSecret: 'secret',
			appId: 'A123',
			teamId: 'T123',
			events,
		});

		const response = await channelApp(slack).request(
			await signedJsonRequest('/events', {
				type: 'url_verification',
				challenge: 'challenge-value',
			}),
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ challenge: 'challenge-value' });
		expect(events).not.toHaveBeenCalled();
	});

	it('requires trusted identity when an unsupported Events API envelope is received', async () => {
		const events = vi.fn();
		const slack = createSlackChannel({
			signingSecret: 'secret',
			appId: 'A123',
			teamId: 'T123',
			events,
		});
		const app = channelApp(slack);

		const missingIdentity = await app.request(
			await signedJsonRequest('/events', { type: 'app_rate_limited' }),
		);
		const unsupported = await app.request(
			await signedJsonRequest('/events', {
				type: 'app_rate_limited',
				api_app_id: 'A123',
				team_id: 'T123',
			}),
		);

		expect(missingIdentity.status).toBe(400);
		expect(unsupported.status).toBe(200);
		expect(events).toHaveBeenCalledOnce();
		expect(events.mock.calls[0]?.[0].event).toEqual({
			type: 'unknown',
			eventType: 'app_rate_limited',
			appId: 'A123',
			teamId: 'T123',
			retry: undefined,
			raw: {
				type: 'app_rate_limited',
				api_app_id: 'A123',
				team_id: 'T123',
			},
		});
	});

	it('normalizes slash commands when fixed-workspace identity matches', async () => {
		const commands = vi.fn(({ c, command }) =>
			c.json({ received: command.command, text: command.text }),
		);
		const slack = createSlackChannel({
			signingSecret: 'secret',
			appId: 'A123',
			teamId: 'T123',
			commands,
		});
		const fields = {
			api_app_id: 'A123',
			team_id: 'T123',
			team_domain: 'acme',
			channel_id: 'C123',
			channel_name: 'automation',
			user_id: 'U123',
			user_name: 'river',
			command: '/triage',
			text: 'incident 42',
			trigger_id: 'trigger-capability',
			response_url: 'https://hooks.slack.test/commands/response',
		};

		const response = await channelApp(slack).request(
			await signedCommandRequest('/commands', fields),
		);
		const foreign = await channelApp(slack).request(
			await signedCommandRequest('/commands', { ...fields, team_id: 'T999' }),
		);
		const orgWide = await channelApp(slack).request(
			await signedCommandRequest('/commands', {
				...fields,
				enterprise_id: 'E123',
				is_enterprise_install: 'true',
			}),
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ received: '/triage', text: 'incident 42' });
		expect(commands.mock.calls[0]?.[0]).toMatchObject({
			c: expect.any(Object),
			command: {
				type: 'slash_command',
				appId: 'A123',
				teamId: 'T123',
				channelId: 'C123',
				channelName: 'automation',
				userId: 'U123',
				userName: 'river',
				command: '/triage',
				text: 'incident 42',
				capabilities: {
					triggerId: 'trigger-capability',
					responseUrl: 'https://hooks.slack.test/commands/response',
				},
			},
		});
		expect(foreign.status).toBe(403);
		expect(orgWide.status).toBe(403);
		expect(commands).toHaveBeenCalledOnce();
	});

	it('invokes one interactions callback for actions and returns JSON directly', async () => {
		const shared = { accepted: true };
		const interactions = vi.fn((_input: unknown) => ({ first: shared, second: shared }));
		const slack = createSlackChannel({
			signingSecret: 'secret',
			appId: 'A123',
			teamId: 'T123',
			interactions,
		});
		const payload = {
			type: 'block_actions',
			api_app_id: 'A123',
			team: { id: 'T123' },
			user: { id: 'U123' },
			channel: { id: 'C123' },
			message: { ts: '1717971234.0012' },
			container: { type: 'message', channel_id: 'C123', message_ts: '1717971234.0012' },
			actions: [{ action_id: 'approve', value: 'yes' }],
		};

		const response = await channelApp(slack).request(
			await signedFormRequest('/interactions', payload),
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			first: { accepted: true },
			second: { accepted: true },
		});
		expect(
			(interactions.mock.calls[0]?.[0] as { interaction: unknown } | undefined)?.interaction,
		).toMatchObject({
			type: 'action',
			actionId: 'approve',
			value: 'yes',
			channelId: 'C123',
			messageTs: '1717971234.0012',
			threadTs: '1717971234.0012',
		});
	});

	it('normalizes global shortcuts when api_app_id is absent', async () => {
		const interactions = vi.fn();
		const slack = createSlackChannel({
			signingSecret: 'secret',
			appId: 'A123',
			teamId: 'T123',
			interactions,
		});

		const response = await channelApp(slack).request(
			await signedFormRequest('/interactions', {
				type: 'shortcut',
				team: { id: 'T123' },
				user: { id: 'U123' },
				callback_id: 'open_triage',
				trigger_id: 'shortcut-trigger-capability',
			}),
		);

		expect(response.status).toBe(200);
		expect(interactions.mock.calls[0]?.[0].interaction).toEqual({
			type: 'shortcut',
			appId: 'A123',
			teamId: 'T123',
			userId: 'U123',
			callbackId: 'open_triage',
			capabilities: { triggerId: 'shortcut-trigger-capability' },
			raw: {
				type: 'shortcut',
				team: { id: 'T123' },
				user: { id: 'U123' },
				callback_id: 'open_triage',
				trigger_id: 'shortcut-trigger-capability',
			},
		});
	});

	it('normalizes block actions when they originate from views', async () => {
		const interactions = vi.fn();
		const slack = createSlackChannel({
			signingSecret: 'secret',
			appId: 'A123',
			teamId: 'T123',
			interactions,
		});

		const response = await channelApp(slack).request(
			await signedFormRequest('/interactions', {
				type: 'block_actions',
				api_app_id: 'A123',
				team: { id: 'T123' },
				user: { id: 'U123' },
				trigger_id: 'action-trigger-capability',
				container: { type: 'view', view_id: 'V123' },
				actions: [{ action_id: 'approve', block_id: 'decision', value: 'yes' }],
			}),
		);

		expect(response.status).toBe(200);
		expect(interactions.mock.calls[0]?.[0].interaction).toMatchObject({
			type: 'action',
			actionId: 'approve',
			blockId: 'decision',
			value: 'yes',
			container: { type: 'view', viewId: 'V123' },
			capabilities: { triggerId: 'action-trigger-capability' },
		});
	});

	it('normalizes view closures and block suggestions when those variants are received', async () => {
		const interactions = vi.fn();
		const slack = createSlackChannel({
			signingSecret: 'secret',
			appId: 'A123',
			teamId: 'T123',
			interactions,
		});
		const app = channelApp(slack);

		const closed = await app.request(
			await signedFormRequest('/interactions', {
				type: 'view_closed',
				team: { id: 'T123' },
				user: { id: 'U123' },
				view: {
					id: 'V123',
					callback_id: 'settings',
					private_metadata: 'opaque-application-value',
				},
				is_cleared: true,
			}),
		);
		const suggestion = await app.request(
			await signedFormRequest('/interactions', {
				type: 'block_suggestion',
				team: { id: 'T123' },
				user: { id: 'U123' },
				action_id: 'search_projects',
				block_id: 'project',
				value: 'flu',
				view: { id: 'V124' },
			}),
		);

		expect(closed.status).toBe(200);
		expect(suggestion.status).toBe(200);
		expect(interactions.mock.calls[0]?.[0].interaction).toMatchObject({
			type: 'view_closed',
			viewId: 'V123',
			callbackId: 'settings',
			privateMetadata: 'opaque-application-value',
			isCleared: true,
		});
		expect(interactions.mock.calls[1]?.[0].interaction).toMatchObject({
			type: 'block_suggestion',
			actionId: 'search_projects',
			blockId: 'project',
			value: 'flu',
			viewId: 'V124',
		});
	});

	it('returns provider-native view validation JSON without translation', async () => {
		const slack = createSlackChannel({
			signingSecret: 'secret',
			appId: 'A123',
			teamId: 'T123',
			interactions: ({ interaction }) => {
				if (interaction.type !== 'view_submission') return;
				return {
					response_action: 'errors',
					errors: { email: 'Enter a valid email address.' },
				};
			},
		});

		const response = await channelApp(slack).request(
			await signedFormRequest('/interactions', {
				type: 'view_submission',
				api_app_id: 'A123',
				team: { id: 'T123' },
				user: { id: 'U123' },
				view: {
					id: 'V123',
					callback_id: 'settings',
					state: { values: {} },
				},
			}),
		);

		expect(await response.json()).toEqual({
			response_action: 'errors',
			errors: { email: 'Enter a valid email address.' },
		});
	});

	it('uses empty 200 defaults and passes Hono responses through', async () => {
		const defaultChannel = createSlackChannel({
			signingSecret: 'secret',
			appId: 'A123',
			teamId: 'T123',
			events() {},
		});
		const responseChannel = createSlackChannel({
			signingSecret: 'secret',
			appId: 'A123',
			teamId: 'T123',
			events: ({ c }) => c.text('accepted', 202),
		});
		const payload = {
			type: 'event_callback',
			api_app_id: 'A123',
			team_id: 'T123',
			event_id: 'Ev123',
			event: {
				type: 'message',
				channel: 'C123',
				ts: '1717971234.0012',
				text: 'hello',
				user: 'U2',
			},
		};

		const defaultResponse = await channelApp(defaultChannel).request(
			await signedJsonRequest('/events', payload),
		);
		const response = await channelApp(responseChannel).request(
			await signedJsonRequest('/events', payload),
		);

		expect(defaultResponse.status).toBe(200);
		expect(await defaultResponse.text()).toBe('');
		expect(response.status).toBe(202);
		expect(await response.text()).toBe('accepted');
	});

	it('rejects stale signatures and signed identity mismatches', async () => {
		const events = vi.fn();
		const slack = createSlackChannel({
			signingSecret: 'secret',
			appId: 'A123',
			teamId: 'T123',
			events,
		});
		const payload = {
			type: 'event_callback',
			api_app_id: 'WRONG',
			team_id: 'T123',
			event_id: 'Ev123',
			event: { type: 'reaction_added' },
		};

		const stale = await channelApp(slack).request(
			await signedJsonRequest('/events', payload, {}, Math.floor(Date.now() / 1000) - 301),
		);
		const mismatch = await channelApp(slack).request(await signedJsonRequest('/events', payload));

		expect(stale.status).toBe(401);
		expect(mismatch.status).toBe(403);
		expect(events).not.toHaveBeenCalled();
	});

	it('rejects org-wide Events API and interactivity payloads when v1 is fixed-workspace', async () => {
		const events = vi.fn();
		const interactions = vi.fn();
		const slack = createSlackChannel({
			signingSecret: 'secret',
			appId: 'A123',
			teamId: 'T123',
			events,
			interactions,
		});
		const app = channelApp(slack);

		const eventResponse = await app.request(
			await signedJsonRequest('/events', {
				type: 'event_callback',
				api_app_id: 'A123',
				team_id: 'T123',
				event_id: 'Ev123',
				authorizations: [
					{
						enterprise_id: 'E123',
						team_id: null,
						user_id: 'U123',
						is_bot: true,
						is_enterprise_install: true,
					},
				],
				event: { type: 'reaction_added' },
			}),
		);
		const interactionResponse = await app.request(
			await signedFormRequest('/interactions', {
				type: 'shortcut',
				team: { id: 'T123' },
				enterprise: { id: 'E123' },
				user: { id: 'U123' },
				is_enterprise_install: true,
				callback_id: 'open_triage',
				trigger_id: 'shortcut-trigger',
			}),
		);

		expect(eventResponse.status).toBe(403);
		expect(interactionResponse.status).toBe(403);
		expect(events).not.toHaveBeenCalled();
		expect(interactions).not.toHaveBeenCalled();
	});

	it('returns 500 when a callback throws or exceeds its deadline', async () => {
		const throwing = createSlackChannel({
			signingSecret: 'secret',
			appId: 'A123',
			teamId: 'T123',
			events() {
				throw new Error('failed');
			},
		});
		const timeout = createSlackChannel({
			signingSecret: 'secret',
			appId: 'A123',
			teamId: 'T123',
			handlerTimeoutMs: 5,
			events: () => new Promise(() => {}),
		});
		const payload = {
			type: 'event_callback',
			api_app_id: 'A123',
			team_id: 'T123',
			event_id: 'Ev123',
			event: { type: 'reaction_added' },
		};

		expect(
			(await channelApp(throwing).request(await signedJsonRequest('/events', payload))).status,
		).toBe(500);
		expect(
			(await channelApp(timeout).request(await signedJsonRequest('/events', payload))).status,
		).toBe(500);
		expect(
			(
				await channelApp(timeout).request(
					await signedJsonRequest('/events', {
						type: 'app_rate_limited',
						api_app_id: 'A123',
						team_id: 'T123',
					}),
				)
			).status,
		).toBe(500);
	});

	it('round-trips canonical thread references', () => {
		const slack = createSlackChannel({
			signingSecret: 'secret',
			appId: 'A123',
			teamId: 'T123',
			events() {},
		});
		const ref = { teamId: 'T:123', channelId: 'C/123', threadTs: '1717.00?#' };
		const key = slack.conversationKey(ref);

		expect(slack.parseConversationKey(key)).toEqual(ref);
		expect(() => slack.parseConversationKey(`github:v1:${key}`)).toThrow(
			InvalidSlackConversationKeyError,
		);
	});
});

function channelApp(channel: SlackChannel): Hono {
	const app = new Hono();
	for (const route of channel.routes) app.on(route.method, route.path, route.handler);
	return app;
}

async function signedJsonRequest(
	path: string,
	payload: unknown,
	headers: Record<string, string> = {},
	timestamp = Math.floor(Date.now() / 1000),
): Promise<Request> {
	return signedRequest(path, JSON.stringify(payload), 'application/json', headers, timestamp);
}

async function signedFormRequest(path: string, payload: unknown): Promise<Request> {
	return signedRequest(
		path,
		new URLSearchParams({ payload: JSON.stringify(payload) }).toString(),
		'application/x-www-form-urlencoded',
	);
}

async function signedCommandRequest(
	path: string,
	fields: Record<string, string>,
): Promise<Request> {
	return signedRequest(
		path,
		new URLSearchParams(fields).toString(),
		'application/x-www-form-urlencoded',
	);
}

async function signedRequest(
	path: string,
	body: string,
	contentType: string,
	headers: Record<string, string> = {},
	timestamp = Math.floor(Date.now() / 1000),
): Promise<Request> {
	const signed = `v0:${timestamp}:${body}`;
	const key = await crypto.subtle.importKey(
		'raw',
		encoder.encode('secret'),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign'],
	);
	const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(signed)));
	const hex = Array.from(signature, (byte) => byte.toString(16).padStart(2, '0')).join('');
	return new Request(`https://example.test${path}`, {
		method: 'POST',
		headers: {
			'content-type': contentType,
			'x-slack-request-timestamp': String(timestamp),
			'x-slack-signature': `v0=${hex}`,
			...headers,
		},
		body,
	});
}

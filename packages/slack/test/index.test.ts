import { describe, expect, it } from 'vitest';
import { createSlackChannel } from '../src/index.ts';

describe('createSlackChannel()', () => {
	it('returns separate handlers when event and interaction routes are created', async () => {
		const slack = createSlackChannel({ signingSecret: 'secret', botToken: 'token', appId: 'A1', teamId: 'T1' });

		const [events, interactions] = await Promise.all([
			slack.routes.events()(new Request('https://example.test/events', { method: 'POST' })),
			slack.routes.interactions()(new Request('https://example.test/interactions', { method: 'POST' })),
		]);

		expect(events.status).toBe(501);
		expect(interactions.status).toBe(501);
	});

	it('rejects a second response owner when an interaction key is registered twice', () => {
		const slack = createSlackChannel({ signingSecret: 'secret', botToken: 'token', appId: 'A1', teamId: 'T1' });
		slack.onAction('approve', () => ({ type: 'ack' }));

		expect(() => slack.onAction('approve', () => ({ type: 'ack' }))).toThrow();
	});

	it('round-trips a thread reference when a conversation key is parsed', () => {
		const slack = createSlackChannel({ signingSecret: 'secret', botToken: 'token', appId: 'A1', teamId: 'T1' });
		const ref = { teamId: 'T:1', channelId: 'C/2', threadTs: '1234.5' };

		expect(slack.parseConversationKey(slack.conversationKey(ref))).toEqual(ref);
	});
});

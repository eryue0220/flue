import { describe, expect, it } from 'vitest';
import { createGitHubChannel } from '../src/index.ts';

describe('createGitHubChannel()', () => {
	it('returns an independently mountable handler when webhook route is created', async () => {
		const github = createGitHubChannel({ webhookSecret: 'secret', token: 'token' });
		const handler = github.routes.webhook();

		const response = await handler(new Request('https://example.test/webhook', { method: 'POST' }));

		expect(response.status).toBe(501);
	});

	it('round-trips an issue reference when a conversation key is parsed', () => {
		const github = createGitHubChannel({ webhookSecret: 'secret', token: 'token' });
		const ref = { owner: 'with:astro', repo: 'flue/next', issueNumber: 42 };

		expect(github.parseConversationKey(github.conversationKey(ref))).toEqual(ref);
	});
});

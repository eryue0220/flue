import { describe, expect, it, vi } from 'vitest';
import { createDiscordChannel } from '../src/index.ts';

describe('createDiscordChannel()', () => {
	it('returns an independently mountable handler when interactions route is created', async () => {
		const discord = createDiscordChannel({ publicKey: 'key', applicationId: 'app', botToken: 'token' });

		const response = await discord.routes.interactions()(
			new Request('https://example.test/interactions', { method: 'POST' }),
		);

		expect(response.status).toBe(501);
	});

	it('rejects a second response owner when a command key is registered twice', () => {
		const discord = createDiscordChannel({ publicKey: 'key', applicationId: 'app', botToken: 'token' });
		discord.onCommand('ask', () => ({ type: 'message', message: { content: 'ok' } }));

		expect(() =>
			discord.onCommand('ask', () => ({ type: 'message', message: { content: 'again' } })),
		).toThrow();
	});

	it('round-trips each supported destination when a conversation key is parsed', () => {
		const discord = createDiscordChannel({ publicKey: 'key', applicationId: 'app', botToken: 'token' });
		const refs = [
			{ type: 'guild', guildId: 'g:1', channelId: 'c/2', channelKind: 'channel' },
			{ type: 'guild', guildId: 'g:1', channelId: 't:3', channelKind: 'thread' },
			{ type: 'dm', channelId: 'd:4' },
		] as const;

		for (const ref of refs) expect(discord.parseConversationKey(discord.conversationKey(ref))).toEqual(ref);
	});

	it('disables mention parsing when the message tool is created without an opt-in', async () => {
		const discord = createDiscordChannel({ publicKey: 'key', applicationId: 'app', botToken: 'token' });
		const postMessage = vi.spyOn(discord.client, 'postMessage').mockResolvedValue();
		const tool = discord.tools.postMessage({
			type: 'guild',
			guildId: 'g1',
			channelId: 'c1',
			channelKind: 'channel',
		});

		await tool.execute({ text: '@everyone' });

		expect(postMessage).toHaveBeenCalledWith(
			{ type: 'guild', guildId: 'g1', channelId: 'c1', channelKind: 'channel' },
			{ content: '@everyone', allowedMentions: { parse: [] } },
			undefined,
		);
	});
});

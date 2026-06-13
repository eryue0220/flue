import { createAgent } from '@flue/runtime';
import { discord } from '../channels/discord.ts';

export default createAgent(({ id }) => ({
	model: 'anthropic/claude-haiku-4-5',
	instructions: 'Post a concise answer to the bound Discord destination.',
	tools: [discord.tools.postMessage(discord.parseConversationKey(id))],
}));

import { createAgent } from '@flue/runtime';
import { slack } from '../channels/slack.ts';

export default createAgent(({ id }) => ({
	model: 'anthropic/claude-haiku-4-5',
	instructions: 'Reply in the bound Slack thread when appropriate.',
	tools: id.startsWith('slack:v1:approval:')
		? []
		: [slack.tools.replyInThread(slack.parseConversationKey(id))],
}));

import { createAgent } from '@flue/runtime';
import { github } from '../channels/github.ts';

export default createAgent(({ id }) => ({
	model: 'anthropic/claude-haiku-4-5',
	instructions: 'Review the issue and post a concise triage comment when appropriate.',
	tools: [
		github.tools.commentOnIssue(github.parseConversationKey(id)),
		github.tools.addLabels(github.parseConversationKey(id)),
	],
}));

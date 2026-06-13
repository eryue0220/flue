import { createSlackChannel } from '@flue/slack';
import { dispatch } from '@flue/runtime';
import assistant from '../agents/assistant.ts';

export const slack = createSlackChannel({
	signingSecret: requiredEnv('SLACK_SIGNING_SECRET'),
	botToken: requiredEnv('SLACK_BOT_TOKEN'),
	appId: requiredEnv('SLACK_APP_ID'),
	teamId: requiredEnv('SLACK_TEAM_ID'),
});

slack.on('app_mention', async (event) => {
	const thread = {
		teamId: event.teamId,
		channelId: event.payload.channelId,
		threadTs: event.payload.threadTs ?? event.payload.messageTs,
	};
	await dispatch(assistant, {
		id: slack.conversationKey(thread),
		input: {
			type: 'slack.app_mention',
			eventId: event.eventId,
			text: event.payload.text,
		},
	});
});

slack.onAction('approve', async (event) => {
	await dispatch(assistant, {
		id: `slack:v1:approval:${encodeURIComponent(event.teamId)}:${encodeURIComponent(event.userId)}`,
		input: { type: 'slack.approval', actionId: event.actionId },
	});
	return { type: 'message', message: { text: 'Approval received.', responseType: 'ephemeral' } };
});

function requiredEnv(name: string): string {
	const value = process.env[name];
	if (!value) throw new Error(`${name} is required.`);
	return value;
}

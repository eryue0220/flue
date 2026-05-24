import { createAgent, defineAgentProfile, dispatch } from '@flue/runtime';
import discord from '../channels/discord';
import gchat from '../channels/gchat';

const moderator = defineAgentProfile({
	model: 'anthropic/claude-haiku-4-5',
	instructions: `
You manage inbound moderation cases.
Discord deliveries are evidence. Google Chat deliveries are reviewer discussion.
Do not attempt to post back to either platform; outbound actions are not part of this example.
`,
});

const agent = createAgent(() => ({ profile: moderator }));

discord.on('message.created', async ({ event }) => {
	if (!event.guildId || !event.caseId || !event.message?.text) return;
	if (!looksFlagged(event.message.text)) return;
	await dispatch(agent, {
		id: `guild:${event.guildId}`,
		session: `case:${event.caseId}`,
		input: {
			type: 'discord.message.flagged',
			deliveryId: event.deliveryId,
			message: event.message,
		},
	});
});

gchat.on('message.created', async ({ event }) => {
	if (!event.guildId || !event.caseId || !event.message) return;
	await dispatch(agent, {
		id: `guild:${event.guildId}`,
		session: `case:${event.caseId}`,
		input: {
			type: 'gchat.moderator_discussion',
			deliveryId: event.deliveryId,
			reviewerId: event.reviewerId,
			message: event.message,
		},
	});
});

export default agent;

function looksFlagged(text: string): boolean {
	return /\b(flag|abuse|spam)\b/i.test(text);
}

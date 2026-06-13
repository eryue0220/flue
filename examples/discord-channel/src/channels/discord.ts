import { createDiscordChannel, type DiscordDestinationRef } from '@flue/discord';
import { dispatch } from '@flue/runtime';
import assistant from '../agents/assistant.ts';

export const discord = createDiscordChannel({
	publicKey: requiredEnv('DISCORD_PUBLIC_KEY'),
	applicationId: requiredEnv('DISCORD_APPLICATION_ID'),
	botToken: requiredEnv('DISCORD_BOT_TOKEN'),
});

discord.onCommand('ask', async (interaction) => {
	const destination: DiscordDestinationRef = interaction.destination;
	await dispatch(assistant, {
		id: discord.conversationKey(destination),
		input: {
			type: 'discord.command.ask',
			interactionId: interaction.id,
			data: interaction.data,
		},
	});
	return { type: 'message', message: { content: 'Your request was accepted.' }, ephemeral: true };
});

function requiredEnv(name: string): string {
	const value = process.env[name];
	if (!value) throw new Error(`${name} is required.`);
	return value;
}

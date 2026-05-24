import { defineChannel } from '@flue/runtime';
import { Hono } from 'hono';

interface DiscordEvents {
	'message.created': {
		deliveryId: string;
		guildId?: string;
		caseId?: string;
		message?: { id?: string; authorId?: string; text?: string };
	};
}

interface DiscordThread {
	channel: 'discord';
	deliveryId: string;
}

const app = new Hono();
const discord = defineChannel<DiscordEvents, DiscordThread>({ app });

app.post('/events', async (c) => {
	const event = await c.req.json<DiscordEvents['message.created']>();
	const result = await discord.emit('message.created', {
		event,
		thread: { channel: 'discord', deliveryId: event.deliveryId },
	});
	return c.json({ accepted: true, ...result }, 202);
});

export default discord;

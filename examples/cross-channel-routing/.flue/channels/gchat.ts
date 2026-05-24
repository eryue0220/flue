import { defineChannel } from '@flue/runtime';
import { Hono } from 'hono';

interface GChatEvents {
	'message.created': {
		deliveryId: string;
		guildId?: string;
		caseId?: string;
		reviewerId?: string;
		message?: string;
	};
}

interface GChatThread {
	channel: 'gchat';
	deliveryId: string;
}

const app = new Hono();
const gchat = defineChannel<GChatEvents, GChatThread>({ app });

app.post('/events', async (c) => {
	const event = await c.req.json<GChatEvents['message.created']>();
	const result = await gchat.emit('message.created', {
		event,
		thread: { channel: 'gchat', deliveryId: event.deliveryId },
	});
	return c.json({ accepted: true, ...result }, 202);
});

export default gchat;

import { Hono } from 'hono';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { defineChannel } from '../src/channels.ts';

interface MessageEvents {
	message: { text: string };
	mention: { userId: string };
}

interface Thread {
	id: string;
}

describe('defineChannel', () => {
	it('creates a typed stateful channel with its Hono application', async () => {
		const app = new Hono();
		const channel = defineChannel<MessageEvents, Thread>({ app });
		const received: string[] = [];

		channel.on('message', async ({ event, thread }) => {
			expectTypeOf(event).toEqualTypeOf<{ text: string }>();
			expectTypeOf(thread).toEqualTypeOf<Thread>();
			received.push(`${thread.id}:${event.text}`);
		});

		const result = await channel.emit('message', { event: { text: 'hello' }, thread: { id: 'thread:1' } });

		expect(channel.app).toBe(app);
		expect(received).toEqual(['thread:1:hello']);
		expect(result).toEqual({ invoked: 1, errors: [] });
	});

	it('isolates listener failures and returns them to the emitter', async () => {
		const channel = defineChannel<MessageEvents, Thread>({});
		const error = new Error('failed');
		const invoked: string[] = [];

		channel.on('message', () => {
			throw error;
		});
		channel.on('message', async ({ event }) => {
			invoked.push(event.text);
		});

		const result = await channel.emit('message', { event: { text: 'handled' }, thread: { id: 'thread:1' } });

		expect(invoked).toEqual(['handled']);
		expect(result).toEqual({ invoked: 2, errors: [error] });
	});

	it('unsubscribes registered listeners without affecting other listeners', async () => {
		const channel = defineChannel<MessageEvents, Thread>({});
		const received: string[] = [];
		const unsubscribe = channel.on('mention', ({ event }) => {
			received.push(`removed:${event.userId}`);
		});
		channel.on('mention', ({ event }) => {
			received.push(`kept:${event.userId}`);
		});
		unsubscribe();

		const result = await channel.emit('mention', { event: { userId: 'user:1' }, thread: { id: 'thread:1' } });

		expect(received).toEqual(['kept:user:1']);
		expect(result).toEqual({ invoked: 1, errors: [] });
	});

	it('temporarily preserves the legacy provider marker overload during migration', () => {
		expect(defineChannel('github')).toEqual({ __flueChannel: true, name: 'github' });
	});
});

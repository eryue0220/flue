import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { flue } from '../src/app.ts';
import { createAgent, defineChannel, dispatch } from '../src/index.ts';
import { configureFlueRuntime, InMemoryDispatchQueue, type DispatchInput } from '../src/internal.ts';

interface GitHubEvents {
	issues: { deliveryId: string; action?: string; payload: Record<string, any> };
}

interface GitHubThread {
	channel: 'github';
	deliveryId: string;
}

describe('authored GitHub webhook channel', () => {
	it('verifies, parses, emits, and dispatches from an agent-owned listener', async () => {
		const dispatches: DispatchInput[] = [];
		const target = createAgent(() => ({ model: false }));
		const github = createGitHubChannel({ webhookSecret: 'secret' });
		const githubApp = requireChannelApp(github.app);
		github.on('issues', async ({ event }) => {
			const repository = event.payload.repository?.full_name;
			const issue = event.payload.issue?.number;
			if (typeof repository !== 'string' || typeof issue !== 'number') return;
			await dispatch(target, {
				id: `repo:${repository}`,
				session: `issue:${issue}`,
				input: { type: 'github.issues', deliveryId: event.deliveryId, action: event.action },
			});
		});
		configureFlueRuntime({
			target: 'node',
			channelApps: { github: githubApp },
			dispatchQueue: new InMemoryDispatchQueue({ process(input) { dispatches.push(input); } }),
			resolveDispatchAgentName: (agent) => agent === target ? 'github-triage' : undefined,
			manifest: { agents: [{ name: 'github-triage', channels: {}, created: true }] },
		});
		const app = new Hono();
		app.route('/', flue());
		const body = JSON.stringify({ action: 'opened', issue: { number: 123 }, repository: { full_name: 'flue/test' } });
		const response = await app.fetch(new Request('http://localhost/channels/github/events', {
			method: 'POST',
			headers: {
				'x-github-delivery': 'delivery-1',
				'x-github-event': 'issues',
				'x-hub-signature-256': await signature('secret', body),
			},
			body,
		}));
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(response.status).toBe(202);
		expect(await response.json()).toEqual({ accepted: true, invoked: 1, errors: [] });
		expect(dispatches[0]).toMatchObject({
			targetAgent: 'github-triage',
			id: 'repo:flue/test',
			session: 'issue:123',
			input: { type: 'github.issues', deliveryId: 'delivery-1', action: 'opened' },
		});
	});

	it('rejects invalid webhook signatures in the channel application', async () => {
		const github = createGitHubChannel({ webhookSecret: 'secret' });
		configureFlueRuntime({ target: 'node', channelApps: { github: requireChannelApp(github.app) } });
		const app = new Hono();
		app.route('/', flue());
		const response = await app.fetch(new Request('http://localhost/channels/github/events', {
			method: 'POST',
			headers: {
				'x-github-delivery': 'delivery-1',
				'x-github-event': 'issues',
				'x-hub-signature-256': 'sha256=bad',
			},
			body: '{}',
		}));

		expect(response.status).toBe(401);
	});
});

function createGitHubChannel(options: { webhookSecret: string }) {
	const app = new Hono();
	const channel = defineChannel<GitHubEvents, GitHubThread>({ app });
	app.post('/events', async (c) => {
		const deliveryId = c.req.header('x-github-delivery');
		const type = c.req.header('x-github-event');
		if (!deliveryId || type !== 'issues') return c.json({ accepted: true, invoked: 0, errors: [] }, 202);
		const body = await c.req.text();
		const supplied = c.req.header('x-hub-signature-256');
		if (!supplied || supplied !== await signature(options.webhookSecret, body)) return c.json({ error: 'unauthorized' }, 401);
		const payload = JSON.parse(body) as Record<string, any>;
		const result = await channel.emit('issues', {
			event: { deliveryId, action: typeof payload.action === 'string' ? payload.action : undefined, payload },
			thread: { channel: 'github', deliveryId },
		});
		return c.json({ accepted: true, ...result }, 202);
	});
	return channel;
}

function requireChannelApp(app: Hono | undefined): Hono {
	if (!app) throw new Error('Channel application missing.');
	return app;
}

async function signature(secret: string, body: string): Promise<string> {
	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	const digest = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
	return `sha256=${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

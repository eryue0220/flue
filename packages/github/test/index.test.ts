import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import {
	createGitHubChannel,
	DuplicateGitHubHandlerError,
	GitHubApiError,
	GitHubRateLimitError,
	GitHubTimeoutError,
	InvalidGitHubConversationKeyError,
	InvalidGitHubInputError,
} from '../src/index.ts';

const encoder = new TextEncoder();

describe('createGitHubChannel()', () => {
	it('accepts GitHub published HMAC vector when the exact body is unchanged', async () => {
		const github = createGitHubChannel({
			webhookSecret: "It's a Secret to Everybody",
			token: 'token',
		});
		const handler = github.routes.webhook();

		const response = await handler(
			new Request('https://example.test/', {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					'x-github-delivery': 'delivery-1',
					'x-github-event': 'ping',
					'x-hub-signature-256':
						'sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17',
				},
				body: 'Hello, World!',
			}),
		);

		expect(response.status).toBe(400);
	});

	it('rejects GitHub published HMAC vector when the exact body changes', async () => {
		const github = createGitHubChannel({
			webhookSecret: "It's a Secret to Everybody",
			token: 'token',
		});
		const handler = github.routes.webhook();

		const response = await handler(
			new Request('https://example.test/', {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					'x-github-delivery': 'delivery-1',
					'x-github-event': 'ping',
					'x-hub-signature-256':
						'sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17',
				},
				body: 'Hello, World!\n',
			}),
		);

		expect(response.status).toBe(401);
	});

	it('invokes the issues.opened handler with normalized delivery metadata when JSON is signed', async () => {
		const github = createGitHubChannel({ webhookSecret: 'secret', token: 'token' });
		const handler = vi.fn();
		github.on('issues.opened', handler);
		const raw = {
			action: 'opened',
			installation: { id: 90 },
			repository: { id: 12, name: 'widgets', owner: { login: 'acme' } },
			issue: { number: 42, title: 'Unicode café', body: null },
		};
		const body = ` {\n  "action": "opened",\n  "installation": { "id": 90 },\n  "repository": { "id": 12, "name": "widgets", "owner": { "login": "acme" } },\n  "issue": { "number": 42, "title": "Unicode café", "body": null }\n} `;

		const response = await github.routes.webhook()(
			await signedRequest({
				secret: 'secret',
				body,
				event: 'issues',
				headers: {
					'x-github-hook-id': '1234',
					'x-github-hook-installation-target-id': '5678',
					'x-github-hook-installation-target-type': 'repository',
				},
			}),
		);

		expect(response.status).toBe(204);
		expect(handler).toHaveBeenCalledOnce();
		expect(handler).toHaveBeenCalledWith({
			type: 'issues.opened',
			deliveryId: 'delivery-1',
			hookId: '1234',
			installationTarget: { id: '5678', type: 'repository' },
			installationId: 90,
			repository: { id: 12, owner: 'acme', name: 'widgets' },
			payload: { issue: { number: 42, title: 'Unicode café', body: null } },
			raw,
		});
	});

	it('invokes the issue_comment.created handler when a form payload is signed', async () => {
		const github = createGitHubChannel({ webhookSecret: 'secret', token: 'token' });
		const handler = vi.fn();
		github.on('issue_comment.created', handler);
		const raw = {
			action: 'created',
			repository: { id: 12, name: 'widgets', owner: { login: 'acme' } },
			issue: { number: 42 },
			comment: { id: 99, body: 'Looks good +1' },
		};
		const body = new URLSearchParams({ payload: JSON.stringify(raw) }).toString();

		const response = await github.routes.webhook()(
			await signedRequest({
				secret: 'secret',
				body,
				event: 'issue_comment',
				contentType: 'application/x-www-form-urlencoded',
			}),
		);

		expect(response.status).toBe(204);
		expect(handler).toHaveBeenCalledWith({
			type: 'issue_comment.created',
			deliveryId: 'delivery-1',
			repository: { id: 12, owner: 'acme', name: 'widgets' },
			payload: {
				issue: { number: 42 },
				comment: { id: 99, body: 'Looks good +1' },
			},
			raw,
		});
	});

	it('invokes the pull_request.opened handler when a valid delivery is received', async () => {
		const github = createGitHubChannel({ webhookSecret: 'secret', token: 'token' });
		const handler = vi.fn();
		github.on('pull_request.opened', handler);
		const raw = {
			action: 'opened',
			repository: { id: 12, name: 'widgets', owner: { login: 'acme' } },
			pull_request: { number: 7, title: 'Add feature', body: 'Details' },
		};

		const response = await github.routes.webhook()(
			await signedRequest({
				secret: 'secret',
				body: JSON.stringify(raw),
				event: 'pull_request',
			}),
		);

		expect(response.status).toBe(204);
		expect(handler).toHaveBeenCalledWith({
			type: 'pull_request.opened',
			deliveryId: 'delivery-1',
			repository: { id: 12, owner: 'acme', name: 'widgets' },
			payload: {
				pullRequest: { number: 7, title: 'Add feature', body: 'Details' },
			},
			raw,
		});
	});

	it('handles a ping internally when its signature is valid', async () => {
		const github = createGitHubChannel({ webhookSecret: 'secret', token: 'token' });

		const response = await github.routes.webhook()(
			await signedRequest({
				secret: 'secret',
				body: JSON.stringify({ zen: 'Keep it logically awesome.' }),
				event: 'ping',
			}),
		);

		expect(response.status).toBe(204);
	});

	it('acknowledges without invoking handlers when an event is unsupported', async () => {
		const github = createGitHubChannel({ webhookSecret: 'secret', token: 'token' });
		const handler = vi.fn();
		github.on('issues.opened', handler);

		const response = await github.routes.webhook()(
			await signedRequest({
				secret: 'secret',
				body: JSON.stringify({ action: 'deleted' }),
				event: 'repository',
			}),
		);

		expect(response.status).toBe(204);
		expect(handler).not.toHaveBeenCalled();
	});

	it('returns 500 when a notification handler fails', async () => {
		const github = createGitHubChannel({ webhookSecret: 'secret', token: 'token' });
		github.on('issues.opened', () => {
			throw new Error('dispatch failed');
		});
		const raw = {
			action: 'opened',
			repository: { id: 12, name: 'widgets', owner: { login: 'acme' } },
			issue: { number: 42, title: 'Bug', body: null },
		};

		const response = await github.routes.webhook()(
			await signedRequest({
				secret: 'secret',
				body: JSON.stringify(raw),
				event: 'issues',
			}),
		);

		expect(response.status).toBe(500);
	});

	it('rejects a duplicate handler when the existing registration is active', () => {
		const github = createGitHubChannel({ webhookSecret: 'secret', token: 'token' });
		const unsubscribe = github.on('issues.opened', () => {});

		expect(() => github.on('issues.opened', () => {})).toThrow(DuplicateGitHubHandlerError);

		unsubscribe();
		unsubscribe();
		expect(() => github.on('issues.opened', () => {})).not.toThrow();
	});

	it('returns protocol errors when the route contract is unsupported', async () => {
		const github = createGitHubChannel({ webhookSecret: 'secret', token: 'token' });
		const handler = github.routes.webhook();

		const methodResponse = await handler(new Request('https://example.test/', { method: 'GET' }));
		const pathResponse = await handler(
			new Request('https://example.test/nested', { method: 'POST' }),
		);
		const contentTypeResponse = await handler(
			new Request('https://example.test/', {
				method: 'POST',
				headers: { 'content-type': 'text/plain' },
				body: '{}',
			}),
		);

		expect(methodResponse.status).toBe(405);
		expect(methodResponse.headers.get('allow')).toBe('POST');
		expect(pathResponse.status).toBe(404);
		expect(contentTypeResponse.status).toBe(415);
	});

	it('rejects a request when its signature is missing or invalid', async () => {
		const github = createGitHubChannel({ webhookSecret: 'secret', token: 'token' });
		const handler = github.routes.webhook();
		const baseHeaders = {
			'content-type': 'application/json',
			'x-github-delivery': 'delivery-1',
			'x-github-event': 'ping',
		};

		const missing = await handler(
			new Request('https://example.test/', { method: 'POST', headers: baseHeaders, body: '{}' }),
		);
		const malformed = await handler(
			new Request('https://example.test/', {
				method: 'POST',
				headers: { ...baseHeaders, 'x-hub-signature-256': 'md5=abc' },
				body: '{}',
			}),
		);
		const wrongLength = await handler(
			new Request('https://example.test/', {
				method: 'POST',
				headers: { ...baseHeaders, 'x-hub-signature-256': 'sha256=abcd' },
				body: '{}',
			}),
		);
		const invalid = await handler(
			new Request('https://example.test/', {
				method: 'POST',
				headers: {
					...baseHeaders,
					'x-hub-signature-256': `sha256=${'0'.repeat(64)}`,
				},
				body: '{}',
			}),
		);

		expect(missing.status).toBe(401);
		expect(malformed.status).toBe(401);
		expect(wrongLength.status).toBe(401);
		expect(invalid.status).toBe(401);
	});

	it('rejects before invoking handlers when a signed payload is malformed', async () => {
		const github = createGitHubChannel({ webhookSecret: 'secret', token: 'token' });
		const handler = vi.fn();
		github.on('issues.opened', handler);

		const invalidJson = await github.routes.webhook()(
			await signedRequest({ secret: 'secret', body: '{', event: 'issues' }),
		);
		const invalidEnvelope = await github.routes.webhook()(
			await signedRequest({
				secret: 'secret',
				body: JSON.stringify({
					action: 'opened',
					repository: { id: 12, name: 'widgets', owner: { login: 'acme' } },
					issue: { number: '42', title: 'Bug', body: null },
				}),
				event: 'issues',
			}),
		);

		expect(invalidJson.status).toBe(400);
		expect(invalidEnvelope.status).toBe(400);
		expect(handler).not.toHaveBeenCalled();
	});

	it('returns 400 when body-parsing middleware already consumed the request', async () => {
		const github = createGitHubChannel({ webhookSecret: 'secret', token: 'token' });
		const request = await signedRequest({
			secret: 'secret',
			body: JSON.stringify({ zen: 'Keep it logically awesome.' }),
			event: 'ping',
		});
		await request.text();

		const response = await github.routes.webhook()(request);

		expect(response.status).toBe(400);
	});

	it('rejects a request when its declared or actual body exceeds the limit', async () => {
		const github = createGitHubChannel({ webhookSecret: 'secret', token: 'token' });
		const handler = github.routes.webhook({ bodyLimit: 4 });

		const declared = await handler(
			new Request('https://example.test/', {
				method: 'POST',
				headers: {
					'content-length': '5',
					'content-type': 'application/json',
				},
				body: '{}',
			}),
		);
		const actual = await handler(
			new Request('https://example.test/', {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					'x-hub-signature-256': `sha256=${'0'.repeat(64)}`,
				},
				body: '12345',
			}),
		);

		expect(declared.status).toBe(413);
		expect(actual.status).toBe(413);
	});

	it('shares registrations when independent unbound-safe handlers are created', async () => {
		const github = createGitHubChannel({ webhookSecret: 'secret', token: 'token' });
		const registeredHandler = vi.fn();
		github.on('issues.opened', registeredHandler);
		const first = github.routes.webhook();
		const second = github.routes.webhook();
		const raw = {
			action: 'opened',
			repository: { id: 12, name: 'widgets', owner: { login: 'acme' } },
			issue: { number: 42, title: 'Bug', body: null },
		};

		const firstResponse = await first(
			await signedRequest({
				secret: 'secret',
				body: JSON.stringify(raw),
				event: 'issues',
				url: 'https://example.test/?source=first',
			}),
		);
		const secondResponse = await second(
			await signedRequest({
				secret: 'secret',
				body: JSON.stringify(raw),
				event: 'issues',
			}),
		);

		expect(first).not.toBe(second);
		expect(firstResponse.status).toBe(204);
		expect(secondResponse.status).toBe(204);
		expect(registeredHandler).toHaveBeenCalledTimes(2);
	});

	it('invokes the handler when Hono rewrites a mounted webhook prefix', async () => {
		const github = createGitHubChannel({ webhookSecret: 'secret', token: 'token' });
		const registeredHandler = vi.fn();
		github.on('issues.opened', registeredHandler);
		const app = new Hono();
		app.mount('/webhooks/github', github.routes.webhook());
		const raw = {
			action: 'opened',
			repository: { id: 12, name: 'widgets', owner: { login: 'acme' } },
			issue: { number: 42, title: 'Bug', body: null },
		};

		const response = await app.fetch(
			await signedRequest({
				secret: 'secret',
				body: JSON.stringify(raw),
				event: 'issues',
				url: 'https://example.test/webhooks/github?source=github',
			}),
		);

		expect(response.status).toBe(204);
		expect(registeredHandler).toHaveBeenCalledOnce();
	});

	it('keeps credentials fixed when the caller mutates the options object', async () => {
		const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 201 }));
		const options = {
			webhookSecret: 'original-secret',
			token: 'original-token',
			fetch,
		};
		const github = createGitHubChannel(options);
		options.webhookSecret = 'mutated-secret';
		options.token = 'mutated-token';

		const ingressResponse = await github.routes.webhook()(
			await signedRequest({
				secret: 'original-secret',
				body: JSON.stringify({ zen: 'Keep it logically awesome.' }),
				event: 'ping',
			}),
		);
		await github.client.commentOnIssue(
			{ owner: 'acme', repo: 'widgets', issueNumber: 42 },
			'Done.',
		);

		expect(ingressResponse.status).toBe(204);
		expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get('authorization')).toBe(
			'Bearer original-token',
		);
	});

	it('round-trips an issue reference when its conversation key is canonical', () => {
		const github = createGitHubChannel({ webhookSecret: 'secret', token: 'token' });
		const ref = { owner: 'with:astro', repo: 'flue/next?#', issueNumber: 42 };
		const key = github.conversationKey(ref);

		expect(key).toBe('github:v1:owner:with%3Aastro:repo:flue%2Fnext%3F%23:issue:42');
		expect(github.parseConversationKey(key)).toEqual(ref);
	});

	it('rejects a conversation key when it is non-canonical or foreign', () => {
		const github = createGitHubChannel({ webhookSecret: 'secret', token: 'token' });

		expect(() =>
			github.parseConversationKey('slack:v1:owner:acme:repo:widgets:issue:42'),
		).toThrow(InvalidGitHubConversationKeyError);
		expect(() =>
			github.parseConversationKey('github:v1:owner:acme:repo:widgets:issue:042'),
		).toThrow(InvalidGitHubConversationKeyError);
		expect(() =>
			github.parseConversationKey('github:v1:owner:acme%2fteam:repo:widgets:issue:42'),
		).toThrow(InvalidGitHubConversationKeyError);
	});
});

describe('GitHubClient', () => {
	it('posts with fixed authentication and API headers when commenting on an issue', async () => {
		const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 201 }));
		const github = createGitHubChannel({
			webhookSecret: 'secret',
			token: 'github-token',
			fetch,
		});

		await github.client.commentOnIssue(
			{ owner: 'with astro', repo: 'flue/next', issueNumber: 42 },
			'Review complete.',
		);

		expect(fetch).toHaveBeenCalledOnce();
		const [input, init] = fetch.mock.calls[0] ?? [];
		expect(String(input)).toBe(
			'https://api.github.com/repos/with%20astro/flue%2Fnext/issues/42/comments',
		);
		expect(init?.method).toBe('POST');
		expect(init?.redirect).toBe('manual');
		const headers = new Headers(init?.headers);
		expect(headers.get('accept')).toBe('application/vnd.github+json');
		expect(headers.get('authorization')).toBe('Bearer github-token');
		expect(headers.get('content-type')).toBe('application/json');
		expect(headers.get('user-agent')).toBe('@flue/github');
		expect(headers.get('x-github-api-version')).toBe('2026-03-10');
		expect(init?.body).toBe(JSON.stringify({ body: 'Review complete.' }));
	});

	it('does not retry when an add-labels write fails', async () => {
		const fetch = vi.fn<typeof globalThis.fetch>(
			async () => new Response(JSON.stringify({ message: 'Service unavailable' }), { status: 503 }),
		);
		const github = createGitHubChannel({
			webhookSecret: 'secret',
			token: 'github-token',
			fetch,
		});

		await expect(
			github.client.addLabels(
				{ owner: 'acme', repo: 'widgets', issueNumber: 42 },
				['triage', 'bug'],
			),
		).rejects.toBeInstanceOf(GitHubApiError);

		expect(fetch).toHaveBeenCalledOnce();
		const [input, init] = fetch.mock.calls[0] ?? [];
		expect(String(input)).toBe('https://api.github.com/repos/acme/widgets/issues/42/labels');
		expect(init?.body).toBe(JSON.stringify({ labels: ['triage', 'bug'] }));
	});

	it('preserves credentials when following a bounded same-origin HTTPS redirect', async () => {
		const fetch = vi
			.fn<typeof globalThis.fetch>()
			.mockResolvedValueOnce(
				new Response(null, {
					status: 307,
					headers: {
						location: 'https://api.github.com/repositories/12/issues/42/comments',
					},
				}),
			)
			.mockResolvedValueOnce(new Response(null, { status: 201 }));
		const github = createGitHubChannel({
			webhookSecret: 'secret',
			token: 'github-token',
			fetch,
		});

		await github.client.commentOnIssue(
			{ owner: 'acme', repo: 'widgets', issueNumber: 42 },
			'Done.',
		);

		expect(fetch).toHaveBeenCalledTimes(2);
		expect(String(fetch.mock.calls[1]?.[0])).toBe(
			'https://api.github.com/repositories/12/issues/42/comments',
		);
		expect(new Headers(fetch.mock.calls[1]?.[1]?.headers).get('authorization')).toBe(
			'Bearer github-token',
		);
	});

	it('does not forward credentials when a redirect leaves the HTTPS API origin', async () => {
		const fetch = vi.fn<typeof globalThis.fetch>(
			async () =>
				new Response(null, {
					status: 307,
					headers: { location: 'https://attacker.example/collect' },
				}),
		);
		const github = createGitHubChannel({
			webhookSecret: 'secret',
			token: 'github-token',
			fetch,
		});

		await expect(
			github.client.commentOnIssue(
				{ owner: 'acme', repo: 'widgets', issueNumber: 42 },
				'Done.',
			),
		).rejects.toMatchObject({ status: 307 });

		expect(fetch).toHaveBeenCalledOnce();
	});

	it('surfaces redacted structured metadata when GitHub rate-limits a request', async () => {
		const fetch = vi.fn<typeof globalThis.fetch>(
			async () =>
				new Response(JSON.stringify({ message: 'token github-token exhausted' }), {
					status: 403,
					headers: {
						'x-github-request-id': 'request-1',
						'x-ratelimit-limit': '5000',
						'x-ratelimit-remaining': '0',
						'x-ratelimit-reset': '1770000000',
						'x-ratelimit-resource': 'core',
					},
				}),
		);
		const github = createGitHubChannel({
			webhookSecret: 'secret',
			token: 'github-token',
			fetch,
		});

		const error = await github.client
			.commentOnIssue({ owner: 'acme', repo: 'widgets', issueNumber: 42 }, 'Done.')
			.catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(GitHubRateLimitError);
		expect(error).toMatchObject({
			status: 403,
			requestId: 'request-1',
			responseMessage: 'token [REDACTED] exhausted',
			rateLimit: {
				limit: 5000,
				remaining: 0,
				resetAt: new Date(1_770_000_000 * 1000).toISOString(),
				resource: 'core',
			},
		});
		expect(String(error)).not.toContain('github-token');
	});

	it('surfaces a structured timeout when the configured deadline expires', async () => {
		const fetch = vi.fn<typeof globalThis.fetch>(
			async (_input, init) =>
				new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), {
						once: true,
					});
				}),
		);
		const github = createGitHubChannel({
			webhookSecret: 'secret',
			token: 'github-token',
			fetch,
			requestTimeoutMs: 5,
		});

		await expect(
			github.client.commentOnIssue(
				{ owner: 'acme', repo: 'widgets', issueNumber: 42 },
				'Done.',
			),
		).rejects.toEqual(new GitHubTimeoutError(5));
	});

	it('surfaces a structured timeout when an error response body stalls', async () => {
		const fetch = vi.fn<typeof globalThis.fetch>(async (_input, init) => {
			const body = new ReadableStream<Uint8Array>({
				start(controller) {
					init?.signal?.addEventListener(
						'abort',
						() => controller.error(init.signal?.reason),
						{ once: true },
					);
				},
			});
			return new Response(body, { status: 500 });
		});
		const github = createGitHubChannel({
			webhookSecret: 'secret',
			token: 'github-token',
			fetch,
			requestTimeoutMs: 5,
		});

		await expect(
			github.client.commentOnIssue(
				{ owner: 'acme', repo: 'widgets', issueNumber: 42 },
				'Done.',
			),
		).rejects.toEqual(new GitHubTimeoutError(5));
	});

	it('surfaces rate-limit metadata when a secondary limit returns Retry-After', async () => {
		const fetch = vi.fn<typeof globalThis.fetch>(
			async () =>
				new Response(JSON.stringify({ message: 'Slow down' }), {
					status: 403,
					headers: {
						'retry-after': '60',
						'x-ratelimit-remaining': '4999',
						'x-ratelimit-reset': '9999999999999999',
					},
				}),
		);
		const github = createGitHubChannel({
			webhookSecret: 'secret',
			token: 'github-token',
			fetch,
		});

		const error = await github.client
			.commentOnIssue({ owner: 'acme', repo: 'widgets', issueNumber: 42 }, 'Done.')
			.catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(GitHubRateLimitError);
		expect(error).toMatchObject({
			status: 403,
			rateLimit: {
				remaining: 4999,
				retryAfterSeconds: 60,
				resetAt: undefined,
			},
		});
	});

	it('propagates the caller reason when the caller cancels a request', async () => {
		const fetch = vi.fn<typeof globalThis.fetch>(
			async (_input, init) =>
				new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), {
						once: true,
					});
				}),
		);
		const github = createGitHubChannel({
			webhookSecret: 'secret',
			token: 'github-token',
			fetch,
			requestTimeoutMs: 1_000,
		});
		const controller = new AbortController();
		const reason = new DOMException('Cancelled by caller.', 'AbortError');

		const request = github.client.commentOnIssue(
			{ owner: 'acme', repo: 'widgets', issueNumber: 42 },
			'Done.',
			controller.signal,
		);
		controller.abort(reason);

		await expect(request).rejects.toBe(reason);
	});

	it('rejects without coercion or a provider request when direct inputs are invalid', async () => {
		const fetch = vi.fn<typeof globalThis.fetch>();
		const github = createGitHubChannel({
			webhookSecret: 'secret',
			token: 'github-token',
			fetch,
		});

		await expect(
			github.client.commentOnIssue(
				{ owner: 'acme', repo: 'widgets', issueNumber: 42 },
				123 as unknown as string,
			),
		).rejects.toBeInstanceOf(InvalidGitHubInputError);
		await expect(
			github.client.addLabels(
				{ owner: 'acme', repo: 'widgets', issueNumber: 42 },
				[] as string[],
			),
		).rejects.toBeInstanceOf(InvalidGitHubInputError);
		expect(fetch).not.toHaveBeenCalled();
	});
});

describe('GitHub tools', () => {
	it('exposes only comment text when a comment tool destination is pre-bound', async () => {
		const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 201 }));
		const github = createGitHubChannel({
			webhookSecret: 'secret',
			token: 'github-token',
			fetch,
		});
		const tool = github.tools.commentOnIssue({
			owner: 'acme',
			repo: 'widgets',
			issueNumber: 42,
		});

		expect(tool.parameters).toEqual({
			type: 'object',
			properties: { text: { type: 'string', minLength: 1 } },
			required: ['text'],
			additionalProperties: false,
		});
		await expect(tool.execute({ text: 'Investigating.' })).resolves.toBe('Comment posted.');
		expect(String(fetch.mock.calls[0]?.[0])).toBe(
			'https://api.github.com/repos/acme/widgets/issues/42/comments',
		);
	});

	it('keeps the original destination when a bound comment reference is mutated', async () => {
		const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 201 }));
		const github = createGitHubChannel({
			webhookSecret: 'secret',
			token: 'github-token',
			fetch,
		});
		const ref = { owner: 'acme', repo: 'widgets', issueNumber: 42 };
		const tool = github.tools.commentOnIssue(ref);
		ref.owner = 'attacker';
		ref.repo = 'redirected';
		ref.issueNumber = 99;

		await tool.execute({ text: 'Investigating.' });

		expect(String(fetch.mock.calls[0]?.[0])).toBe(
			'https://api.github.com/repos/acme/widgets/issues/42/comments',
		);
	});

	it('rejects setup when a label tool receives an invalid trusted reference', async () => {
		const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 200 }));
		const github = createGitHubChannel({
			webhookSecret: 'secret',
			token: 'github-token',
			fetch,
		});
		const tool = github.tools.addLabels({
			owner: 'acme',
			repo: 'widgets',
			issueNumber: 42,
		});

		expect(tool.parameters).toEqual({
			type: 'object',
			properties: {
				labels: {
					type: 'array',
					items: { type: 'string', minLength: 1 },
					minItems: 1,
				},
			},
			required: ['labels'],
			additionalProperties: false,
		});
		await expect(tool.execute({ labels: ['triage'] })).resolves.toBe('Labels added.');
		expect(() =>
			github.tools.addLabels({ owner: 'acme', repo: 'widgets', issueNumber: 0 }),
		).toThrow(InvalidGitHubInputError);
	});
});

interface SignedRequestOptions {
	secret: string;
	body: string;
	event: string;
	contentType?: string;
	headers?: Record<string, string>;
	url?: string;
}

async function signedRequest(options: SignedRequestOptions): Promise<Request> {
	const key = await crypto.subtle.importKey(
		'raw',
		encoder.encode(options.secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign'],
	);
	const signature = new Uint8Array(
		await crypto.subtle.sign('HMAC', key, encoder.encode(options.body)),
	);
	const signatureHex = Array.from(signature, (byte) => byte.toString(16).padStart(2, '0')).join('');
	return new Request(options.url ?? 'https://example.test/', {
		method: 'POST',
		headers: {
			'content-type': options.contentType ?? 'application/json; charset=utf-8',
			'x-github-delivery': 'delivery-1',
			'x-github-event': options.event,
			'x-hub-signature-256': `sha256=${signatureHex}`,
			...options.headers,
		},
		body: options.body,
	});
}

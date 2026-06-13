import {
	GitHubApiError,
	type GitHubRateLimit,
	GitHubRateLimitError,
	GitHubTimeoutError,
	InvalidGitHubInputError,
} from './errors.ts';
import type { GitHubChannelOptions, GitHubClient, GitHubIssueRef } from './index.ts';

const API_ORIGIN = 'https://api.github.com';
const API_VERSION = '2026-03-10';
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;
const MAX_ERROR_BODY_BYTES = 8 * 1024;

export function createGitHubClient(options: GitHubChannelOptions): GitHubClient {
	const fetchImplementation = options.fetch ?? globalThis.fetch;
	const timeoutMs = options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS;
	const token = options.token;

	return {
		async commentOnIssue(ref, text, signal) {
			assertIssueRef(ref);
			if (typeof text !== 'string' || text.length === 0) {
				throw new InvalidGitHubInputError('comment text');
			}
			await request(
				`/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/issues/${ref.issueNumber}/comments`,
				{ body: JSON.stringify({ body: text }), signal },
			);
		},
		async addLabels(ref, labels, signal) {
			assertIssueRef(ref);
			if (
				!Array.isArray(labels) ||
				labels.length === 0 ||
				labels.some((label) => typeof label !== 'string' || label.length === 0)
			) {
				throw new InvalidGitHubInputError('labels');
			}
			await request(
				`/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/issues/${ref.issueNumber}/labels`,
				{ body: JSON.stringify({ labels }), signal },
			);
		},
	};

	async function request(
		path: string,
		init: { body: string; signal?: AbortSignal },
	): Promise<void> {
		let url = new URL(path, API_ORIGIN);
		let redirects = 0;
		const timeoutSignal = AbortSignal.timeout(timeoutMs);
		const signal = init.signal
			? AbortSignal.any([init.signal, timeoutSignal])
			: timeoutSignal;

		try {
			while (true) {
				let response: Response;
				response = await fetchImplementation(url, {
					method: 'POST',
					headers: {
						Accept: 'application/vnd.github+json',
						Authorization: `Bearer ${token}`,
						'Content-Type': 'application/json',
						'User-Agent': '@flue/github',
						'X-GitHub-Api-Version': API_VERSION,
					},
					body: init.body,
					redirect: 'manual',
					signal,
				});

				if (isRedirect(response.status)) {
					const location = response.headers.get('location');
					if (!location || redirects >= MAX_REDIRECTS) {
						throw await apiError(response, token);
					}
					const nextUrl = new URL(location, url);
					if (nextUrl.protocol !== 'https:' || nextUrl.origin !== API_ORIGIN) {
						throw await apiError(response, token);
					}
					void response.body?.cancel();
					url = nextUrl;
					redirects += 1;
					continue;
				}

				if (response.ok) {
					void response.body?.cancel();
					return;
				}
				throw await apiError(response, token);
			}
		} catch (error) {
			if (timeoutSignal.aborted && !init.signal?.aborted) {
				throw new GitHubTimeoutError(timeoutMs);
			}
			throw error;
		}
	}
}

function assertIssueRef(ref: GitHubIssueRef): void {
	if (!ref || typeof ref !== 'object') throw new InvalidGitHubInputError('ref');
	if (typeof ref.owner !== 'string' || ref.owner.length === 0 || ref.owner.trim() !== ref.owner) {
		throw new InvalidGitHubInputError('owner');
	}
	if (typeof ref.repo !== 'string' || ref.repo.length === 0 || ref.repo.trim() !== ref.repo) {
		throw new InvalidGitHubInputError('repo');
	}
	if (!Number.isSafeInteger(ref.issueNumber) || ref.issueNumber <= 0) {
		throw new InvalidGitHubInputError('issueNumber');
	}
}

function isRedirect(status: number): boolean {
	return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

async function apiError(response: Response, token: string): Promise<GitHubApiError> {
	const rateLimit = parseRateLimit(response.headers);
	const options = {
		status: response.status,
		requestId: response.headers.get('x-github-request-id') ?? undefined,
		responseMessage: await readErrorMessage(response, token),
		rateLimit,
	};
	return isRateLimited(response.status, rateLimit)
		? new GitHubRateLimitError(options)
		: new GitHubApiError(options);
}

function parseRateLimit(headers: Headers): GitHubRateLimit | undefined {
	const limit = parseNonNegativeInteger(headers.get('x-ratelimit-limit'));
	const remaining = parseNonNegativeInteger(headers.get('x-ratelimit-remaining'));
	const reset = parseNonNegativeInteger(headers.get('x-ratelimit-reset'));
	const retryAfterSeconds = parseNonNegativeInteger(headers.get('retry-after'));
	const resource = headers.get('x-ratelimit-resource') ?? undefined;
	if (
		limit === undefined &&
		remaining === undefined &&
		reset === undefined &&
		retryAfterSeconds === undefined &&
		resource === undefined
	) {
		return undefined;
	}
	return {
		limit,
		remaining,
		resetAt: reset === undefined ? undefined : toIsoTimestamp(reset),
		retryAfterSeconds,
		resource,
	};
}

function isRateLimited(status: number, rateLimit: GitHubRateLimit | undefined): boolean {
	return (
		status === 429 ||
		(status === 403 &&
			(rateLimit?.remaining === 0 || rateLimit?.retryAfterSeconds !== undefined))
	);
}

function parseNonNegativeInteger(value: string | null): number | undefined {
	if (value === null || !/^\d+$/.test(value)) return undefined;
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function toIsoTimestamp(seconds: number): string | undefined {
	const date = new Date(seconds * 1000);
	return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

async function readErrorMessage(response: Response, token: string): Promise<string | undefined> {
	const bytes = await readBoundedBody(response, MAX_ERROR_BODY_BYTES);
	const text = new TextDecoder().decode(bytes).trim();
	if (!text) return undefined;
	try {
		const parsed: unknown = JSON.parse(text);
		if (
			typeof parsed === 'object' &&
			parsed !== null &&
			typeof (parsed as { message?: unknown }).message === 'string'
		) {
			return redact((parsed as { message: string }).message, token).slice(0, 1_000);
		}
	} catch {
		// A bounded plain-text response is still useful provider metadata.
	}
	return redact(text, token).slice(0, 1_000);
}

function redact(value: string, token: string): string {
	return token.length === 0 ? value : value.split(token).join('[REDACTED]');
}

async function readBoundedBody(response: Response, limit: number): Promise<Uint8Array> {
	if (!response.body) return new Uint8Array();
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			const remaining = limit - total;
			const chunk = value.byteLength > remaining ? value.subarray(0, remaining) : value;
			chunks.push(chunk);
			total += chunk.byteLength;
			if (value.byteLength >= remaining) {
				void reader.cancel();
				break;
			}
		}
	} finally {
		reader.releaseLock();
	}
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}

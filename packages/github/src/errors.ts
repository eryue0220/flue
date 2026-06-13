import type { GitHubEventName } from './index.ts';

export interface GitHubRateLimit {
	limit?: number;
	remaining?: number;
	resetAt?: string;
	retryAfterSeconds?: number;
	resource?: string;
}

export class DuplicateGitHubHandlerError extends Error {
	readonly event: GitHubEventName;

	constructor(event: GitHubEventName) {
		super(`A GitHub handler is already registered for "${event}".`);
		this.name = 'DuplicateGitHubHandlerError';
		this.event = event;
	}
}

export class InvalidGitHubConversationKeyError extends Error {
	constructor() {
		super('Invalid GitHub conversation key.');
		this.name = 'InvalidGitHubConversationKeyError';
	}
}

export class InvalidGitHubInputError extends TypeError {
	readonly field: string;

	constructor(field: string) {
		super(`Invalid GitHub ${field}.`);
		this.name = 'InvalidGitHubInputError';
		this.field = field;
	}
}

export interface GitHubApiErrorOptions {
	status: number;
	requestId?: string;
	responseMessage?: string;
	rateLimit?: GitHubRateLimit;
}

export class GitHubApiError extends Error {
	readonly status: number;
	readonly requestId?: string;
	readonly responseMessage?: string;
	readonly rateLimit?: GitHubRateLimit;

	constructor(options: GitHubApiErrorOptions) {
		super(`GitHub API request failed with status ${options.status}.`);
		this.name = 'GitHubApiError';
		this.status = options.status;
		this.requestId = options.requestId;
		this.responseMessage = options.responseMessage;
		this.rateLimit = options.rateLimit;
	}
}

export class GitHubRateLimitError extends GitHubApiError {
	constructor(options: GitHubApiErrorOptions) {
		super(options);
		this.name = 'GitHubRateLimitError';
	}
}

export class GitHubTimeoutError extends Error {
	readonly timeoutMs: number;

	constructor(timeoutMs: number) {
		super(`GitHub API request timed out after ${timeoutMs}ms.`);
		this.name = 'GitHubTimeoutError';
		this.timeoutMs = timeoutMs;
	}
}

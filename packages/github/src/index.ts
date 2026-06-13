import { defineTool, type ToolDefinition } from '@flue/runtime';

export interface GitHubChannelOptions {
	webhookSecret: string;
	token: string;
}

export interface GitHubIssueRef {
	owner: string;
	repo: string;
	issueNumber: number;
}

export interface GitHubRepositoryRef {
	owner: string;
	name: string;
}

export interface GitHubIssuesOpenedPayload {
	issue: { number: number; title: string; body: string | null };
}

export interface GitHubIssueCommentCreatedPayload {
	issue: { number: number };
	comment: { id: number; body: string };
}

export interface GitHubPullRequestOpenedPayload {
	pullRequest: { number: number; title: string; body: string | null };
}

export interface GitHubWebhookEvent<TPayload> {
	type: string;
	deliveryId: string;
	installationId?: number;
	repository: GitHubRepositoryRef;
	payload: TPayload;
	raw: unknown;
}

export interface GitHubEvents {
	'issues.opened': GitHubWebhookEvent<GitHubIssuesOpenedPayload>;
	'issue_comment.created': GitHubWebhookEvent<GitHubIssueCommentCreatedPayload>;
	'pull_request.opened': GitHubWebhookEvent<GitHubPullRequestOpenedPayload>;
}

export type GitHubEventName = keyof GitHubEvents;
export type GitHubNotificationHandler<TEvent> = (event: TEvent) => void | Promise<void>;
export type GitHubRouteHandler = (request: Request) => Promise<Response>;

export interface GitHubWebhookRouteOptions {
	bodyLimit?: number;
}

export interface GitHubClient {
	commentOnIssue(ref: GitHubIssueRef, text: string, signal?: AbortSignal): Promise<void>;
	addLabels(ref: GitHubIssueRef, labels: string[], signal?: AbortSignal): Promise<void>;
}

export class InvalidGitHubConversationKeyError extends Error {
	constructor() {
		super('Invalid GitHub conversation key.');
		this.name = 'InvalidGitHubConversationKeyError';
	}
}

export interface GitHubChannel {
	readonly routes: {
		webhook(options?: GitHubWebhookRouteOptions): GitHubRouteHandler;
	};
	readonly client: GitHubClient;
	readonly tools: {
		commentOnIssue(ref: GitHubIssueRef): ToolDefinition;
		addLabels(ref: GitHubIssueRef): ToolDefinition;
	};
	on<TKey extends GitHubEventName>(
		type: TKey,
		handler: GitHubNotificationHandler<GitHubEvents[TKey]>,
	): () => void;
	conversationKey(ref: GitHubIssueRef): string;
	parseConversationKey(id: string): GitHubIssueRef;
}

export function createGitHubChannel(options: GitHubChannelOptions): GitHubChannel {
	validateOptions(options);
	const handlers = new Map<GitHubEventName, Map<symbol, GitHubNotificationHandler<GitHubEvents[GitHubEventName]>>>();
	const client: GitHubClient = {
		async commentOnIssue() {
			throw new Error('@flue/github client is not implemented yet.');
		},
		async addLabels() {
			throw new Error('@flue/github client is not implemented yet.');
		},
	};

	return {
		routes: {
			webhook: (_routeOptions) => async () =>
				new Response('@flue/github webhook route is not implemented yet.', { status: 501 }),
		},
		client,
		tools: {
			commentOnIssue: (ref) =>
				defineTool({
					name: 'github_comment_on_issue',
					description: 'Post a comment to the bound GitHub issue or pull request.',
					parameters: {
						type: 'object',
						properties: { text: { type: 'string' } },
						required: ['text'],
						additionalProperties: false,
					},
					execute: async ({ text }, signal) => {
						await client.commentOnIssue(ref, String(text), signal);
						return 'Comment posted.';
					},
				}),
			addLabels: (ref) =>
				defineTool({
					name: 'github_add_labels',
					description: 'Add labels to the bound GitHub issue or pull request.',
					parameters: {
						type: 'object',
						properties: { labels: { type: 'array', items: { type: 'string' } } },
						required: ['labels'],
						additionalProperties: false,
					},
					execute: async ({ labels }, signal) => {
						await client.addLabels(ref, labels as string[], signal);
						return 'Labels added.';
					},
				}),
		},
		on(type, handler) {
			const registrations = handlers.get(type) ?? new Map();
			const registration = Symbol(type);
			registrations.set(registration, handler as GitHubNotificationHandler<GitHubEvents[GitHubEventName]>);
			handlers.set(type, registrations);
			return () => registrations.delete(registration);
		},
		conversationKey(ref) {
			assertIssueRef(ref);
			return `github:v1:owner:${encodeURIComponent(ref.owner)}:repo:${encodeURIComponent(ref.repo)}:issue:${ref.issueNumber}`;
		},
		parseConversationKey(id) {
			try {
				const match = /^github:v1:owner:([^:]+):repo:([^:]+):issue:([1-9]\d*)$/.exec(id);
				const owner = match?.[1];
				const repo = match?.[2];
				const issueNumberText = match?.[3];
				if (!owner || !repo || !issueNumberText) throw new InvalidGitHubConversationKeyError();
				const ref = {
					owner: decodeURIComponent(owner),
					repo: decodeURIComponent(repo),
					issueNumber: Number(issueNumberText),
				};
				assertIssueRef(ref);
				if (this.conversationKey(ref) !== id) throw new InvalidGitHubConversationKeyError();
				return ref;
			} catch (error) {
				if (error instanceof InvalidGitHubConversationKeyError) throw error;
				throw new InvalidGitHubConversationKeyError();
			}
		},
	};
}

function validateOptions(options: GitHubChannelOptions): void {
	if (!options.webhookSecret || !options.token) throw new Error('@flue/github requires webhookSecret and token.');
}

function assertIssueRef(ref: GitHubIssueRef): void {
	if (!ref.owner || !ref.repo || !Number.isSafeInteger(ref.issueNumber) || ref.issueNumber <= 0) {
		throw new InvalidGitHubConversationKeyError();
	}
}

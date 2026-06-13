import { createGitHubChannel } from '@flue/github';
import { dispatch } from '@flue/runtime';
import assistant from '../agents/assistant.ts';

export const github = createGitHubChannel({
	webhookSecret: requiredEnv('GITHUB_WEBHOOK_SECRET'),
	token: requiredEnv('GITHUB_TOKEN'),
});

github.on('issues.opened', async (event) => {
	const issue = {
		owner: event.repository.owner,
		repo: event.repository.name,
		issueNumber: event.payload.issue.number,
	};
	await dispatch(assistant, {
		id: github.conversationKey(issue),
		input: {
			type: 'github.issues.opened',
			deliveryId: event.deliveryId,
			installationId: event.installationId,
			issue,
			title: event.payload.issue.title,
			body: event.payload.issue.body,
		},
	});
});

github.on('pull_request.opened', async (event) => {
	const pullRequest = {
		owner: event.repository.owner,
		repo: event.repository.name,
		issueNumber: event.payload.pullRequest.number,
	};
	await dispatch(assistant, {
		id: github.conversationKey(pullRequest),
		input: {
			type: 'github.pull_request.opened',
			deliveryId: event.deliveryId,
			installationId: event.installationId,
			pullRequest,
			title: event.payload.pullRequest.title,
			body: event.payload.pullRequest.body,
		},
	});
});

function requiredEnv(name: string): string {
	const value = process.env[name];
	if (!value) throw new Error(`${name} is required.`);
	return value;
}

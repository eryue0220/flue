# `@flue/github`

First-party GitHub webhook and outbound-tool integration for Flue.

```ts
import { createGitHubChannel } from '@flue/github';

const github = createGitHubChannel({
	webhookSecret: process.env.GITHUB_WEBHOOK_SECRET!,
	token: process.env.GITHUB_TOKEN!,
});

github.on('issues.opened', async (event) => {
	// Choose the agent, instance id, and dispatched input in application code.
});

app.mount('/webhooks/github', github.routes.webhook());
```

The webhook route verifies the exact request bytes before parsing JSON or
form-encoded payloads. Mount it before body-parsing middleware. Supported
notifications are `issues.opened`, `issue_comment.created`, and
`pull_request.opened`; verified `ping` and unknown event/action combinations
are acknowledged without invoking application handlers.

Successful acknowledgement waits for the registered handler to complete.
GitHub expects webhook responses within 10 seconds and does not automatically
retry failed deliveries. Use the surfaced `deliveryId` for application-owned
idempotency and GitHub's manual redelivery flow when needed.

`github.client` exposes issue/PR comment and label writes. `github.tools`
creates the same operations with a trusted issue destination pre-bound so the
model controls only the comment text or labels. Conversation keys are stable
identifiers, not authorization capabilities.

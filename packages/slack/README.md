# `@flue/slack`

Verified Slack Events API, interactivity, and slash-command ingress for Flue
applications.

```ts
import { createSlackChannel } from '@flue/slack';

export const channel = createSlackChannel({
  signingSecret: process.env.SLACK_SIGNING_SECRET!,
  appId: process.env.SLACK_APP_ID!,
  teamId: process.env.SLACK_TEAM_ID!,

  // Path: /channels/slack/events
  async events({ event }) {
    await handleEvent(event);
  },

  // Omit this callback to omit the route.
  // Path: /channels/slack/interactions
  async interactions({ interaction }) {
    await handleInteraction(interaction);
  },

  // Omit this callback to omit the route.
  // Path: /channels/slack/commands
  async commands({ c, command }) {
    return c.json({ response_type: 'ephemeral', text: `Received ${command.command}` });
  },
});
```

Place this export in `channels/slack.ts`. Flue discovers configured surfaces at
`/channels/slack/events`, `/channels/slack/interactions`, and
`/channels/slack/commands` relative to the `flue()` mount. At least one
callback is required.

The package verifies exact request bytes and Slack's timestamp window, handles
Slack's identity-free URL verification challenge internally, checks configured
app and workspace identity where the payload supplies it, and normalizes known
and unknown verified payloads. Returning nothing produces an empty `200`; JSON
values, Slack view-validation bodies, and ordinary Hono responses are
supported.

This package does not include an outbound Slack client or model tools. Run
`flue add slack` to generate editable project code using the Slack Web API or a
target-compatible Fetch client and application-owned `defineTool(...)` values.

Conversation keys are stable thread identifiers, not authorization
capabilities. The package is stateless and does not deduplicate Events API
retries.

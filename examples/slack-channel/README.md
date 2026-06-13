# Slack channel example

Review scaffold for separate Events API and interactivity routes, explicit dispatch routing, conversation identity, and pre-scoped Slack tools. Provider ingress and clients are implemented in later phases.

`SLACK_SIGNING_SECRET`, `SLACK_BOT_TOKEN`, `SLACK_APP_ID`, and `SLACK_TEAM_ID` are required when the built application starts. Builds and type checks do not require live credentials.

The channel module imports the agent and the agent imports the channel. This cycle is safe only because dispatch and tool access are deferred into handlers and the agent initializer. A routing module that imports both can avoid the cycle.

Conversation keys validate syntax, not authorization. This agent is intentionally dispatch-only. Any direct agent route must independently authorize the caller-selected instance id before deriving outbound tools from it.

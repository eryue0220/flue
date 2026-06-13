# GitHub channel example

Review scaffold for webhook mounting, explicit dispatch routing, conversation identity, and pre-scoped GitHub tools. Provider ingress and clients are implemented in later phases.

`GITHUB_WEBHOOK_SECRET` and `GITHUB_TOKEN` are required when the built application starts. Builds and type checks do not require live credentials.

The channel module imports the agent and the agent imports the channel. This cycle is safe only because dispatch and tool access are deferred into handlers and the agent initializer. A routing module that imports both can avoid the cycle.

Conversation keys validate syntax, not authorization. This agent is intentionally dispatch-only. Any direct agent route must independently authorize the caller-selected instance id before deriving outbound tools from it.

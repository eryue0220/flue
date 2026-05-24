import { createAgent, defineAgentProfile, http } from '@flue/runtime';

export const channels = [http()];

const sessionTest = defineAgentProfile({
	instructions: 'You are a test agent for session-oriented message delivery.',
});

export default createAgent(() => ({ profile: sessionTest }));

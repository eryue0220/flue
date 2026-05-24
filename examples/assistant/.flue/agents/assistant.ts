import { createAgent, defineAgentProfile, http } from '@flue/runtime';

export const channels = [http()];

const assistant = defineAgentProfile({
	instructions: 'You complete task requests submitted directly to this agent.',
});

export default createAgent(() => ({ profile: assistant }));

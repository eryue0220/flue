import { createAgent, defineAgentProfile, http } from '@flue/runtime';

export const channels = [http()];

const cloudflareBinding = defineAgentProfile({
	model: 'cloudflare/@cf/moonshotai/kimi-k2.6',
	instructions: 'You process direct requests using a Cloudflare Workers AI binding.',
});

export default createAgent(() => ({ profile: cloudflareBinding }));

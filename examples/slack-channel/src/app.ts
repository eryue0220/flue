import { flue } from '@flue/runtime/routing';
import { Hono } from 'hono';
import { slack } from './channels/slack.ts';

const app = new Hono();

app.mount('/webhooks/slack/events', slack.routes.events());
app.mount('/webhooks/slack/interactions', slack.routes.interactions());
app.route('/', flue());

export default app;

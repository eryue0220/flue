import { flue } from '@flue/runtime/routing';
import { Hono } from 'hono';
import { github } from './channels/github.ts';

const app = new Hono();

app.mount('/webhooks/github', github.routes.webhook());
app.route('/', flue());

export default app;

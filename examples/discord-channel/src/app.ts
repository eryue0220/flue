import { flue } from '@flue/runtime/routing';
import { Hono } from 'hono';
import { discord } from './channels/discord.ts';

const app = new Hono();

app.mount('/webhooks/discord', discord.routes.interactions());
app.route('/', flue());

export default app;

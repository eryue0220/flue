import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { build } from '../../cli/src/lib/build.ts';
import type { BuildPlugin } from '../../cli/src/lib/types.ts';

const discoveryOnlyPlugin: BuildPlugin = {
	name: 'discovery-only',
	bundle: 'none',
	entryFilename: 'server.mjs',
	generateEntryPoint(ctx) {
		return `export default ${JSON.stringify({
			agents: ctx.agents.map((agent) => agent.name),
			workflows: ctx.workflows.map((workflow) => workflow.name),
		})};\n`;
	},
};

describe('build discovery outputs', () => {
	it('discovers modules without emitting a disk manifest', async () => {
		const root = createFixtureRoot('flue-discovery-output-');
		fs.mkdirSync(path.join(root, 'agents'));
		fs.mkdirSync(path.join(root, 'workflows'));
		fs.writeFileSync(path.join(root, 'agents', 'assistant.ts'), `export const arbitrary = true;\n`);
		fs.writeFileSync(path.join(root, 'workflows', 'job.ts'), `export default 'ordinary module';\n`);

		await expect(build({ root, plugin: discoveryOnlyPlugin })).resolves.toEqual({ changed: true });
		expect(fs.existsSync(path.join(root, 'dist', 'manifest.json'))).toBe(false);
		expect(fs.readFileSync(path.join(root, 'dist', 'server.mjs'), 'utf-8')).toContain('assistant');
		expect(fs.readFileSync(path.join(root, 'dist', 'server.mjs'), 'utf-8')).toContain('job');
	});

	it('removes obsolete disk manifests from previous builds', async () => {
		const root = createFixtureRoot('flue-obsolete-manifest-');
		fs.mkdirSync(path.join(root, 'agents'));
		fs.mkdirSync(path.join(root, 'dist'));
		fs.writeFileSync(path.join(root, 'agents', 'assistant.ts'), `export default null;\n`);
		fs.writeFileSync(path.join(root, 'dist', 'manifest.json'), '{}');

		await build({ root, plugin: discoveryOnlyPlugin });
		expect(fs.existsSync(path.join(root, 'dist', 'manifest.json'))).toBe(false);
	});
});

function createFixtureRoot(prefix: string): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

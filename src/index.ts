import type {ModApi} from '@commandcode/harness';
import {registerCommands} from './commands.js';
import {registerGuardrails} from './guardrails.js';
import {refreshStatus, refreshStatusDeferred} from './status.js';

export default function (cmd: ModApi): void {
	cmd.hooks({
		onSessionStart: () => {
			refreshStatusDeferred(cmd);
		},
		onSessionEnd: () => {
			cmd.ui.setStatus(null);
		},
		afterToolCall: () => {
			void refreshStatus(cmd);
			return undefined;
		},
	});

	registerGuardrails(cmd);

	cmd.addFlag('style', {
		type: 'string',
		description: 'Commit message style: conventional or gitmoji.',
	});
	cmd.addFlag('sign', {
		type: 'boolean',
		description: 'Sign commits with GPG (-S).',
	});
	cmd.addFlag('push', {
		type: 'boolean',
		description: 'Push the branch after committing.',
	});
	cmd.addFlag('status', {
		type: 'boolean',
		description: 'Show dirty git state in the footer.',
	});
	cmd.addFlag('shortcut', {
		type: 'boolean',
		description: 'Alt+C shortcut triggers /commit.',
	});
	registerCommands(cmd);
}

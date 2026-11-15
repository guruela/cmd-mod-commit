import type {ModApi} from '@commandcode/harness';
import {STORE_KEY, type CommitFlags, normalizeStyle, readStored} from './flags.js';
import {refreshStatus} from './status.js';

export const CONFIG_PANE_ID = 'config';

type ToggleKey = 'sign' | 'push' | 'status' | 'shortcut';

const TOGGLES: {key: ToggleKey; description: string}[] = [
	{key: 'sign', description: 'GPG-sign commits (-S)'},
	{key: 'push', description: 'Push the branch after committing'},
	{key: 'status', description: 'Show the dirty git state in the footer'},
	{key: 'shortcut', description: 'alt+c triggers /commit'},
];

const STYLE_OPTIONS = [
	{label: 'conventional', value: 'conventional'},
	{label: 'gitmoji', value: 'gitmoji'},
] as const;

const STYLE_HINTS: Record<string, string> = {
	conventional: 'type(scope): description',
	gitmoji: 'emoji prefix + conventional',
};

async function setStyle(cmd: ModApi, value: string): Promise<void> {
	const next: CommitFlags = {...readStored(cmd), style: normalizeStyle(value)};
	await cmd.store.set(STORE_KEY, next);
	cmd.ui.refreshWidgets();
}

async function toggleFlag(cmd: ModApi, key: ToggleKey): Promise<void> {
	const next: CommitFlags = {...readStored(cmd)};
	next[key] = !next[key];
	await cmd.store.set(STORE_KEY, next);
	if (key === 'status') await refreshStatus(cmd);
	cmd.ui.refreshWidgets();
}

async function resetFlags(cmd: ModApi): Promise<void> {
	await cmd.store.delete(STORE_KEY);
	await refreshStatus(cmd);
	cmd.ui.refreshWidgets();
	cmd.ui.toast('Commit options reset to defaults');
}

export function registerPane(cmd: ModApi): void {
	cmd.ui.pane({
		id: CONFIG_PANE_ID,
		title: 'Commit settings',
		render: () => {
			const flags = readStored(cmd);
			return [
				{
					type: 'markdown',
					text: 'Applied to `/commit`, the `commit` tool, and `alt+c`. Changes save immediately.',
				},
				'',
				{type: 'text', text: 'commit style:', bold: true},
				{
					type: 'select',
					key: 'style',
					options: [...STYLE_OPTIONS],
					value: flags.style,
					onSelect: value => {
						void setStyle(cmd, value);
					},
				},
				{type: 'text', text: `  ${STYLE_HINTS[flags.style] ?? ''}`, dim: true},
				'',
				...TOGGLES.flatMap(toggle => [
					{type: 'text', text: `${toggle.key}:`, bold: true},
					{
						type: 'button' as const,
						key: toggle.key,
						label: flags[toggle.key] ? 'on' : 'off',
						onPress: () => {
							void toggleFlag(cmd, toggle.key);
						},
					},
					{type: 'text', text: `  ${toggle.description}`, dim: true},
					'',
				]),
				{type: 'divider'},
				'',
				{
					type: 'button',
					key: 'reset',
					label: 'Reset to defaults',
					onPress: () => {
						void resetFlags(cmd);
					},
				},
				{type: 'text', text: '  Back to the default options', dim: true},
				'',
				{
					type: 'button',
					key: 'close',
					label: 'Close',
					onPress: () => {
						cmd.ui.closePane(CONFIG_PANE_ID);
					},
				},
			];
		},
	});

	// The pane lingers after Esc hands focus back to the prompt (host behavior), so close
	// it once the next message actually runs.
	cmd.on('run_start', () => {
		cmd.ui.closePane(CONFIG_PANE_ID);
	});
}

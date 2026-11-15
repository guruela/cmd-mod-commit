import type {ModApi} from '@commandcode/harness';
import {STORE_KEY, flagsSummary, normalizeBool, normalizeStyle, readFlags, readStored} from './flags.js';
import {runCommit} from './commit.js';
import {refreshStatus} from './status.js';
import {CONFIG_PANE_ID} from './pane.js';

export function registerCommands(cmd: ModApi): void {
	cmd.addCommand({
		name: 'commit:config',
		description: 'Show and change /commit options (style, sign, push, status, shortcut)',
		argumentHint: '[show|reset|key=value ...]',
		handler: async ({args, ui}) => {
			const rest = args.trim();

			if (rest === '') {
				ui.openPane(CONFIG_PANE_ID, {focus: true});
				return undefined;
			}

			if (rest.toLowerCase() === 'show') {
				const flags = readFlags(cmd);
				const stored = readStored(cmd);
				return {
					message: [
						'/commit options:',
						`- style: ${flags.style} (stored: ${stored.style})`,
						`- sign: ${flags.sign ? 'on' : 'off'} (stored: ${stored.sign ? 'on' : 'off'})`,
						`- push: ${flags.push ? 'on' : 'off'} (stored: ${stored.push ? 'on' : 'off'})`,
						`- status: ${flags.status ? 'on' : 'off'} (stored: ${stored.status ? 'on' : 'off'})`,
						`- shortcut: ${flags.shortcut ? 'on' : 'off'} (stored: ${stored.shortcut ? 'on' : 'off'})`,
					].join('\n'),
				};
			}

			if (rest.toLowerCase() === 'reset') {
				await cmd.store.delete(STORE_KEY);
				await refreshStatus(cmd);
				return {message: 'Options reset to defaults (conventional, sign off, push off, status on, shortcut on).'};
			}

			const updates: Partial<import('./flags.js').CommitFlags> = {};
			for (const part of rest.split(/\s+/)) {
				const eq = part.indexOf('=');
				if (eq <= 0) return {message: `Could not parse "${part}" — use key=value (e.g. style=gitmoji sign=true).`};
				const key = part.slice(0, eq).toLowerCase();
				const value = part.slice(eq + 1);
				if (key === 'style') {
					if (!['conventional', 'gitmoji'].includes(value.toLowerCase())) {
						return {message: `Unknown style "${value}" — use conventional or gitmoji.`};
					}
					updates.style = normalizeStyle(value);
				} else if (key === 'sign' || key === 'push' || key === 'status' || key === 'shortcut') {
					const b = normalizeBool(value);
					if (b === undefined) return {message: `Unknown value "${value}" for ${key} — use true or false.`};
					updates[key] = b;
				} else {
					return {message: `Unknown option "${key}" — options are style, sign, push, status, shortcut.`};
				}
			}
			await cmd.store.set(STORE_KEY, {...readStored(cmd), ...updates});
			if (updates.status !== undefined) await refreshStatus(cmd);
			return {message: `Saved: ${flagsSummary({...readFlags(cmd), ...updates})}.`};
		},
	});

	cmd.addCommand({
		name: 'commit',
		description: 'Commit working changes in small incremental stages with Commitizen-style messages',
		argumentHint: '[message]',
		handler: async ({args, cwd, exec}) => {
			return runCommit({hint: args.trim(), cwd, exec, flags: readFlags(cmd)});
		},
	});

	cmd.addShortcut('alt+c', {
		description: 'Trigger /commit',
		handler: async ({cwd, exec}) => {
			if (!readFlags(cmd).shortcut) return undefined;
			return runCommit({hint: '', cwd, exec, flags: readFlags(cmd)});
		},
	});
}

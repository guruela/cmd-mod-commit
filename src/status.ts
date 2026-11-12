import type {ModApi} from '@commandcode/harness';
import {STORE_KEY, type CommitFlags} from './flags.js';

export async function dirtyStatus(cmd: ModApi, cwd?: string): Promise<string | null> {
	let out;
	try {
		out = await cmd.exec({command: 'git', args: ['status', '--porcelain=v1', '-b', '-uall'], cwd});
	} catch {
		return null;
	}
	if (out.code !== 0) return null;
	const lines = out.stdout
		.split('\n')
		.map(l => l.trimEnd())
		.filter(l => l.trim() !== '');
	const header = lines.find(l => l.startsWith('##')) ?? '';
	const files = lines
		.filter(l => !l.startsWith('##'))
		.map(l => {
			const rest = l.length > 3 ? l.slice(3).trim() : '';
			const arrow = rest.indexOf(' -> ');
			return arrow >= 0 ? rest.slice(arrow + 4).trim() : rest;
		})
		.filter(Boolean);

	let ahead = 0;
	let behind = 0;
	let hasUpstream = false;
	const bracket = header.match(/\[(.+)\]/);
	if (bracket) {
		const inside = bracket[1] ?? '';
		if (!/gone/.test(inside)) {
			hasUpstream = true;
			const a = inside.match(/ahead (\d+)/);
			const b = inside.match(/behind (\d+)/);
			if (a) ahead = Number.parseInt(a[1] ?? '0', 10) || 0;
			if (b) behind = Number.parseInt(b[1] ?? '0', 10) || 0;
		}
	} else if (header.includes('...')) {
		hasUpstream = true;
	}
	if (hasUpstream && ahead === 0 && behind === 0 && header.includes('...')) {
		try {
			const c = await cmd.exec({command: 'git', args: ['rev-list', '--left-right', '--count', 'HEAD...@{u}'], cwd});
			if (c.code === 0) {
				const [aStr, bStr] = c.stdout.trim().split(/\s+/);
				ahead = Number.parseInt(aStr ?? '0', 10) || 0;
				behind = Number.parseInt(bStr ?? '0', 10) || 0;
			} else {
				hasUpstream = false;
			}
		} catch {
			hasUpstream = false;
		}
	}

	let branch = '';
	try {
		const b = await cmd.exec({command: 'git', args: ['branch', '--show-current'], cwd});
		if (b.code === 0 && b.stdout.trim()) branch = b.stdout.trim();
	} catch {
		branch = '';
	}
	if (!branch) {
		const h = header.replace(/^##\s*/, '');
		branch = h.split('...')[0]?.trim() || h.trim() || '(detached)';
	}

	const shown = files.slice(0, 3);
	const restCount = files.length - shown.length;
	const filePart =
		files.length > 0 ? ` ● ${files.length} ${shown.join(', ')}${restCount > 0 ? ` +${restCount} more` : ''}` : '';
	let syncPart = '';
	if (hasUpstream) {
		if (ahead > 0 && behind > 0) syncPart = ` ↑${ahead} ↓${behind}`;
		else if (ahead > 0) syncPart = ` ↑${ahead}`;
		else if (behind > 0) syncPart = ` ↓${behind}`;
		else syncPart = ' =';
	}

	return `  ${branch}${filePart}${syncPart}`.trim();
}

export async function refreshStatus(cmd: ModApi): Promise<void> {
	const stored = cmd.store.get<Partial<CommitFlags>>(STORE_KEY) ?? {};
	const opt = cmd.getFlag('status');
	if (typeof opt === 'boolean' ? !opt : stored.status === false) {
		cmd.ui.setStatus(null);
		return;
	}
	const text = await dirtyStatus(cmd);
	cmd.ui.setStatus(text);
}

// The host swallows publishes made before the TUI subscribes (mid-bind), so the first
// paint is deferred until after bind settles; afterToolCall refreshes keep it current.
export function refreshStatusDeferred(cmd: ModApi): void {
	cmd.clock.after(600, () => {
		void refreshStatus(cmd);
	});
}

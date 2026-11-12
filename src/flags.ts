import type {ModApi} from '@commandcode/harness';

export type CommitFlags = {style: string; sign: boolean; push: boolean; status: boolean; shortcut: boolean};

export const DEFAULT_FLAGS: CommitFlags = {style: 'conventional', sign: false, push: false, status: true, shortcut: true};

export const STORE_KEY = 'flags';

export function flagsSummary(flags: CommitFlags): string {
	return `style=${flags.style}, sign=${flags.sign ? 'on (-S)' : 'off'}, push=${flags.push ? 'on' : 'off'}, status=${flags.status ? 'on' : 'off'}, shortcut=${flags.shortcut ? 'on (alt+c)' : 'off'}`;
}

export function normalizeStatus(value: unknown): boolean {
	if (typeof value === 'boolean') return value;
	return DEFAULT_FLAGS.status;
}

export function normalizeStyle(value: unknown): 'conventional' | 'gitmoji' {
	return typeof value === 'string' && value.toLowerCase() === 'gitmoji'
		? 'gitmoji'
		: 'conventional';
}

export function normalizeBool(value: unknown): boolean | undefined {
	if (typeof value === 'boolean') return value;
	if (typeof value === 'string') {
		const v = value.toLowerCase();
		if (['true', '1', 'yes', 'on'].includes(v)) return true;
		if (['false', '0', 'no', 'off'].includes(v)) return false;
	}
	return undefined;
}

export function readStored(cmd: ModApi): CommitFlags {
	const stored = cmd.store.get<Partial<CommitFlags>>(STORE_KEY) ?? {};
	return {
		style: normalizeStyle(stored.style),
		sign: stored.sign === true,
		push: stored.push === true,
		status: stored.status !== false,
		shortcut: stored.shortcut !== false,
	};
}

export function readFlags(cmd: ModApi): CommitFlags {
	const stored = readStored(cmd);
	const optStyle = cmd.getFlag('style');
	const optSign = cmd.getFlag('sign');
	const optPush = cmd.getFlag('push');
	const optStatus = cmd.getFlag('status');
	const optShortcut = cmd.getFlag('shortcut');
	return {
		style:
			typeof optStyle === 'string' && optStyle
				? normalizeStyle(optStyle)
				: stored.style,
		sign: typeof optSign === 'boolean' ? optSign : stored.sign,
		push: typeof optPush === 'boolean' ? optPush : stored.push,
		status: typeof optStatus === 'boolean' ? optStatus : stored.status,
		shortcut: typeof optShortcut === 'boolean' ? optShortcut : stored.shortcut,
	};
}

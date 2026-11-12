import type {ModApi} from '@commandcode/harness';

const MAX_FILES_SHOWN = 200;

type CommitFlags = {style: string; sign: boolean; push: boolean; status: boolean; shortcut: boolean};

const DEFAULT_FLAGS: CommitFlags = {style: 'conventional', sign: false, push: false, status: true, shortcut: true};

const STORE_KEY = 'flags';

const PROTECTED_BRANCHES = new Set(['main', 'master', 'trunk']);

const SECRET_BASENAME =
	/^(\.env(\..+)?|.*\.(pem|key|p12|pfx)|id_rsa|id_dsa|id_ecdsa|id_ed25519|credentials\.json|secrets?\.(json|ya?ml)|\.npmrc|\.pypirc)$/i;

function basenameOf(path: string): string {
	const parts = path.replace(/\\/g, '/').split('/');
	return parts[parts.length - 1] ?? path;
}

function stripQuotes(token: string): string {
	if (
		token.length >= 2 &&
		((token.startsWith('"') && token.endsWith('"')) ||
			(token.startsWith("'") && token.endsWith("'")))
	) {
		return token.slice(1, -1);
	}
	return token;
}

function gitSubcommand(full: string): {sub: string; args: string[]} | null {
	const tokens = full.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
	const gi = tokens.findIndex(t => /(^|\/)git$/.test(t));
	if (gi < 0) return null;
	let k = gi + 1;
	while (k < tokens.length) {
		const t = tokens[k] as string;
		if (
			t === '-C' ||
			t === '-c' ||
			t === '--git-dir' ||
			t === '--work-tree' ||
			t === '--namespace' ||
			t === '--super-prefix'
		) {
			k += 2;
			continue;
		}
		if (/^-[Cc].+/.test(t) || /^--config($|=)/.test(t)) {
			if (!t.includes('=')) k++;
			k++;
			continue;
		}
		if (t.startsWith('-')) {
			k++;
			continue;
		}
		break;
	}
	if (k >= tokens.length) return null;
	return {sub: tokens[k] as string, args: tokens.slice(k + 1)};
}

function isForceFlag(arg: string): boolean {
	const a = stripQuotes(arg);
	return (
		a === '--force' ||
		a === '-f' ||
		a === '--force-with-lease' ||
		a.startsWith('--force-with-lease=') ||
		a === '--force-if-includes' ||
		(a.startsWith('-') && !a.startsWith('--') && a.includes('f'))
	);
}

function pathArgs(args: string[]): string[] {
	const paths: string[] = [];
	let seenDashDash = false;
	for (const raw of args) {
		const a = stripQuotes(raw);
		if (seenDashDash) {
			paths.push(a);
			continue;
		}
		if (a === '--') {
			seenDashDash = true;
			continue;
		}
		if (a.startsWith('-')) continue;
		paths.push(a);
	}
	return paths;
}

function fileList(output: string): string[] {
	return [...new Set(output.split('\n').map(line => line.trim()).filter(Boolean))];
}

function shortList(files: string[]): string[] {
	if (files.length === 0) return ['(none)'];
	const shown = files.slice(0, MAX_FILES_SHOWN);
	const rest = files.length - shown.length;
	return rest > 0 ? [...shown, `…and ${rest} more`] : shown;
}

function commitCommandLine(sign: boolean): string {
	return sign ? 'git commit -S -m "<message>"' : 'git commit -m "<message>"';
}

function flagsSummary(flags: CommitFlags): string {
	return `style=${flags.style}, sign=${flags.sign ? 'on (-S)' : 'off'}, push=${flags.push ? 'on' : 'off'}, status=${flags.status ? 'on' : 'off'}, shortcut=${flags.shortcut ? 'on (alt+c)' : 'off'}`;
}

function normalizeStatus(value: unknown): boolean {
	if (typeof value === 'boolean') return value;
	return DEFAULT_FLAGS.status;
}

async function dirtyStatus(cmd: ModApi, cwd?: string): Promise<string | null> {
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

	return ` ${branch}${filePart}${syncPart}`.trim();
}

async function refreshStatus(cmd: ModApi): Promise<void> {
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
function refreshStatusDeferred(cmd: ModApi): void {
	cmd.clock.after(600, () => {
		void refreshStatus(cmd);
	});
}

function czRules(flags: CommitFlags): string[] {
	const rules = [
		'Rules for every commit after the first:',
		'- format: type(scope): short description, all lowercase, no trailing period, max 72 chars for the subject',
		'- scope is optional and short (e.g. api, ui, auth); omit it when nothing fits',
		'- types: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert',
	];
	if (flags.style === 'gitmoji') {
		rules.push(
			'- start the subject with the emoji for the type, then the conventional prefix: ✨ feat, 🐛 fix, 📝 docs, 💄 style, ♻️ refactor, ⚡️ perf, ✅ test, 👷 build, 👷 ci, 🔧 chore, ⏪ revert (e.g. "✨ feat(api): add pagination")',
		);
	}
	rules.push(
		'- add a body only when the change needs explaining; never add Co-authored-by or any other trailer',
		'- scan the diff for secrets first (API keys, tokens, passwords, private keys, .env files) — never commit them; stop and tell the user instead',
		'- stage each group explicitly with git add <paths>; read new files before committing them',
		`- commit with ${commitCommandLine(flags.sign)} (add a second -m for a body when needed)`,
		'- after the last commit, report each commit message and the remaining git status --short',
	);
	if (flags.push) rules.push('- finally, push the branch with git push');
	return rules;
}

function freshRepoPrompt(opts: {
	cwd: string;
	changed: string[];
	tracked: string[];
	srcInChanged: boolean;
	hint: string;
	needsInit: boolean;
	flags: CommitFlags;
}): string {
	const lines = [
		opts.needsInit
			? `${opts.cwd} is not a git repository yet — the user likely forgot to run git init. Start by running git init there, then work through the flow below.`
			: 'This repository has no commits yet. Work through the incremental first-commit flow below.',
		'',
		`Active options: ${flagsSummary(opts.flags)}.`,
		'',
		`Changed files (${opts.changed.length}):`,
		...shortList(opts.changed),
		'',
		`Tracked files (${opts.tracked.length}):`,
		...shortList(opts.tracked),
		'',
		`A changed path is under src/: ${opts.srcInChanged ? 'yes' : 'no'}.`,
		'Whether anything beyond config/scaffolding exists you decide yourself: look at the tree and infer it from names and contents, not from a fixed list. Config/scaffolding means things like manifests, lockfiles, editor/CI/build/lint configs, Dockerfiles, .gitignore. Everything with real substance — application code, assets, scripts that do work, meaningful docs — counts as project content.',
		'',
	];
	if (opts.hint) lines.push(`The user ran /commit with a hint — use it as the first message and skip asking: ${opts.hint}`, '');
	lines.push(
		'Steps:',
		"1. If there is real project content (src/ or any non-config files), ask the user whether to keep the default first message 'initial commit' or use a custom one. If you cannot reach the user, keep 'initial commit' and proceed.",
		"If the tree holds only config/scaffolding, skip asking and use 'initial commit'.",
		"2. First commit: stage a sensible baseline group and commit it with the decided message — exactly 'initial commit' unless a custom message was approved or hinted.",
		'3. Then continue incrementally: group the remaining changes into small logical commits (by feature, directory, or layer — e.g. scaffolding, then features, then tests/docs), staging each group explicitly and committing it before moving on. If the whole change is genuinely one logical unit, the single initial commit is enough.',
		'',
		...czRules(opts.flags),
	);
	return lines.join('\n');
}

function existingRepoPrompt(opts: {
	branch: string;
	recent: string;
	status: string;
	cachedStat: string;
	worktreeStat: string;
	staged: string[];
	unstaged: string[];
	untracked: string[];
	hint: string;
	flags: CommitFlags;
}): string {
	const lines = [
		'Commit the current working-tree changes incrementally, following the Commitizen / Conventional Commits style.',
		'The change may be large (the user may have forgotten to commit for a while) — split it into small logical commits instead of one big one.',
		'',
		`Active options: ${flagsSummary(opts.flags)}.`,
		'',
		`Branch: ${opts.branch}`,
		'Recent history (match its tone):',
		opts.recent,
		'',
		'Status:',
		opts.status,
		'',
		`Staged files (${opts.staged.length}):`,
		...shortList(opts.staged),
		`Unstaged tracked files (${opts.unstaged.length}):`,
		...shortList(opts.unstaged),
		`Untracked files (${opts.untracked.length}):`,
		...shortList(opts.untracked),
		'',
		'Change stats:',
		opts.cachedStat || '(nothing staged)',
		opts.worktreeStat || '(no unstaged changes)',
		'',
	];
	if (opts.hint) lines.push(`User hint: ${opts.hint}`, '');
	lines.push(
		'Steps:',
		'1. If staged changes exist, commit those first as one unit, exactly as staged.',
		'2. Group everything else into small logical commits (by feature, directory, or layer). Stage each group explicitly with git add <paths> and commit it before moving on to the next group.',
		'',
		...czRules(opts.flags),
	);
	return lines.join('\n');
}

function normalizeStyle(value: unknown): 'conventional' | 'gitmoji' {
	return typeof value === 'string' && value.toLowerCase() === 'gitmoji'
		? 'gitmoji'
		: 'conventional';
}

function normalizeBool(value: unknown): boolean | undefined {
	if (typeof value === 'boolean') return value;
	if (typeof value === 'string') {
		const v = value.toLowerCase();
		if (['true', '1', 'yes', 'on'].includes(v)) return true;
		if (['false', '0', 'no', 'off'].includes(v)) return false;
	}
	return undefined;
}

async function runCommit(opts: {
	hint: string;
	cwd: string;
	exec: (args: {command: string; args: string[]; cwd: string}) => Promise<{stdout: string; stderr: string; code: number}>;
	flags: CommitFlags;
}): Promise<{prompt?: string; message?: string}> {
	const {hint, cwd, exec, flags} = opts;
	const git = (gitArgs: string[]) => exec({command: 'git', args: gitArgs, cwd});

	if ((await git(['rev-parse', '--is-inside-work-tree'])).code !== 0) {
		return {
			prompt: freshRepoPrompt({
				cwd,
				changed: [],
				tracked: [],
				srcInChanged: false,
				hint,
				needsInit: true,
				flags,
			}),
		};
	}

	const hasCommits = (await git(['rev-parse', '--verify', 'HEAD'])).code === 0;
	const status = await git(['status', '--porcelain=v1', '-uall']);
	const staged = fileList((await git(['diff', '--cached', '--name-only'])).stdout);
	const unstaged = fileList((await git(['diff', '--name-only'])).stdout);
	const untracked = status.stdout
		.split('\n')
		.map(line => line.trim())
		.filter(line => line.startsWith('??'))
		.map(line => line.slice(2).trim())
		.filter(Boolean);
	const changed = [...new Set([...staged, ...unstaged, ...untracked])];

	if (changed.length === 0) {
		return {message: 'Nothing to commit — the working tree is clean.'};
	}

	if (!hasCommits) {
		const tracked = fileList((await git(['ls-files'])).stdout);
		const srcInChanged = changed.some(
			p => p === 'src' || p.toLowerCase().startsWith('src/'),
		);
		return {
			prompt: freshRepoPrompt({
				cwd,
				changed,
				tracked,
				srcInChanged,
				hint,
				needsInit: false,
				flags,
			}),
		};
	}

	const branch =
		(await git(['branch', '--show-current'])).stdout.trim() || '(detached HEAD)';
	const recent =
		(await git(['log', '--oneline', '-5'])).stdout.trim() || '(no history yet)';
	const cachedStat = (await git(['diff', '--cached', '--stat'])).stdout.trim();
	const worktreeStat = (await git(['diff', '--stat'])).stdout.trim();

	return {
		prompt: existingRepoPrompt({
			branch,
			recent,
			status: status.stdout.trim() || '(clean)',
			cachedStat,
			worktreeStat,
			staged,
			unstaged,
			untracked,
			hint,
			flags,
		}),
	};
}

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
		beforeToolCall: async ({toolName, input}) => {
			if (toolName !== 'shell_command') return undefined;
			const full =
				typeof input === 'object' &&
				input !== null &&
				typeof (input as {command?: unknown}).command === 'string'
					? ((input as {command: string}).command ?? '')
					: '';
			if (!full.trim()) return undefined;
			if (/[;&|`<>\n]|\$\(/.test(full)) return undefined;

			const parsed = gitSubcommand(full);
			if (!parsed) return undefined;
			const sub = parsed.sub.toLowerCase();
			const args = parsed.args;

			const runGit = async (gitArgs: string[]) => {
				const cwd =
					typeof input === 'object' &&
					input !== null &&
					typeof (input as {cwd?: unknown}).cwd === 'string'
						? (input as {cwd: string}).cwd
						: undefined;
				try {
					return await cmd.exec({command: 'git', args: gitArgs, cwd});
				} catch {
					return undefined;
				}
			};

			const secretHitIn = (files: string[]): string | undefined =>
				files
					.map(p => basenameOf(p))
					.find(p => SECRET_BASENAME.test(p));

			if (sub === 'push') {
				const force = args.some(isForceFlag);
				if (!force) return undefined;
				const ok = await cmd.ui.confirm({
					title: 'Force-push requires confirmation',
					message: `Blocked: ${full.trim()} — force-pushes rewrite shared history.`,
				});
				return ok
					? undefined
					: {block: true, additionalContext: 'Blocked: force-push declined.'};
			}

			if (sub === 'reset') {
				const hard = args.some(a => {
					const t = stripQuotes(a).toLowerCase();
					return t === '--hard' || (t.startsWith('-') && !t.startsWith('--') && t.includes('h'));
				});
				if (!hard) return undefined;
				const ok = await cmd.ui.confirm({
					title: 'git reset --hard destroys work',
					message: `Blocked: ${full.trim()} — this discards uncommitted changes.`,
				});
				return ok
					? undefined
					: {block: true, additionalContext: 'Blocked: reset --hard declined.'};
			}

			if (sub === 'clean') {
				const force = args.some(a => {
					const t = stripQuotes(a).toLowerCase();
					return t === '-f' || t === '-ff' || t === '--force' || (t.startsWith('-') && !t.startsWith('--') && t.includes('f'));
				});
				if (!force) return undefined;
				const ok = await cmd.ui.confirm({
					title: 'git clean -f deletes files',
					message: `Blocked: ${full.trim()} — this permanently deletes untracked files.`,
				});
				return ok
					? undefined
					: {block: true, additionalContext: 'Blocked: git clean -f declined.'};
			}

			if (sub === 'checkout' || sub === 'switch' || sub === 'restore') {
				const paths = pathArgs(args).map(p => basenameOf(p).toLowerCase());
				if (full.includes('.env') || paths.some(p => SECRET_BASENAME.test(p) || /^\.env(\..+)?$/.test(p))) {
					return {
						block: true,
						additionalContext:
							'Blocked: this overwrites a secrets file. Ask the user to restore it manually if that is really intended.',
					};
				}
				return undefined;
			}

			if (sub === 'add' || sub === 'stage') {
					const named = pathArgs(args);
					const namedHit = secretHitIn(named);
					if (namedHit) {
						return {
							block: true,
							additionalContext: `Blocked: ${namedHit} looks like a secrets file and must never be staged.`,
						};
					}
					const bulk = named.some(p => {
						const t = p.replace(/\/+$/, '');
						return t === '.' || t === '-A' || t === '--all' || t === '-u' || t === '--update';
					});
					const noPaths = named.length === 0;
					if (bulk || noPaths) {
						const out = await runGit(['status', '--porcelain=v1', '-uall']);
						if (out && out.code === 0) {
							const candidates = out.stdout
								.split('\n')
								.map(l => (l.length > 3 ? l.slice(3).trim() : ''))
								.filter(Boolean);
							const hit = secretHitIn(candidates);
							if (hit) {
								return {
									block: true,
									additionalContext: `Blocked: ${hit} looks like a secrets file and must never be staged. Stage files explicitly instead of ${noPaths ? 'a bare git add' : 'bulk add'}.`,
								};
							}
						}
					}
					return undefined;
				}

			if (sub === 'commit') {
				const named = pathArgs(args);
				const namedHit = secretHitIn(named);
				if (namedHit) {
					return {
						block: true,
						additionalContext: `Blocked: ${namedHit} looks like a secrets file and must never be committed.`,
					};
				}
				const autoStage = args.some(a => {
					const t = stripQuotes(a).toLowerCase();
					return t === '-a' || t === '--all' || (t.startsWith('-') && !t.startsWith('--') && t.includes('a'));
				});
				const stagedP = runGit(['diff', '--cached', '--name-only']).then(out => {
					if (!out || out.code !== 0) return [] as string[];
					return out.stdout.split('\n').map(l => l.trim()).filter(Boolean);
				});
				const modifiedP = autoStage
					? runGit(['status', '--porcelain=v1', '-uall']).then(out => {
						if (!out || out.code !== 0) return [] as string[];
						return out.stdout
							.split('\n')
							.map(l => (l && !l.startsWith('??') && l.length > 3 ? l.slice(3).trim() : ''))
							.filter(Boolean);
					})
					: Promise.resolve([] as string[]);
				const [staged, modified] = await Promise.all([stagedP, modifiedP]);
				const hit = secretHitIn([...staged, ...modified]);
				if (hit) {
					return {
						block: true,
						additionalContext: autoStage
							? `Blocked: ${hit} looks like a secrets file and commit -a would stage it — ignore it and commit explicitly instead.`
							: `Blocked: ${hit} is staged and looks like a secrets file — unstage it before committing.`,
					};
				}
				return undefined;
			}

			if (sub === 'branch') {
				const flags = new Set<string>();
				const names: string[] = [];
				for (const raw of args) {
					const a = stripQuotes(raw);
					if (a === '--') continue;
					if (a.startsWith('--')) {
						flags.add(a.toLowerCase());
						continue;
					}
					if (a.startsWith('-') && a.length >= 2) {
						for (const ch of a.slice(1)) flags.add(ch.toLowerCase());
						continue;
					}
					names.push(a.toLowerCase());
				}
				if (
					(flags.has('d') || flags.has('delete')) &&
					names.some(n => PROTECTED_BRANCHES.has(n))
				) {
					return {
						block: true,
						additionalContext:
							'Blocked: deleting a protected branch (main/master/trunk) is not allowed.',
					};
				}
				return undefined;
			}

			return undefined;
		},
	});

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

	const readStored = (): CommitFlags => {
		const stored = cmd.store.get<Partial<CommitFlags>>(STORE_KEY) ?? {};
		return {
			style: normalizeStyle(stored.style),
			sign: stored.sign === true,
			push: stored.push === true,
			status: stored.status !== false,
			shortcut: stored.shortcut !== false,
		};
	};

	const readFlags = (): CommitFlags => {
		const stored = readStored();
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
	};

	cmd.addCommand({
		name: 'commit:flags',
		description: 'Show and change /commit options (style, sign, push, status, shortcut)',
		argumentHint: '[show|reset|key=value ...]',
		handler: async ({args, ui}) => {
			const rest = args.trim();

			if (rest === '' || rest.toLowerCase() === 'show') {
				const flags = readFlags();
				const stored = readStored();
				const lines = [
					'/commit options:',
					`- style: ${flags.style} (stored: ${stored.style})`,
					`- sign: ${flags.sign ? 'on' : 'off'} (stored: ${stored.sign ? 'on' : 'off'})`,
					`- push: ${flags.push ? 'on' : 'off'} (stored: ${stored.push ? 'on' : 'off'})`,
					`- status: ${flags.status ? 'on' : 'off'} (stored: ${stored.status ? 'on' : 'off'})`,
					`- shortcut: ${flags.shortcut ? 'on' : 'off'} (stored: ${stored.shortcut ? 'on' : 'off'})`,
				];
				if (rest === '') {
					lines.push(
						'',
						'Pick a setting to change, or Done to keep these.',
					);
					const pick = await ui.select({
						title: 'Change a /commit option',
						options: [
							{label: 'style', description: `message style (${flags.style})`},
							{label: 'sign', description: `GPG-sign commits (${flags.sign ? 'on' : 'off'}) — select to toggle`},
							{label: 'push', description: `push after committing (${flags.push ? 'on' : 'off'}) — select to toggle`},
							{label: 'status', description: `dirty-state footer (${flags.status ? 'on' : 'off'}) — select to toggle`},
							{label: 'shortcut', description: `alt+c commit shortcut (${flags.shortcut ? 'on' : 'off'}) — select to toggle`},
							{label: 'reset', description: 'back to defaults'},
							{label: 'Done'},
						],
					});
					if (pick === undefined || pick === 'Done') {
						return {message: lines.slice(0, 6).join('\n')};
					}
					if (pick === 'style') {
						const choice = await ui.select({
							title: 'Message style',
							options: [
								{label: 'conventional', description: 'type(scope): description'},
								{label: 'gitmoji', description: 'emoji prefix + conventional'},
							],
						});
						if (choice === undefined) return {message: 'No change — style untouched.'};
						await cmd.store.set(STORE_KEY, {...readStored(), style: normalizeStyle(choice)});
						return {message: `style set to ${normalizeStyle(choice)}.`};
					}
					if (pick === 'sign' || pick === 'push' || pick === 'status' || pick === 'shortcut') {
						const key = pick;
						const on = !flags[key];
						await cmd.store.set(STORE_KEY, {...readStored(), [key]: on});
						if (key === 'status') await refreshStatus(cmd);
						return {message: `${key} turned ${on ? 'on' : 'off'}.`};
					}
					await cmd.store.delete(STORE_KEY);
					await refreshStatus(cmd);
					return {message: 'Options reset to defaults (conventional, sign off, push off, status on, shortcut on).'};
				}
				return {message: lines.join('\n')};
			}

			if (rest.toLowerCase() === 'reset') {
				await cmd.store.delete(STORE_KEY);
				await refreshStatus(cmd);
				return {message: 'Options reset to defaults (conventional, sign off, push off, status on, shortcut on).'};
			}

			const updates: Partial<CommitFlags> = {};
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
			await cmd.store.set(STORE_KEY, {...readStored(), ...updates});
			if (updates.status !== undefined) await refreshStatus(cmd);
			return {message: `Saved: ${flagsSummary({...readFlags(), ...updates})}.`};
		},
	});

	cmd.addCommand({
		name: 'commit',
		description: 'Commit working changes in small incremental stages with Commitizen-style messages',
		argumentHint: '[message]',
		handler: async ({args, cwd, exec}) => {
			return runCommit({hint: args.trim(), cwd, exec, flags: readFlags()});
		},
	});

	cmd.addShortcut('alt+c', {
		description: 'Trigger /commit',
		handler: async ({cwd, exec}) => {
			if (!readFlags().shortcut) return undefined;
			return runCommit({hint: '', cwd, exec, flags: readFlags()});
		},
	});
}
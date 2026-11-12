import type {ModApi} from '@commandcode/harness';
import {basenameOf, gitSubcommand, isForceFlag, pathArgs, stripQuotes} from './git.js';

export const PROTECTED_BRANCHES = new Set(['main', 'master', 'trunk']);

export const SECRET_BASENAME =
	/^(\.env(\..+)?|.*\.(pem|key|p12|pfx)|id_rsa|id_dsa|id_ecdsa|id_ed25519|credentials\.json|secrets?\.(json|ya?ml)|\.npmrc|\.pypirc)$/i;

export function registerGuardrails(cmd: ModApi): void {
	cmd.hooks({
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
}

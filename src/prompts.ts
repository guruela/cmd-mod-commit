import {flagsSummary, type CommitFlags} from './flags.js';

export const MAX_FILES_SHOWN = 200;

export function shortList(files: string[]): string[] {
	if (files.length === 0) return ['(none)'];
	const shown = files.slice(0, MAX_FILES_SHOWN);
	const rest = files.length - shown.length;
	return rest > 0 ? [...shown, `…and ${rest} more`] : shown;
}

export function commitCommandLine(sign: boolean): string {
	return sign ? 'git commit -S -m "<message>"' : 'git commit -m "<message>"';
}

export function czRules(flags: CommitFlags): string[] {
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

export function freshRepoPrompt(opts: {
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

export function existingRepoPrompt(opts: {
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

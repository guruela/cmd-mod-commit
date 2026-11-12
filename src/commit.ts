import type {CommitFlags} from './flags.js';
import {fileList} from './git.js';
import {existingRepoPrompt, freshRepoPrompt} from './prompts.js';

type ExecFn = (args: {command: string; args: string[]; cwd: string}) => Promise<{stdout: string; stderr: string; code: number}>;

export async function runCommit(opts: {
	hint: string;
	cwd: string;
	exec: ExecFn;
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

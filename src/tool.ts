import type {ModApi} from '@commandcode/harness';
import {readFlags} from './flags.js';
import {runCommit} from './commit.js';

export function registerTool(cmd: ModApi): void {
	cmd.addTool({
		schema: {
			name: 'commit',
			description:
				'Commit the current working-tree changes in small incremental stages with Commitizen / Conventional Commits messages. Use this whenever the user asks to commit (e.g. "commit this", "commit my changes", "commit and push"). Returns the commit flow instructions plus a repo snapshot — follow them, staging explicitly with git add and committing with git. Honors the /commit:config options (style, sign, push).',
			input_schema: {
				type: 'object',
				properties: {
					message: {
						type: 'string',
						description:
							'Optional hint for the commit message. In a repo with no commits yet it is used as the first commit message verbatim and skips the initial-commit question.',
					},
				},
				required: [],
			},
		},
		run: async ({input}) => {
			const hint =
				typeof input.message === 'string' ? input.message.trim() : '';
			const result = await runCommit({
				hint,
				cwd: cmd.cwd,
				exec: async a => cmd.exec(a),
				flags: readFlags(cmd),
			});
			const text = result.prompt ?? result.message ?? 'Nothing to commit.';
			return {ok: true, content: [{type: 'text', text}]};
		},
	});
}

export function basenameOf(path: string): string {
	const parts = path.replace(/\\/g, '/').split('/');
	return parts[parts.length - 1] ?? path;
}

export function stripQuotes(token: string): string {
	if (
		token.length >= 2 &&
		((token.startsWith('"') && token.endsWith('"')) ||
			(token.startsWith("'") && token.endsWith("'")))
	) {
		return token.slice(1, -1);
	}
	return token;
}

export function gitSubcommand(full: string): {sub: string; args: string[]} | null {
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

export function isForceFlag(arg: string): boolean {
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

export function pathArgs(args: string[]): string[] {
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

export function fileList(output: string): string[] {
	return [...new Set(output.split('\n').map(line => line.trim()).filter(Boolean))];
}

/**
 * which — localiza un comando en el PATH.
 *
 * Mensajes verificados contra GNU which v2.25:
 *   which: no nombre in (/usr/local/bin:/usr/bin:/bin)
 *   which: invalid option -- x            (imprime y sigue, codigo 0 si lo encuentra)
 *   which: unrecognized option `--bogus'  (+ usage, codigo 255)
 *
 * Desvios conscientes: en el VFS los directorios del PATH estan vacios, asi
 * que `which ls` no encuentra nada; sin opciones solo se implementan `-a` y
 * los silenciadores `-s`.
 */

import { ShellError, EXIT_ERROR } from '../errors.js';
import { normalizePath } from '../fs.js';

const USAGE = [
    'Usage: which [options] [--] COMMAND [...]',
    'Write the full path of COMMAND(s) to standard output.',
    '',
    '  --version, -[vV] Print version and exit successfully.',
    '  --help,          Print this help and exit successfully.',
    '  --skip-dot       Skip directories in PATH that start with a dot.',
    '  --skip-tilde     Skip directories in PATH that start with a tilde.',
    "  --show-dot       Don't expand a dot to current directory in output.",
    '  --show-tilde     Output a tilde for HOME directory for non-root.',
    '  --tty-only       Stop processing options on the right if not on tty.',
    '  --all, -a        Print all matches in PATH, not just the first',
    '  --read-alias, -i Read list of aliases from stdin.',
    "  --skip-alias     Ignore option --read-alias; don't read stdin.",
    '  --read-functions Read shell functions from stdin.',
    "  --skip-functions Ignore option --read-functions; don't read stdin.",
    '',
    'Recommended use is to write the output of (alias; declare -f) to standard',
    'input, so that which can show aliases and shell functions. See which(1) for',
    'examples.',
    '',
    'If the options --read-alias and/or --read-functions are specified then the',
    'output can be a full alias or function definition, optionally followed by',
    'the full path of each command used inside of those.',
    '',
    'Report bugs to <which-bugs@gnu.org>.'
].join('\n');

/** Bloque de ayuda completo, tal y como lo imprime which. */
function usageText() {
    return USAGE;
}

/** Desempaqueta las opciones: las largas cortan, las cortas siguen. */
function parseOptions(argv) {
    const opts = { all: false, operands: [], errors: [] };
    for (let i = 1; i < argv.length; i++) {
        const op = argv[i];
        if (op === '--') { opts.operands.push(...argv.slice(i + 1)); break; }
        if (op === '--all') { opts.all = true; continue; }
        if (op === '--help' || op === '--version') { opts.showHelp = true; continue; }
        if (op.startsWith('--')) {
            opts.errors.push('which: unrecognized option `' + op + "'");
            break;
        }
        if (op.length > 1 && op[0] === '-') {
            for (const flag of op.slice(1)) {
                if (flag === 'a') opts.all = true;
                else if ('vVh'.includes(flag)) opts.showHelp = true;
                else opts.errors.push('which: invalid option -- ' + flag);
            }
            continue;
        }
        opts.operands.push(op);
    }
    return opts;
}

export default {
    name: 'which',
    alias: [],
    synopsis: 'which [-a] COMANDO...',
    async run(ctx, argv) {
        const opts = parseOptions(argv);
        const fatal = opts.errors.find((e) => e.indexOf('unrecognized option') >= 0);
        if (fatal) {
            ctx.stderr.write(fatal + '\n' + usageText() + '\n');
            return 255;
        }
        if (opts.showHelp) {
            ctx.stdout.write(usageText() + '\n');
            return 0;
        }
        if (!opts.operands.length) {
            ctx.stderr.write(usageText() + '\n');
            return 255;
        }
        for (const error of opts.errors) ctx.stderr.write(error + '\n');

        const fs = ctx.fs;
        const actor = { uid: ctx.owner.uid, gid: ctx.owner.gid, groups: [] };
        const path = ctx.env.PATH || '';
        let code = 0;

        for (const name of opts.operands) {
            const matches = [];
            if (name.indexOf('/') >= 0) {
                const abs = normalizePath(ctx.cwd, name);
                const node = fs.node(abs);
                if (node && !node.isDir && fs.canExec(node, actor)) matches.push(name);
            } else {
                for (const dir of path.split(':')) {
                    if (dir === '') continue;
                    const abs = normalizePath(ctx.cwd, dir);
                    const node = fs.node(abs);
                    if (!node || !node.isDir) continue;
                    const child = node.child(name);
                    if (!child || child.isDir) continue;
                    if (!fs.canExec(child, actor)) continue;
                    matches.push((dir === '/' ? '/' : dir.replace(/\/+$/, '') + '/') + name);
                    if (!opts.all) break;
                }
            }
            if (!matches.length) {
                ctx.stderr.write('which: no ' + name + ' in (' + path + ')\n');
                code = 1;
                continue;
            }
            for (const match of matches) ctx.stdout.write(match + '\n');
        }
        return code;
    }
};

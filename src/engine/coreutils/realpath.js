/**
 * realpath — resuelve una ruta a su forma canonica.
 *
 * Decision de la especificacion: por DEFECTO todos los componentes tienen que
 * existir (como `realpath -e` de GNU). Bash real en su 8.32 permite que falte
 * el ultimo componente; quien necesite ese comportamiento tiene `-m`, que es el
 * de GNU `--canonicalize-missing`.
 *
 * Desvios conscientes:
 *  - Sin `--help` ni `--version`; `-s` es lexico puro (igual que GNU).
 */

import { ShellError, EXIT_ERROR } from '../errors.js';
import { normalizePath, dirnameOf, basenameOf } from '../fs.js';

/** Comilla al estilo de GNU: solo si el texto lo necesita. */
function quoteaf(text) {
    if (text !== '' && /^[A-Za-z0-9_%+,.\/:@=-]+$/.test(text)) return text;
    return "'" + String(text).replace(/'/g, "'\\''") + "'";
}

/** Error de uso con la ayuda corta, tal y como la imprime GNU. */
function usageError(message) {
    return new ShellError(message + "\nTry 'realpath --help' for more information.", EXIT_ERROR);
}

/**
 * Motivo por el que una ruta no se puede resolver: el primer problema que
 * encuentra el kernel al bajar por los componentes.
 */
function failureReason(fs, abs) {
    try {
        const segs = abs === '/' ? [] : abs.slice(1).split('/');
        let cur = '/';
        for (const seg of segs) {
            const node = fs.node(cur);
            if (!node) return 'No such file or directory';
            if (!node.isDir) return 'Not a directory';
            const next = cur === '/' ? '/' + seg : cur + '/' + seg;
            if (!fs.node(next)) return 'No such file or directory';
            cur = next;
        }
        return 'No such file or directory';
    } catch (e) {
        return e.message.includes('too many levels') ? 'Too many levels of symbolic links' : 'No such file or directory';
    }
}

/** Traduce una excepcion del VFS al mensaje largo de GNU. */
function reasonFromError(error) {
    const message = String(error.message);
    if (message.includes('too many levels')) return 'Too many levels of symbolic links';
    const sep = message.indexOf(': ');
    return sep >= 0 ? message.slice(sep + 2) : message;
}

/** Resuelve segun el modo exigido. Devuelve null si no es posible. */
function canonicalize(fs, path, mode) {
    const full = fs.realpath(path);
    if (full != null) return full;
    if (mode === 'existing') return null;
    const abs = normalizePath('/', path);
    const parent = fs.realpath(dirnameOf(abs));
    if (parent != null) return (parent === '/' ? '' : parent) + '/' + basenameOf(abs);
    return mode === 'missing' ? abs : null;
}

/** Desempaqueta las opciones y devuelve el modo efectivo. */
function parseOptions(argv) {
    const opts = { mode: 'existing', zero: false, paths: [] };
    for (const op of argv.slice(1)) {
        if (op === '--canonicalize-existing') { opts.mode = 'existing'; continue; }
        if (op === '--canonicalize-missing') { opts.mode = 'missing'; continue; }
        if (op === '--strip' || op === '--no-symlinks') { opts.mode = 'strip'; continue; }
        if (op === '--zero') { opts.zero = true; continue; }
        if (op === '--') { opts.paths.push(...argv.slice(argv.indexOf(op) + 1)); break; }
        if (op.startsWith('--')) throw usageError('realpath: unknown option -- ' + op.slice(2));
        if (op.length > 1 && op[0] === '-') {
            for (const flag of op.slice(1)) {
                if (flag === 'e') opts.mode = 'existing';
                else if (flag === 'm') opts.mode = 'missing';
                else if (flag === 's') opts.mode = 'strip';
                else if (flag === 'z') opts.zero = true;
                else throw usageError('realpath: unknown option -- ' + flag);
            }
            continue;
        }
        opts.paths.push(op);
    }
    return opts;
}

export default {
    name: 'realpath',
    alias: [],
    synopsis: 'realpath [OPCION]... RUTA...',
    run(ctx, argv) {
        const opts = parseOptions(argv);
        if (!opts.paths.length) throw usageError('realpath: missing operand');

        let code = 0;
        const end = opts.zero ? '\0' : '\n';
        for (const path of opts.paths) {
            if (path === '') {
                ctx.stderr.write("realpath: '': No such file or directory\n");
                code = 1;
                continue;
            }
            const abs = normalizePath('/', path);
            let resolved = null;
            try {
                resolved = opts.mode === 'strip' ? abs : canonicalize(ctx.fs, path, opts.mode);
            } catch (e) {
                ctx.stderr.write('realpath: ' + quoteaf(path) + ': ' + reasonFromError(e) + '\n');
                code = 1;
                continue;
            }
            if (resolved == null) {
                ctx.stderr.write('realpath: ' + quoteaf(path) + ': ' + failureReason(ctx.fs, abs) + '\n');
                code = 1;
                continue;
            }
            ctx.stdout.write(resolved + end);
        }
        return code;
    }
};

/**
 * readlink — imprime el destino de un enlace simbolico o la ruta canonica.
 *
 * Sin opciones solo se imprime el destino tal y como esta guardado; si el
 * fichero no es un enlace no hay salida y el codigo es 1 (GNU es silencioso
 * por defecto: `-q` es el comportamiento por omision, `-v` lo activa).
 *
 * Desvios conscientes: `-e`/`-f`/`-m` delegan en el VFS; cuando el ultimo
 * componente es un enlace colgado se devuelve la propia ruta del enlace.
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
    return new ShellError(message + "\nTry 'readlink --help' for more information.", EXIT_ERROR);
}

/** Motivo del fallo al bajar por los componentes de la ruta. */
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
        return String(e.message).includes('too many levels')
            ? 'Too many levels of symbolic links'
            : 'No such file or directory';
    }
}

/** Canonica segun el modo: todos, todos menos el ultimo, o sin requisitos. */
function canonicalize(fs, path, mode) {
    const full = fs.realpath(path);
    if (full != null) return full;
    const abs = normalizePath('/', path);
    const parent = fs.realpath(dirnameOf(abs));
    if (parent != null) return (parent === '/' ? '' : parent) + '/' + basenameOf(abs);
    return mode === 'missing' ? abs : null;
}

/** Desempaqueta las opciones cortas y largas. */
function parseOptions(argv) {
    const opts = { mode: 'target', newline: true, verbose: false, zero: false, paths: [] };
    for (const op of argv.slice(1)) {
        if (op === '--canonicalize') { opts.mode = 'existing'; continue; }
        if (op === '--canonicalize-existing') { opts.mode = 'existing'; continue; }
        if (op === '--canonicalize-missing') { opts.mode = 'missing'; continue; }
        if (op === '--no-newline') { opts.newline = false; continue; }
        if (op === '--quiet' || op === '--silent') { opts.verbose = false; continue; }
        if (op === '--verbose') { opts.verbose = true; continue; }
        if (op === '--zero') { opts.zero = true; continue; }
        if (op.startsWith('--')) throw usageError('readlink: unknown option -- ' + op.slice(2));
        if (op.length > 1 && op[0] === '-') {
            for (const flag of op.slice(1)) {
                if (flag === 'f' || flag === 'e') opts.mode = 'existing';
                else if (flag === 'm') opts.mode = 'missing';
                else if (flag === 'n') opts.newline = false;
                else if (flag === 'q' || flag === 's') opts.verbose = false;
                else if (flag === 'v') opts.verbose = true;
                else if (flag === 'z') opts.zero = true;
                else throw usageError('readlink: unknown option -- ' + flag);
            }
            continue;
        }
        opts.paths.push(op);
    }
    return opts;
}

export default {
    name: 'readlink',
    alias: [],
    synopsis: 'readlink [-f] [-n] FICHERO...',
    run(ctx, argv) {
        const opts = parseOptions(argv);
        if (!opts.paths.length) throw usageError('readlink: missing operand');

        let code = 0;
        const end = opts.zero ? '\0' : (opts.newline ? '\n' : '');
        for (const path of opts.paths) {
            const abs = normalizePath('/', path);
            let result = null;
            let failure = null;
            try {
                if (opts.mode === 'target') {
                    const node = ctx.fs.node(abs, { follow: false });
                    if (node && node.isLink) result = node.target;
                    else if (!node) failure = 'No such file or directory';
                    else failure = 'Invalid argument';
                } else {
                    result = canonicalize(ctx.fs, path, opts.mode);
                    if (result == null) failure = failureReason(ctx.fs, abs);
                }
            } catch (e) {
                failure = String(e.message).includes('too many levels')
                    ? 'Too many levels of symbolic links'
                    : 'No such file or directory';
            }
            if (failure != null) {
                if (opts.verbose) ctx.stderr.write('readlink: ' + quoteaf(path) + ': ' + failure + '\n');
                code = 1;
                continue;
            }
            ctx.stdout.write(result + end);
        }
        return code;
    }
};

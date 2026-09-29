/**
 * rmdir — borra directorios vacios.
 *
 * Mensajes verificados contra GNU coreutils 8.32:
 *   rmdir: failed to remove 'x': No such file or directory
 *   rmdir: failed to remove 'x': Not a directory
 *   rmdir: failed to remove 'x': Directory not empty
 *   rmdir: failed to remove directory '/tmp': Directory not empty   (padres de -p)
 *   rmdir: removing directory, 'x'                                  (antes de borrar)
 *
 * `--ignore-fail-on-non-empty` deja los directorios llenos en silencio y con
 * codigo 0; el resto de errores siguen contando.
 *
 * Desvios conscientes: sin `-Z` (contexto SELinux, inexistente aqui).
 */

import { ShellError, EXIT_ERROR } from '../errors.js';
import { normalizePath, dirnameOf } from '../fs.js';

/** Error de uso con la ayuda corta, tal y como la imprime GNU. */
function usageError(message) {
    return new ShellError(message + "\nTry 'rmdir --help' for more information.", EXIT_ERROR);
}

/** Comilla simple al estilo de GNU. */
function quote(text) {
    return "'" + String(text).replace(/'/g, "'\\''") + "'";
}

/** Desempaqueta las opciones. */
function parseOptions(argv) {
    const opts = { parents: false, verbose: false, force: false, ignoreNonEmpty: false, operands: [] };
    for (const op of argv.slice(1)) {
        if (op === '--parents') { opts.parents = true; continue; }
        if (op === '--verbose') { opts.verbose = true; continue; }
        if (op === '--force') { opts.force = true; continue; }
        if (op === '--ignore-fail-on-non-empty') { opts.ignoreNonEmpty = true; continue; }
        if (op.startsWith('--')) throw usageError('rmdir: unknown option -- ' + op.slice(2));
        if (op.length > 1 && op[0] === '-') {
            for (const flag of op.slice(1)) {
                if (flag === 'p') opts.parents = true;
                else if (flag === 'v') opts.verbose = true;
                else if (flag === 'f') opts.force = true;
                else throw usageError('rmdir: unknown option -- ' + flag);
            }
            continue;
        }
        opts.operands.push(op);
    }
    return opts;
}

/** Motivo por el que una ruta no sirve: el primer problema del camino. */
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

export default {
    name: 'rmdir',
    alias: [],
    synopsis: 'rmdir [-p] [-v] DIRECTORIO...',
    run(ctx, argv) {
        const opts = parseOptions(argv);
        if (!opts.operands.length) throw usageError('rmdir: missing operand');

        const fs = ctx.fs;
        const actor = { uid: ctx.owner.uid, gid: ctx.owner.gid, groups: [] };
        let code = 0;

        for (const operand of opts.operands) {
            const abs = normalizePath(ctx.cwd, operand);
            if (opts.verbose) ctx.stderr.write('rmdir: removing directory, ' + quote(operand) + '\n');
            let failure = null;
            try {
                failure = removeOne(ctx, fs, opts, operand, abs, actor);
            } catch (e) {
                failure = 'rmdir: failed to remove ' + quote(operand) + ': ' + reasonFrom(e);
            }
            if (failure != null) {
                ctx.stderr.write(failure + '\n');
                if (!(opts.force && failure.indexOf('No such file or directory') >= 0)) code = 1;
            }
        }
        return code;
    }
};

/** Extrae el errno de una excepcion del VFS. */
function reasonFrom(error) {
    const message = String(error.message);
    const sep = message.indexOf(': ');
    return sep >= 0 ? message.slice(sep + 2) : message;
}

/** Borra un directorio y, con `-p`, sus padres. Devuelve null o el error. */
function removeOne(ctx, fs, opts, operand, abs, actor) {
    const failed = (path, reason) => 'rmdir: failed to remove ' + quote(path) + ': ' + reason;

    const node = fs.node(abs, { follow: false });
    if (!node) {
        const reason = failureReason(fs, abs);
        if (opts.force && reason === 'No such file or directory') return null;
        return failed(operand, reason);
    }
    if (!node.isDir) return failed(operand, 'Not a directory');
    if (node.list().length) {
        if (opts.ignoreNonEmpty) return null;
        return failed(operand, 'Directory not empty');
    }
    const parentAbs = dirnameOf(abs);
    const parent = parentAbs === '/' ? fs.root : fs.node(parentAbs);
    if (!parent) return failed(operand, 'No such file or directory');
    if (!fs.canWrite(parent, actor)) return failed(operand, 'Permission denied');

    fs.unlink(abs);
    if (!opts.parents) return null;

    // Sube por los padres con el camino escrito en el operando. El primer
    // componente en fallar detiene la cadena, igual que en GNU.
    let display = operand;
    let current = abs;
    while (true) {
        const nextDisplay = dirnameOf(display);
        if (nextDisplay === '.' || nextDisplay === '/') break;
        const nextCurrent = dirnameOf(current);
        if (nextCurrent === '/') break;
        display = nextDisplay;
        current = nextCurrent;
        if (opts.verbose) ctx.stderr.write('rmdir: removing directory, ' + quote(display) + '\n');
        const ancestor = fs.node(current, { follow: false });
        if (!ancestor) return 'rmdir: failed to remove directory ' + quote(display) + ': No such file or directory';
        if (!ancestor.isDir) return 'rmdir: failed to remove directory ' + quote(display) + ': Not a directory';
        if (ancestor.list().length) {
            if (opts.ignoreNonEmpty) return null;
            return 'rmdir: failed to remove directory ' + quote(display) + ': Directory not empty';
        }
        const grantor = fs.node(dirnameOf(current));
        if (!grantor || !fs.canWrite(grantor, actor)) {
            return 'rmdir: failed to remove directory ' + quote(display) + ': Permission denied';
        }
        fs.unlink(current);
    }
    return null;
}

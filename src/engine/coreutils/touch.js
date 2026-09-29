/**
 * touch — crea ficheros vacios y actualiza las marcas de tiempo.
 *
 * Mensajes verificados contra GNU coreutils 8.32:
 *   touch: missing file operand
 *   touch: cannot touch '/x': No such file or directory
 *
 * Desvios conscientes:
 *  - El reloj esta congelado en `ctx.shell.now`, asi que "actualizar" una marca
 *    de tiempo solo se nota en los ficheros de la semilla, cuyo mtime es
 *    anterior al reloj.
 *  - El VFS solo guarda mtime: `-a` crea el fichero si falta pero no toca
 *    ninguna marca (no hay atime que poner).
 *  - Sin `-r`, `-t` ni `-d`: esas opciones salen como opcion desconocida.
 */

import { ShellError, EXIT_ERROR } from '../errors.js';
import { normalizePath, dirnameOf } from '../fs.js';

/** Error de uso con la ayuda corta, tal y como la imprime GNU. */
function usageError(message) {
    return new ShellError(message + "\nTry 'touch --help' for more information.", EXIT_ERROR);
}

/** Comilla simple al estilo de GNU. */
function quote(text) {
    return "'" + String(text).replace(/'/g, "'\\''") + "'";
}

/** Desempaqueta las opciones. */
function parseOptions(argv) {
    const opts = { access: false, modify: false, noCreate: false, operands: [] };
    for (const op of argv.slice(1)) {
        if (op === '--no-create') { opts.noCreate = true; continue; }
        if (op === '--time=atime' || op === '--time=access') { opts.access = true; continue; }
        if (op === '--time=mtime' || op === '--time=modify') { opts.modify = true; continue; }
        if (op.startsWith('--')) throw usageError('touch: unknown option -- ' + op.slice(2));
        if (op.length > 1 && op[0] === '-') {
            for (const flag of op.slice(1)) {
                if (flag === 'a') opts.access = true;
                else if (flag === 'm') opts.modify = true;
                else if (flag === 'c') opts.noCreate = true;
                else throw usageError('touch: unknown option -- ' + flag);
            }
            continue;
        }
        opts.operands.push(op);
    }
    return opts;
}

/** true si el usuario puede cambiar las marcas de tiempo del nodo. */
function canSetTimes(fs, node, actor) {
    if (node.uid === actor.uid) return true;
    return (fs.accessBits(node, actor) & 2) !== 0;
}

export default {
    name: 'touch',
    alias: [],
    synopsis: 'touch [-a] [-m] [-c] FICHERO...',
    run(ctx, argv) {
        const opts = parseOptions(argv);
        if (!opts.operands.length) throw usageError('touch: missing file operand');

        const fs = ctx.fs;
        const actor = { uid: ctx.owner.uid, gid: ctx.owner.gid, groups: [] };
        let code = 0;

        for (const operand of opts.operands) {
            const abs = normalizePath(ctx.cwd, operand);
            let failure = null;
            try {
                const node = fs.node(abs);
                failure = touchOne(ctx, opts, fs, abs, operand, node, actor);
            } catch (e) {
                failure = 'touch: cannot touch ' + quote(operand) + ': ' + reasonFrom(e);
            }
            if (failure != null) {
                ctx.stderr.write(failure + '\n');
                code = 1;
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

/** Aplica la operacion a un fichero. Devuelve el mensaje de error o null. */
function touchOne(ctx, opts, fs, abs, display, node, actor) {
    const touchError = (reason) => 'touch: cannot touch ' + quote(display) + ': ' + reason;

    if (!node) {
        if (opts.noCreate) return null;
        const parent = fs.node(dirnameOf(abs));
        if (!parent) return touchError('No such file or directory');
        if (!parent.isDir) return touchError('Not a directory');
        if (!fs.canWrite(parent, actor)) return touchError('Permission denied');
        const mode = 0o666 & ~(ctx.shell.umask || 0);
        const created = fs.writeFile(abs, '', mode, actor);
        created.mtime = ctx.shell.now;
        return null;
    }

    const touchesMtime = !opts.access || opts.modify;
    if (!touchesMtime) return null;
    if (!canSetTimes(fs, node, actor)) return touchError('Permission denied');
    node.mtime = ctx.shell.now;
    return null;
}

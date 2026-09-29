/**
 * ln — crea enlaces duros o simbolicos.
 *
 * Mensajes copiados de GNU coreutils 8.32, verificados contra bash real:
 *   ln: failed to create symbolic link 'x': File exists
 *   ln: failed to create hard link '/nodir/x' => 'a.txt': No such file or directory
 *   ln: failed to access '/nope': No such file or directory
 *   ln: /dir: hard link not allowed for directory
 *
 * Desvios conscientes:
 *  - El enlace duro se materializa como un fichero nuevo con el mismo
 *    contenido y modo: en el VFS no existe el inode compartido, asi que
 *    escribir despues en uno no afecta al otro (GNU si lo haria).
 *  - `-s` no comprueba que el destino exista, que es lo que hace GNU/Linux;
 *    el bash de Git en Windows si falla porque ahi los enlaces simbolicos se
 *    resuelven por copia. Nuestro VFS tiene enlaces reales, asi que se sigue
 *    la semantica de Linux.
 *  - Sin `-v`, `-i`, `-t`, `-S`, `-r`, `-d` ni `-F`.
 */

import { ShellError, EXIT_ERROR } from '../errors.js';
import { normalizePath, dirnameOf, basenameOf } from '../fs.js';

/** Error de uso con la ayuda corta, tal y como la imprime GNU. */
function usageError(message) {
    return new ShellError(message + "\nTry 'ln --help' for more information.", EXIT_ERROR);
}

/** Comilla simple al estilo de GNU `quote()`. */
function quote(text) {
    return "'" + String(text).replace(/'/g, "'\\''") + "'";
}

/** Ultima componente de una cadena, sin normalizar. */
function lastComponent(text) {
    let work = text;
    while (work.length > 1 && work.endsWith('/')) work = work.slice(0, -1);
    if (work === '' || work === '/') return '/';
    const slash = work.lastIndexOf('/');
    return slash < 0 ? work : work.slice(slash + 1);
}

/** Une directorio y nombre respetando la forma del operando. */
function joinDisplay(dir, name) {
    return (dir === '/' ? '' : dir.replace(/\/+$/, '')) + '/' + name;
}

/** Desempaqueta las opciones. */
function parseOptions(argv) {
    const opts = { symbolic: false, force: false, noTargetDir: false, noDeref: false, operands: [] };
    for (const op of argv.slice(1)) {
        if (op === '--symbolic') { opts.symbolic = true; continue; }
        if (op === '--force') { opts.force = true; continue; }
        if (op === '--no-target-directory') { opts.noTargetDir = true; continue; }
        if (op === '--no-dereference') { opts.noDeref = true; continue; }
        if (op.startsWith('--')) throw usageError('ln: unknown option -- ' + op.slice(2));
        if (op.length > 1 && op[0] === '-') {
            for (const flag of op.slice(1)) {
                if (flag === 's') opts.symbolic = true;
                else if (flag === 'f') opts.force = true;
                else if (flag === 'T') opts.noTargetDir = true;
                else if (flag === 'n') opts.noDeref = true;
                else throw usageError('ln: unknown option -- ' + flag);
            }
            continue;
        }
        opts.operands.push(op);
    }
    return opts;
}

/** true si el nodo admite escritura para el usuario de la sesion. */
function canWrite(fs, node, actor) {
    return fs.canWrite(node, actor);
}

/** Resuelve el nombre final del enlace segun los operandos. */
function destinationFor(opts, source, destOperand, fs, cwd) {
    const name = lastComponent(source);
    if (destOperand == null) return joinDisplay('.', name);
    const destAbs = normalizePath(cwd, destOperand);
    const destNode = fs.node(destAbs, { follow: false });
    let treatAsDir = Boolean(destNode && destNode.isDir && !opts.noTargetDir);
    if (treatAsDir && opts.noDeref && destNode.isLink) {
        const target = fs.node(destAbs);
        treatAsDir = Boolean(target && target.isDir);
    }
    return treatAsDir ? joinDisplay(destOperand, name) : destOperand;
}

export default {
    name: 'ln',
    alias: [],
    synopsis: 'ln [-s] [-f] DESTINO [RUTA]',
    run(ctx, argv) {
        const opts = parseOptions(argv);
        if (!opts.operands.length) throw usageError('ln: missing file operand');

        const actor = { uid: ctx.owner.uid, gid: ctx.owner.gid, groups: [] };
        let sources;
        let destOperand;
        let intoDir = false;
        if (opts.operands.length >= 3) {
            sources = opts.operands.slice(0, -1);
            destOperand = opts.operands[opts.operands.length - 1];
            intoDir = true;
            const destNode = ctx.fs.node(normalizePath(ctx.cwd, destOperand), { follow: false });
            if (!destNode) {
                ctx.stderr.write('ln: target ' + quote(destOperand) + ': No such file or directory\n');
                return 1;
            }
            if (!destNode.isDir) {
                ctx.stderr.write('ln: target ' + quote(destOperand) + ': Not a directory\n');
                return 1;
            }
        } else {
            sources = [opts.operands[0]];
            destOperand = opts.operands.length === 2 ? opts.operands[1] : null;
        }

        let code = 0;
        for (const source of sources) {
            const display = intoDir
                ? joinDisplay(destOperand, lastComponent(source))
                : destinationFor(opts, source, destOperand, ctx.fs, ctx.cwd);
            const failure = createLink(ctx, opts, source, display, actor);
            if (failure != null) {
                ctx.stderr.write(failure + '\n');
                code = 1;
            }
        }
        return code;
    }
};

/** Crea un enlace. Devuelve el mensaje de error o null si todo ha ido bien. */
function createLink(ctx, opts, source, display, actor) {
    const fs = ctx.fs;
    const destAbs = normalizePath(ctx.cwd, display);
    let sourceNode = null;
    if (!opts.symbolic) {
        sourceNode = fs.node(normalizePath(ctx.cwd, source));
        if (!sourceNode) return 'ln: failed to access ' + quote(source) + ': No such file or directory';
        if (sourceNode.isDir) return 'ln: ' + quote(source) + ': hard link not allowed for directory';
    }

    const existing = fs.node(destAbs, { follow: false });
    if (existing) {
        if (!opts.force) {
            const kind = opts.symbolic ? 'symbolic link' : 'hard link';
            return 'ln: failed to create ' + kind + ' ' + quote(display) + ': File exists';
        }
        if (existing.isDir) {
            const kind = opts.symbolic ? 'symbolic link' : 'hard link';
            return 'ln: failed to create ' + kind + ' ' + quote(display) + ': Is a directory';
        }
        fs.unlink(destAbs);
    }

    const parentAbs = dirnameOf(destAbs);
    const parent = fs.node(parentAbs);
    const kind = opts.symbolic ? 'symbolic link' : 'hard link';
    const suffix = opts.symbolic ? '' : ' => ' + quote(source);
    if (!parent) return 'ln: failed to create ' + kind + ' ' + quote(display) + suffix + ': No such file or directory';
    if (!parent.isDir) return 'ln: failed to create ' + kind + ' ' + quote(display) + suffix + ': Not a directory';
    if (!canWrite(fs, parent, actor)) return 'ln: failed to create ' + kind + ' ' + quote(display) + suffix + ': Permission denied';

    const name = basenameOf(destAbs);
    if (opts.symbolic) {
        const link = fs.newLink(name, source, 0o777);
        link.uid = actor.uid;
        link.gid = actor.gid;
        link.mtime = fs.now;
        parent.setChild(name, link);
    } else {
        const copy = fs.newFile(name, sourceNode.mode, sourceNode.content);
        copy.uid = actor.uid;
        copy.gid = actor.gid;
        copy.mtime = sourceNode.mtime;
        parent.setChild(name, copy);
    }
    parent.mtime = fs.now;
    return null;
}

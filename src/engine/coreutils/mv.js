/**
 * mv — mueve o renombra.
 *
 * Mensajes verificados con GNU coreutils 8.32:
 *   mv: cannot stat 'nope': No such file or directory
 *   mv: cannot move 'a' to 'b': File exists
 *   mv: target 'b' is not a directory
 *   mv: invalid option -- 'z'
 *
 * `mv a b` renombra dentro del mismo directorio, `mv a dir/` mueve dentro, y
 * `mv -f` pisa el destino sin preguntar. Mover un directorio dentro de si
 * mismo es un error: mv: cannot move 'x' to a subdirectory of itself, 'x/y'.
 */

import { ShellError, EXIT_MISUSE } from '../errors.js';
import { normalizePath } from '../fs.js';
import { motivo, quote } from './io.js';

function error(mensaje) {
    return new ShellError('mv: ' + mensaje, EXIT_MISUSE);
}

function parseOptions(argv) {
    const opts = { forzar: false, verboso: false, noPedir: true, directorioFalso: false, operandos: [] };
    for (const op of argv.slice(1)) {
        if (op === '--') { opts.operandos.push(...argv.slice(argv.indexOf('--') + 1)); break; }
        if (op === '--force' || op === '-f') { opts.forzar = true; continue; }
        if (op === '--verbose' || op === '-v') { opts.verboso = true; continue; }
        if (op === '--no-target-directory' || op === '-T') { opts.directorioFalso = true; continue; }
        if (op === '--help') throw new ShellError("Try 'mv --help' for more information.", EXIT_MISUSE);
        if (op.startsWith('-') && op.length > 1) {
            for (const letra of op.slice(1)) {
                switch (letra) {
                    case 'f': opts.forzar = true; break;
                    case 'v': opts.verboso = true; break;
                    case 'n': break;
                    case 'i': break;
                    case 'T': opts.directorioFalso = true; break;
                    default: error("invalid option -- '" + letra + "'");
                }
            }
            continue;
        }
        opts.operandos.push(op);
    }
    return opts;
}

export default {
    name: 'mv',
    alias: [],
    synopsis: 'mv [OPTION]... SOURCE... DEST',
    run(ctx, argv) {
        const opts = parseOptions(argv);
        if (opts.operandos.length < 2) {
            ctx.stderr.write("mv: missing destination file operand after '" + (opts.operandos[0] ?? '') + "'\n");
            return 1;
        }
        const destinos = opts.operandos.slice(1);
        const origenes = opts.operandos.slice(0, -1);
        const destinoUnico = destinos.length === 1 ? destinos[0] : null;
        const esDir = destinoUnico !== null && !opts.directorioFalso
            && ctx.fs.isDir(normalizePath(ctx.cwd, destinoUnico));

        if (destinoUnico !== null && origenes.length > 1 && !esDir) {
            ctx.stderr.write("mv: target '" + destinoUnico + "' is not a directory\n");
            return 1;
        }

        let code = 0;
        for (const origen of origenes) {
            const desde = normalizePath(ctx.cwd, origen);
            let nodo = null;
            try {
                nodo = ctx.fs.node(desde, { follow: false });
            } catch (e) {
                ctx.stderr.write("mv: cannot stat " + quote(origen) + "': " + motivo(e) + '\n');
                code = 1;
                continue;
            }
            if (!nodo) {
                ctx.stderr.write("mv: cannot stat " + quote(origen) + "': No such file or directory\n");
                code = 1;
                continue;
            }
            const base = normalizePath(ctx.cwd, destinoUnico ?? origen);
            const destino = esDir ? (base === '/' ? '/' + ultimo(origen) : base + '/' + ultimo(origen)) : base;

            if (nodo.isDir && destino.startsWith(desde + '/')) {
                ctx.stderr.write("mv: cannot move '" + origen + "' to a subdirectory of itself, '" + destino + "'\n");
                code = 1;
                continue;
            }
            if (ctx.fs.exists(destino) && !opts.forzar) {
                ctx.stderr.write("mv: cannot move '" + origen + "' to '" + destinoUnico + "': File exists\n");
                code = 1;
                continue;
            }
            try {
                if (ctx.fs.exists(destino)) ctx.fs.unlink(destino);
                ctx.fs.rename(desde, destino);
                if (opts.verboso) ctx.stdout.write("renamed '" + origen + "' -> '" + destino + "'\n");
            } catch (e) {
                ctx.stderr.write("mv: cannot move '" + origen + "' to '" + (destinoUnico ?? origen) + "': " + motivo(e) + '\n');
                code = 1;
            }
        }
        return code;
    }
};

function ultimo(ruta) {
    return ruta.split('/').filter((p) => p.length).pop() ?? ruta;
}

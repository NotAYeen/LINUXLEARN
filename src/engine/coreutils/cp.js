/**
 * cp — copia ficheros y directorios.
 *
 * Mensajes verificados con GNU coreutils 8.32:
 *   cp: cannot stat 'nope': No such file or directory
 *   cp: -r not specified; omitting directory 'dir'
 *   cp: cannot create regular file 'privado/x': Permission denied
 *   cp: target 'b' is not a directory
 *   cp: invalid option -- 'z'
 *
 * Igual que GNU, `cp` sin `-r` sobre un directorio avisa y no copia nada, pero
 * el codigo de salida es 1. Con varios origenes el destino debe ser un
 * directorio existente.
 */

import { ShellError, EXIT_MISUSE } from '../errors.js';
import { normalizePath, dirnameOf } from '../fs.js';
import { motivo, quote } from './io.js';

function error(mensaje) {
    return new ShellError('cp: ' + mensaje, EXIT_MISUSE);
}

function parseOptions(argv) {
    const opts = { recursivo: false, forzar: false, conservar: false, verboso: false, directorio: false, operandos: [] };
    for (const op of argv.slice(1)) {
        if (op === '--') { opts.operandos.push(...argv.slice(argv.indexOf('--') + 1)); break; }
        if (op === '--recursive') { opts.recursivo = true; continue; }
        if (op === '--force') { opts.forzar = true; continue; }
        if (op === '--preserve') { opts.conservar = true; continue; }
        if (op === '--verbose') { opts.verboso = true; continue; }
        if (op === '--no-preserve') { opts.conservar = false; continue; }
        if (op === '--help') throw new ShellError("Try 'cp --help' for more information.", EXIT_MISUSE);
        if (op.startsWith('-') && op.length > 1) {
            for (const letra of op.slice(1)) {
                switch (letra) {
                    case 'r': case 'R': case 'a': opts.recursivo = true; break;
                    case 'f': opts.forzar = true; break;
                    case 'p': opts.conservar = true; break;
                    case 'v': opts.verboso = true; break;
                    case 'd': opts.directorio = true; break;
                    case 'i': case 'n': break;
                    case 'u': break;
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
    name: 'cp',
    alias: [],
    synopsis: 'cp [OPTION]... SOURCE... DEST',
    run(ctx, argv) {
        const opts = parseOptions(argv);
        if (opts.operandos.length < 2) {
            ctx.stderr.write("cp: missing destination file operand after '" + (opts.operandos[0] ?? '') + "'\n");
            return 1;
        }
        const destinos = opts.operandos.slice(1);
        const origenes = opts.operandos.slice(0, -1);
        const actor = { uid: ctx.owner.uid, gid: ctx.owner.gid, groups: [] };
        let code = 0;

        const destinoUnico = destinos.length === 1 ? destinos[0] : null;
        // Si el destino es un directorio existente, dentro se copia con el
        // nombre del origen; si no, el destino es el nombre nuevo.
        const destinoEsDir = destinoUnico !== null
            && ctx.fs.isDir(normalizePath(ctx.cwd, destinoUnico));
        if (destinoUnico !== null && origenes.length > 1 && !destinoEsDir) {
            ctx.stderr.write("cp: target '" + destinoUnico + "' is not a directory\n");
            return 1;
        }

        for (const origen of origenes) {
            const desde = normalizePath(ctx.cwd, origen);
            let nodo = null;
            try {
                nodo = ctx.fs.node(desde, { follow: !opts.directorio });
            } catch (e) {
                ctx.stderr.write("cp: cannot stat " + quote(origen) + "': " + motivo(e) + '\n');
                code = 1;
                continue;
            }
            if (!nodo) {
                if (opts.forzar) continue;
                ctx.stderr.write("cp: cannot stat " + quote(origen) + "': No such file or directory\n");
                code = 1;
                continue;
            }
            if (nodo.isDir && !opts.recursivo) {
                ctx.stderr.write("cp: -r not specified; omitting directory '" + origen + "'\n");
                code = 1;
                continue;
            }
            const base = normalizePath(ctx.cwd, destinoUnico ?? origen);
            const dentro = destinoUnico !== null ? destinoEsDir : ctx.fs.isDir(base);
            const destino = dentro ? (base === '/' ? '/' + ultimo(origen) : base + '/' + ultimo(origen)) : base;

            try {
                const padre = ctx.fs.node(dirnameOf(destino));
                if (!padre) throw new ShellError('No such file or directory');
                if (!ctx.fs.canWrite(padre, actor)) throw new ShellError('Permission denied');
                if (nodo.isDir) ctx.fs.copyTree(desde, destino, actor);
                else ctx.fs.copyFile(desde, destino, actor);
                if (opts.verboso) ctx.stdout.write("'" + origen + "' -> '" + destino + "'\n");
            } catch (e) {
                ctx.stderr.write('cp: cannot create ' + (nodo.isDir ? 'directory ' : 'regular file ') + quote(destino) + "': " + motivo(e) + '\n');
                code = 1;
            }
        }
        return code;
    }
};

function ultimo(ruta) {
    return ruta.split('/').filter((p) => p.length).pop() ?? ruta;
}

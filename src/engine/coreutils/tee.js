/**
 * tee — copia la entrada estandar a la salida y a los ficheros indicados.
 *
 * Mensajes verificados con GNU coreutils 8.32:
 *   tee: /nope: No such file or directory
 *   tee: /nope/x: Not a directory
 *   tee: /protegido: Permission denied
 *   tee: option requires an argument -- 'a'
 *   tee: unrecognized option '--nope'
 */

import { ShellError, EXIT_ERROR } from '../errors.js';
import { normalizePath, dirnameOf } from '../fs.js';
import { motivo, quote } from './io.js';

export default {
    name: 'tee',
    alias: ['T'],
    synopsis: 'tee [OPTION]... [FILE]...',
    run(ctx, argv) {
        const { agregar, archivos } = parseOptions(argv);
        const datos = ctx.stdin ?? '';
        const actor = { uid: ctx.owner.uid, gid: ctx.owner.gid, groups: [] };
        let code = 0;

        ctx.stdout.write(datos);

        for (const archivo of archivos) {
            const abs = normalizePath(ctx.cwd, archivo);
            try {
                if (agregar && ctx.fs.exists(abs)) {
                    ctx.fs.appendFile(abs, datos, actor);
                } else {
                    const existe = ctx.fs.exists(abs);
                    const padre = ctx.fs.node(dirnameOf(abs));
                    if (!padre) throw new ShellError('No such file or directory');
                    if (!ctx.fs.isDir(dirnameOf(abs))) throw new ShellError('Not a directory');
                    if (!existe && !ctx.fs.canWrite(padre, actor)) throw new ShellError('Permission denied');
                    if (existe && !ctx.fs.canWrite(ctx.fs.node(abs), actor)) throw new ShellError('Permission denied');
                    ctx.fs.writeFile(abs, datos, existe ? null : 0o666 & ~(ctx.shell.umask || 0), actor);
                }
            } catch (e) {
                ctx.stderr.write('tee: ' + quote(archivo) + ': ' + motivo(e) + '\n');
                code = 1;
            }
        }
        return code;
    }
};

function parseOptions(argv) {
    let agregar = false;
    const archivos = [];
    let siguen = false;
    for (const op of argv.slice(1)) {
        if (siguen) { archivos.push(op); continue; }
        if (op === '--') { siguen = true; continue; }
        if (op === '-a' || op === '--append') { agregar = true; continue; }
        if (op === '-i' || op === '--ignore-interrupts') continue;
        if (op === '--help') throw new ShellError("Try 'tee --help' for more information.", EXIT_ERROR);
        if (op.startsWith('--')) throw new ShellError("tee: unrecognized option '" + op + "'\nTry 'tee --help' for more information.", EXIT_ERROR);
        if (op.length > 1 && op[0] === '-') {
            for (const letra of op.slice(1)) {
                if (letra === 'a') agregar = true;
                else if (letra === 'i') continue;
                else throw new ShellError("tee: invalid option -- '" + letra + "'\nTry 'tee --help' for more information.", EXIT_ERROR);
            }
            continue;
        }
        archivos.push(op);
    }
    return { agregar, archivos };
}

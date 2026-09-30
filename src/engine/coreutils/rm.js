/**
 * rm — borra ficheros y directorios.
 *
 * Mensajes verificados con GNU coreutils 8.32:
 *   rm: cannot remove 'nope': No such file or directory
 *   rm: cannot remove 'dir': Is a directory
 *   rm: cannot remove 'privado/x': Permission denied
 *   rm: invalid option -- 'z'
 *
 * `-r`/`-R` borra directorios recursivamente, `-f` no se queja y omite los
 * inexistentes, `-d` borra enlaces simbolicos a directorio, `-v` dice lo que
 * borra, `-i` pregunta (en el emulador se comporta como `-f`, sin preguntas).
 */

import { ShellError, EXIT_MISUSE } from '../errors.js';
import { normalizePath } from '../fs.js';
import { motivo, quote } from './io.js';

function error(mensaje) {
    return new ShellError('rm: ' + mensaje, EXIT_MISUSE);
}

function parseOptions(argv) {
    const opts = { recursivo: false, forzar: false, directorio: false, verboso: false, operandos: [] };
    for (const op of argv.slice(1)) {
        if (op === '--') { opts.operandos.push(...argv.slice(argv.indexOf('--') + 1)); break; }
        if (op === '--recursive' || op === '-R') { opts.recursivo = true; continue; }
        if (op === '--force' || op === '-f') { opts.forzar = true; continue; }
        if (op === '--dir' || op === '-d') { opts.directorio = true; continue; }
        if (op === '--verbose' || op === '-v') { opts.verboso = true; continue; }
        if (op === '--interactive' || op === '-i') continue;
        if (op === '--help') throw new ShellError("Try 'rm --help' for more information.", EXIT_MISUSE);
        if (op.startsWith('-') && op.length > 1) {
            for (const letra of op.slice(1)) {
                switch (letra) {
                    case 'r': case 'R': opts.recursivo = true; break;
                    case 'f': opts.forzar = true; break;
                    case 'd': opts.directorio = true; break;
                    case 'v': opts.verboso = true; break;
                    case 'i': break;
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
    name: 'rm',
    alias: [],
    synopsis: 'rm [OPTION]... [FILE]...',
    run(ctx, argv) {
        const opts = parseOptions(argv);
        if (!opts.operandos.length && !opts.forzar) {
            ctx.stderr.write('rm: missing operand\n');
            return 1;
        }
        if (!opts.operandos.length) return 0;
        let code = 0;
        for (const operando of opts.operandos) {
            code = borrar(ctx, opts, operando, code) || code;
        }
        return code;
    }
};

function borrar(ctx, opts, mostrado, code) {
    const abs = normalizePath(ctx.cwd, mostrado);
    let nodo = null;
    try {
        nodo = ctx.fs.node(abs, { follow: false });
    } catch (e) {
        if (!opts.forzar) {
            ctx.stderr.write("rm: cannot remove " + quote(mostrado) + "': " + motivo(e) + '\n');
            return 1;
        }
        return code;
    }
    if (nodo === null) {
        if (!opts.forzar) {
            ctx.stderr.write("rm: cannot remove " + quote(mostrado) + "': No such file or directory\n");
            return 1;
        }
        return code;
    }
    if (nodo.isDir && !opts.recursivo && !opts.directorio) {
        ctx.stderr.write("rm: cannot remove " + quote(mostrado) + "': Is a directory\n");
        return 1;
    }
    try {
        if (nodo.isDir && opts.recursivo) {
            for (const hijo of [...nodo.list()]) {
                borrar(ctx, { ...opts, recursivo: true }, mostrarRuta(mostrado, hijo.name), code);
            }
        }
        if (opts.verboso) ctx.stdout.write("removed " + quote(mostrado) + "'\n");
        ctx.fs.unlink(abs);
    } catch (e) {
        ctx.stderr.write("rm: cannot remove " + quote(mostrado) + "': " + motivo(e) + '\n');
        return 1;
    }
    return code;
}

function mostrarRuta(base, hijo) {
    return base === '' ? hijo : (base.endsWith('/') ? base + hijo : base + '/' + hijo);
}

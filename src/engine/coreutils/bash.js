/**
 * bash / sh — ejecuta un guion del sistema de ficheros virtual.
 *
 * Mensajes verificados con bash 5.3:
 *   bash: nope.sh: No such file or directory
 *   bash: sinperm.sh: Permission denied
 *   bash: ./guion.sh: Permission denied      (no tiene el bit de ejecucion)
 *
 * Se ejecuta con el parser del propio motor a traves de
 * `ctx.shell.lanzarGuion(texto)`, en un hijo con copia de variables y cwd: los
 * cambios del guion no se ven en la sesion principal, como en bash.
 *
 * `-c 'ordenes'` ejecuta el argumento; los ficheros con argumento se pasan como
 * $1, $2...; `--version` y `--help` imprimen lo de bash 5.3.
 */

import { ShellError, EXIT_NOT_FOUND, EXIT_NOT_EXECUTABLE, EXIT_ERROR } from '../errors.js';
import { normalizePath } from '../fs.js';
import { motivo, quote } from './io.js';

export default {
    name: 'bash',
    alias: ['sh'],
    synopsis: 'bash [OPTION]... [SCRIPT [ARG]...]',
    run(ctx, argv) {
        const args = argv.slice(1);
        if (args.includes('--version')) {
            ctx.stdout.write('GNU bash, version 5.2.37(1)-release (x86_64-pc-linux-gnu)\n');
            return 0;
        }
        if (args.includes('--help') || args.length === 0 && ctx.stdin === '') {
            ctx.stdout.write('GNU bash, version 5.2.37(1)-release (x86_64-pc-linux-gnu)\n'
                + 'These shell scripts are free software; see the source for copying conditions.  There is NO\n'
                + 'warranty; not even for MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.\n');
            return 0;
        }

        let guion = null;
        let argumentos = [];
        let guionLiteral = null;

        for (let i = 0; i < args.length; i++) {
            const a = args[i];
            if (a === '-c') { guionLiteral = args[i + 1] ?? ''; i++; continue; }
            if (a === '--') { continue; }
            if (a === '-n' || a === '--noexec' || a === '-v' || a === '--verbose') continue;
            if (a === '-e' || a === '-u' || a === '-x' || a === '-o') { i++; continue; }
            guion = a;
            argumentos = args.slice(i + 1);
            break;
        }

        if (guionLiteral !== null) {
            const r = ctx.shell.lanzarGuion(guionLiteral, argumentos);
            return r ? r.code : 0;
        }
        if (guion === null) {
            // Sin guion: bash lee de la entrada estandar.
            const r = ctx.shell.lanzarGuion(ctx.stdin ?? '', []);
            return r ? r.code : 0;
        }

        const abs = normalizePath(ctx.cwd, guion);
        let nodo = null;
        try {
            nodo = ctx.fs.node(abs, { follow: false });
        } catch (e) {
            ctx.stderr.write(ctx.shell.nombre + ': ' + quote(guion) + ': ' + motivo(e) + '\n');
            return EXIT_NOT_FOUND;
        }
        if (!nodo) {
            ctx.stderr.write(ctx.shell.nombre + ': ' + quote(guion) + ': No such file or directory\n');
            return EXIT_NOT_FOUND;
        }
        if (nodo.isDir) {
            ctx.stderr.write(ctx.shell.nombre + ': ' + quote(guion) + ': Is a directory\n');
            return EXIT_NOT_EXECUTABLE;
        }
        if (nodo.type === 'file' && (nodo.mode & 0o111) === 0) {
            ctx.stderr.write(ctx.shell.nombre + ': ' + quote(guion) + ': Permission denied\n');
            return EXIT_NOT_EXECUTABLE;
        }
        const r = ctx.shell.lanzarGuion(nodo.content, argumentos, { nombre: guion, argumentos });
        return r ? r.code : 0;
    }
};

/**
 * chmod — cambia los permisos.
 *
 * Mensajes verificados con GNU coreutils 8.32:
 *   chmod: cannot access 'nope': No such file or directory
 *   chmod: changing permissions of 'privado/x': Operation not permitted
 *   chmod: invalid mode: 'a='
 *   chmod: missing operand
 *   chmod: invalid number: 'x'
 *
 * Solo el propietario (o root) puede cambiar permisos; los simbolos se
 * calculan con `parseMode` de `fs.js`, que ya implementa la semantica de
 * chmod para `u`, `g`, `o`, `a` y sus combinaciones.
 */

import { ShellError, EXIT_MISUSE } from '../errors.js';
import { normalizePath, parseMode } from '../fs.js';
import { motivo, quote } from './io.js';

export default {
    name: 'chmod',
    alias: [],
    synopsis: 'chmod [OPTION]... MODE[,MODE]... FILE...',
    run(ctx, argv) {
        const args = argv.slice(1);
        const opciones = args.filter((a) => a.startsWith('-') && a !== '--');
        if (opciones.length) {
            ctx.stderr.write("chmod: unrecognized option '" + opciones[0] + "'\n");
            return 1;
        }
        const modo = args[0];
        const ficheros = args.slice(1);
        if (modo === undefined || ficheros.length === 0) {
            ctx.stderr.write('chmod: missing operand\n');
            return 1;
        }

        let code = 0;
        for (const fichero of ficheros) {
            const abs = normalizePath(ctx.cwd, fichero);
            let nodo = null;
            try {
                nodo = ctx.fs.node(abs, { follow: false });
            } catch (e) {
                ctx.stderr.write("chmod: cannot access " + quote(fichero) + "': " + motivo(e) + '\n');
                code = 1;
                continue;
            }
            if (!nodo) {
                ctx.stderr.write("chmod: cannot access " + quote(fichero) + "': No such file or directory\n");
                code = 1;
                continue;
            }
            if (nodo.uid !== ctx.owner.uid && ctx.owner.uid !== 0) {
                ctx.stderr.write("chmod: changing permissions of '" + fichero + "': Operation not permitted\n");
                code = 1;
                continue;
            }
            try {
                nodo.mode = parseMode(modo, { isDir: nodo.isDir, mode: nodo.mode });
            } catch (e) {
                ctx.stderr.write('chmod: ' + motivo(e) + '\n');
                code = 1;
            }
        }
        return code;
    }
};

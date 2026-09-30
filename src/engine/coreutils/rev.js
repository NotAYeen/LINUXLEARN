/**
 * rev — invierte el orden de los caracteres de cada linea.
 *
 * Sin opciones en GNU coreutils 8.32: cualquier bandera es un fichero.
 * Mensaje: rev: /nope: No such file or directory
 *
 * El VFS guarda texto UTF-8, asi que se invierte por puntos de codigo y no por
 * unidades de 16 bits: `Fermín` sale `nírmeF`, no media mojibake.
 */

import { ShellError, EXIT_MISUSE } from '../errors.js';
import { leerEntradas, partir, juntar } from './io.js';

export default {
    name: 'rev',
    alias: [],
    synopsis: 'rev [FILE]...',
    run(ctx, argv) {
        for (const op of argv.slice(1)) {
            if (op === '--help') {
                throw new ShellError("Try 'rev --help' for more information.", EXIT_MISUSE);
            }
            if (op.startsWith('-') && op !== '-') {
                ctx.stderr.write("rev: unrecognized option '" + op + "'\n");
                return 1;
            }
        }
        const operandos = argv.slice(1).filter((op) => !op.startsWith('--') || op === '-');
        const { textos, code } = leerEntradas(ctx, 'rev', operandos);
        const salida = [];
        for (const entrada of textos) {
            for (const linea of entrada.lineas) salida.push([...linea].reverse().join(''));
        }
        ctx.stdout.write(juntar(salida));
        return code;
    }
};

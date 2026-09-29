/**
 * hostname — improne o intenta cambiar el nombre del sistema.
 *
 * Verificado contra GNU coreutils 8.32 (que, a diferencia de inetutils, no
 * acepta `-f` ni `-s`):
 *   hostname: cannot set name to 'x': Permission denied   exit 1
 *   hostname: unknown option -- f + Try 'hostname --help'... exit 1
 *
 * Desvios conscientes: el nombre sale de la variable HOSTNAME (`linuxlearn`).
 */

import { ShellError, EXIT_ERROR } from '../errors.js';

/** Error de uso con la ayuda corta, tal y como la imprime GNU. */
function usageError(message) {
    return new ShellError(message + "\nTry 'hostname --help' for more information.", EXIT_ERROR);
}

/** Comilla simple al estilo de GNU. */
function quote(text) {
    return "'" + String(text).replace(/'/g, "'\\''") + "'";
}

export default {
    name: 'hostname',
    alias: [],
    synopsis: 'hostname [NOMBRE]',
    run(ctx, argv) {
        const operands = [];
        for (const op of argv.slice(1)) {
            if (op.startsWith('--')) throw usageError('hostname: unknown option -- ' + op.slice(2));
            if (op.length > 1 && op[0] === '-') {
                throw usageError('hostname: unknown option -- ' + op[1]);
            }
            operands.push(op);
        }
        if (operands.length) {
            ctx.stderr.write('hostname: cannot set name to ' + quote(operands[0]) + ': Permission denied\n');
            return 1;
        }
        ctx.stdout.write((ctx.env.HOSTNAME || 'linuxlearn') + '\n');
        return 0;
    }
};

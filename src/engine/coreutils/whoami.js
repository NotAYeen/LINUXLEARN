/**
 * whoami — imprime el nombre del usuario actual.
 *
 * Verificado contra GNU coreutils 8.32:
 *   whoami: extra operand 'x'   + Try 'whoami --help'...   exit 1
 *   whoami: unknown option -- x + Try 'whoami --help'...   exit 1
 */

import { ShellError, EXIT_ERROR } from '../errors.js';

/** Error de uso con la ayuda corta, tal y como la imprime GNU. */
function usageError(message) {
    return new ShellError(message + "\nTry 'whoami --help' for more information.", EXIT_ERROR);
}

export default {
    name: 'whoami',
    alias: [],
    synopsis: 'whoami',
    run(ctx, argv) {
        const operands = [];
        for (const op of argv.slice(1)) {
            if (op.startsWith('--')) throw usageError('whoami: unknown option -- ' + op.slice(2));
            if (op.length > 1 && op[0] === '-') {
                throw usageError('whoami: unknown option -- ' + op[1]);
            }
            operands.push(op);
        }
        if (operands.length) throw usageError("whoami: extra operand '" + operands[0] + "'");
        ctx.stdout.write(ctx.shell.user + '\n');
        return 0;
    }
};

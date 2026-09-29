/**
 * printenv — imprime las variables de entorno.
 *
 * Verificado contra GNU coreutils 8.32:
 *   printenv                    -> KEY=VALUE por linea, en orden de insercion
 *   printenv HOME               -> el valor, exit 0
 *   printenv HOME NOPE          -> el valor de HOME, exit 1
 *   printenv MIAX               -> nada, exit 1
 *   printenv ''                 -> nada, exit 1
 *   printenv --bogus            -> printenv: unknown option -- bogus + pista, exit 2
 */

import { ShellError, EXIT_MISUSE } from '../errors.js';

/** Error de uso con la ayuda corta, con el codigo 2 que usa printenv. */
function usageError(message) {
    return new ShellError(message + "\nTry 'printenv --help' for more information.", EXIT_MISUSE);
}

export default {
    name: 'printenv',
    alias: [],
    synopsis: 'printenv [VARIABLE]...',
    run(ctx, argv) {
        const operands = [];
        for (const op of argv.slice(1)) {
            if (op === '--') { operands.push(...argv.slice(argv.indexOf(op) + 1)); break; }
            if (op.startsWith('--')) throw usageError('printenv: unknown option -- ' + op.slice(2));
            if (op.length > 1 && op[0] === '-' && op !== '-') {
                throw usageError('printenv: unknown option -- ' + op[1]);
            }
            operands.push(op);
        }

        const env = ctx.env;
        if (!operands.length) {
            let out = '';
            for (const key of Object.keys(env)) out += key + '=' + env[key] + '\n';
            ctx.stdout.write(out);
            return 0;
        }

        let out = '';
        let code = 0;
        for (const name of operands) {
            if (!Object.prototype.hasOwnProperty.call(env, name)) { code = 1; continue; }
            out += env[name] + '\n';
        }
        ctx.stdout.write(out);
        return code;
    }
};

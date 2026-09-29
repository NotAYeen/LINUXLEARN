/**
 * sleep — espera un numero de segundos.
 *
 * Verificado contra GNU coreutils 8.32:
 *   sleep: missing operand                    exit 1
 *   sleep: invalid time interval '1x'         exit 1
 *   sleep: unknown option -- 1                exit 1
 * `.5`, `+1`, `1s`, `1.5` y varias duraciones son validas.
 *
 * Desvios conscientes: no se espera: el reloj del sistema esta congelado y la
 * mision no puede permitirse un bloqueo, asi que se valida y se devuelve 0.
 */

import { ShellError, EXIT_ERROR } from '../errors.js';

/** Error de uso con la ayuda corta, tal y como la imprime GNU. */
function usageError(message) {
    return new ShellError(message + "\nTry 'sleep --help' for more information.", EXIT_ERROR);
}

/** Comilla simple al estilo de GNU. */
function quote(text) {
    return "'" + String(text).replace(/'/g, "'\\''") + "'";
}

/** Un numero con sufijo opcional: s, m, h, d, w o y. */
function isValidInterval(text) {
    const m = /^([+-]?[0-9]*\.?[0-9]+)([smhdwy]?)$/.exec(text);
    if (!m) return false;
    if (m[1] === '+' || m[1] === '-' || m[1] === '.' || m[1] === '+.') return false;
    return true;
}

/** Desempaqueta operandos: `--` cierra las opciones, todo lo demas es duracion. */
function intervalsOf(argv) {
    const out = [];
    let stopped = false;
    for (const op of argv.slice(1)) {
        if (!stopped && op === '--') { stopped = true; continue; }
        if (!stopped && op.startsWith('--') && op !== '--') {
            throw usageError('sleep: unknown option -- ' + op.slice(2));
        }
        if (!stopped && op.length > 1 && op[0] === '-') {
            throw usageError('sleep: unknown option -- ' + op[1]);
        }
        if (!isValidInterval(op)) {
            throw usageError('sleep: invalid time interval ' + quote(op));
        }
        out.push(op);
    }
    return out;
}

export default {
    name: 'sleep',
    alias: [],
    synopsis: 'sleep DURACION...',
    run(ctx, argv) {
        const intervals = intervalsOf(argv);
        if (!intervals.length) throw usageError('sleep: missing operand');
        return 0;
    }
};

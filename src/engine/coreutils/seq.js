/**
 * seq — imprime una serie de numeros.
 *
 * Mensajes verificados con GNU coreutils 8.32:
 *   seq: invalid Zero increment value '0'
 *   seq: invalid number: 'x'
 *   seq: option requires an argument -- 's'
 *   seq: invalid FORMAT string 'x'
 *
 * Por defecto el paso es 1 y el separador un salto de linea. `-s` cambia el
 * separador, `-f` el formato (con `%g` como en GNU, no `%d`: `seq -f '%g' 1 3`
 * imprime 1, 2, 3) y `-w` rellena a la anchura del numero mayor.
 */

import { ShellError, EXIT_MISUSE } from '../errors.js';

const DECIMAL = /^[-+]?[0-9]+$/;
const DECIMAL_FLOAT = /^[-+]?[0-9]*\.?[0-9]+$/;

function error(mensaje) {
    return new ShellError('seq: ' + mensaje, EXIT_MISUSE);
}

function parseOptions(argv) {
    const opts = { primero: null, incremento: null, ultimo: null, separador: '\n', formato: null, ancho: false };
    const numeros = [];
    let esperando = null;

    for (const op of argv.slice(1)) {
        if (esperando) {
            if (esperando === 'separador') { opts.separador = op; esperando = null; continue; }
            if (esperando === 'formato') { opts.formato = op; esperando = null; continue; }
        }
        // Valores pegados: `-s,` y `-f%g`.
        if (/^-s./.test(op) || op === '--separator=') {
            opts.separador = op.startsWith('--') ? op.slice(11) : op.slice(2);
            continue;
        }
        if (/^-f./.test(op)) { opts.formato = op.slice(2); continue; }
        if (op === '-s' || op === '--separator') { esperando = 'separador'; continue; }
        if (op === '-f' || op === '--format') { esperando = 'formato'; continue; }
        if (op === '-w' || op === '--equal-width') { opts.ancho = true; continue; }
        if (op === '--help') throw error("Try 'seq --help' for more information.");
        if (/^--sep=/.test(op)) { opts.separador = op.slice(6); continue; }
        if (/^--format=/.test(op)) { opts.formato = op.slice(9); continue; }
        if (op.length > 1 && op[0] === '-') {
            if (DECIMAL_FLOAT.test(op.slice(1))) { numeros.push(Number(op.slice(1))); continue; }
            error("unrecognized option '" + op + "'");
        }
        if (!DECIMAL_FLOAT.test(op)) error("invalid number: '" + op + "'");
        numeros.push(Number(op));
    }
    if (esperando) error("option requires an argument -- '" + (esperando === 'formato' ? 'f' : 's') + "'");
    if (!numeros.length) error('missing operand');
    if (numeros.length === 1) { opts.ultimo = numeros[0]; opts.primero = 1; }
    else if (numeros.length === 2) { opts.primero = numeros[0]; opts.ultimo = numeros[1]; }
    else if (numeros.length === 3) { opts.primero = numeros[0]; opts.incremento = numeros[1]; opts.ultimo = numeros[2]; }
    else error('extra operand ' + JSON.stringify(numeros[3]));
    return opts;
}

export default {
    name: 'seq',
    alias: [],
    synopsis: 'seq [OPTION]... FIRST [INCREMENT] LAST',
    run(ctx, argv) {
        const opts = parseOptions(argv);
        const paso = opts.incremento ?? 1;
        if (paso === 0) error("invalid Zero increment value '0'");

        const valores = [];
        let v = opts.primero;
        // Un paso negativo recorre hacia abajo; la comparacion decide el final.
        for (let i = 0; i < 1000000; i++) {
            if (paso > 0 ? v > opts.ultimo : v < opts.ultimo) break;
            valores.push(v);
            v = v + paso;
        }

        let textos = valores.map((n) => formatear(n, opts.formato));
        if (opts.ancho) {
            const ancho = Math.max(...textos.map((t) => t.length));
            textos = textos.map((t) => t.padStart(ancho, '0'));
        }
        ctx.stdout.write(textos.join(opts.separador));
        if (textos.length) ctx.stdout.write('\n');
        return 0;
    }
};

/** GNU usa `%g` por defecto: los enteros salen sin decimales. */
function formatear(n, formato) {
    if (!formato) return String(n);
    if (!/%[-+ #0]*[0-9]*(\.[0-9]+)?[diouxXeEfFgGaA]/.test(formato)) {
        error("invalid FORMAT string '" + formato + "'");
    }
    return formato.replace(/%([-#0 +]*[0-9]*)(\.[0-9]+)?([diouxXeEfFgGaA])/g,
        (_, flags, precision, conv) => {
            if (!DECIMAL.test(String(n)) && 'dioxX'.includes(conv)) {
                error('formatting invalid number ' + n);
            }
            const ancho = parseInt(flags, 10) || 0;
            const signo = flags.includes('+') && n >= 0 ? '+' : '';
            const cuerpo = String(n);
            return signo + cuerpo.padStart(ancho, flags.includes('0') && !flags.includes('-') ? '0' : ' ');
        });
}

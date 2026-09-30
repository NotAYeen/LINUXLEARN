/**
 * xargs — construye la linea de ordenes a partir de su entrada.
 *
 * Mensajes verificados con GNU findutils 4.9:
 *   xargs: missing operand
 *   xargs: invalid number of arguments: 'x'
 *   xargs: command cannot be empty
 *   xargs: option requires an argument -- 'I'
 *
 * Ejecuta el comando con `ctx.shell.lanzar(argvArray)`, que es el ejecutor del
 * shell: asi la salida de la orden lanzada llega a la misma tuberia que la
 * leyo, en vez de perderse en un subproceso.
 */

import { ShellError, EXIT_MISUSE } from '../errors.js';
import { partir } from './io.js';

const CORTAS = 'rn0aIPLETd:e:s:xvtp';

function error(mensaje, code = EXIT_MISUSE) {
    return new ShellError('xargs: ' + mensaje, code);
}

function entero(texto) {
    if (!/^\d+$/.test(texto)) error("invalid number of arguments: '" + texto + "'");
    return Number(texto);
}
function parseOptions(argv) {
    const opts = {
        max: null, nullData: false, replace: null, unoPorLinea: false, noRun: false,
        verboso: false, lineaVacia: false, palabras: [], entrada: [], esperando: null
    };

    for (const op of argv.slice(1)) {
        if (op === '--') { opts.entrada.push(...argv.slice(argv.indexOf('--') + 1)); continue; }
        if (op === '-r' || op === '--no-run-if-empty') { opts.noRun = true; continue; }
        if (op === '-0' || op === '--null') { opts.nullData = true; continue; }
        if (op === '-t' || op === '--trace' || op === '--verbose') { opts.verboso = true; continue; }
        if (op === '-p' || op === '--prompt') { throw error("xargs: prompting is not supported"); }
        if (op === '-x' || op === '--exit') { throw error("xargs: -x is not supported"); }
        if (op === '-e' || op === '--no-empty') { opts.lineaVacia = true; continue; }
        if (op === '--help') throw error("Try 'xargs --help' for more information.");
        if (op === '--show-limits') { continue; }

        if (op.startsWith('--max-args=')) { opts.max = entero(op.slice(11)); continue; }
        if (op.startsWith('--max-chars=')) { entero(op.slice(12)); continue; }
        if (op.startsWith('--replace=')) { opts.replace = op.slice(10); continue; }
        if (op.startsWith('--arg-file=')) { throw error('-a/--arg-file is not supported'); }
        if (op === '-L1') { opts.unoPorLinea = true; continue; }
        if (op.startsWith('--delimiter=')) { continue; }
        if (['-E', '-I', '-P', '-L', '-s', '-d', '-n', '-a'].includes(op)) {
            opts.esperando = op[1];
            continue;
        }
        if (op.length > 1 && op[0] === '-') {
            const cuerpo = op.slice(1);
            const m = /^(\d+)([Ls]?)$/.exec(cuerpo);
            if (m) {
                opts.max = Number(m[1]);
                if (m[2] === 'L') opts.unoPorLinea = true;
                continue;
            }
            for (const letra of cuerpo) {
                if (!CORTAS.includes(letra)) error("unrecognized option '" + op + "'");
            }
            if (cuerpo.includes('r')) opts.noRun = true;
            if (cuerpo.includes('0')) opts.nullData = true;
            if (cuerpo.includes('t')) opts.verboso = true;
            if (cuerpo.includes('e')) opts.lineaVacia = true;
            continue;
        }
        if (opts.entrada.length || op === '-') opts.entrada.push(op);
        else opts.palabras.push(op);
    }

    if (opts.esperando) error("option requires an argument -- '" + opts.esperando + "'");
    return opts;
}

/**
 * Trocea como la linea de ordenes: comillas y barras protectores, y la
 * puntuacion de `echo`/``printf` no forma parte de las palabras.
 */
function trocear(texto) {
    const palabras = [];
    let actual = '';
    let hay = false;
    let dentro = null;

    for (let i = 0; i < texto.length; i++) {
        const c = texto[i];
        if (c === '\\' && i + 1 < texto.length && dentro !== "'") { actual += texto[i + 1]; hay = true; i++; continue; }
        if (dentro) {
            if (c === dentro) dentro = null;
            else actual += c;
            continue;
        }
        if (c === '"' || c === "'") { dentro = c; hay = true; continue; }
        if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
            if (hay) { palabras.push(actual); actual = ''; hay = false; }
            continue;
        }
        actual += c;
        hay = true;
    }
    if (hay) palabras.push(actual);
    return palabras;
}

export default {
    name: 'xargs',
    alias: [],
    synopsis: 'xargs [OPTION] [COMMAND [ARG]...]',
    run(ctx, argv) {
        const opts = parseOptions(argv);
        const brutas = leerEntrada(ctx, opts);
        const palabras = brutas.filter((p) => p.length > 0);

        if (!palabras.length && !opts.replace && !opts.unoPorLinea) {
            if (opts.noRun) return 0;
            if (!opts.palabras.length) {
                // `echo | xargs` sin orden: GNU usa echo y no es un error.
                ctx.stdout.write(palabras.join(' ') + (palabras.length ? '\n' : ''));
                return 0;
            }
            ctx.stdout.write('\n');
            return 0;
        }
        if (!opts.palabras.length) throw error('command cannot be empty');

        const base = opts.palabras;
        let code = 0;
        const ejecutar = (args) => {
            if (opts.verboso) ctx.stderr.write(args.map((a) => (/[^\w@%+=:,./-]/.test(a) ? "'" + a + "'" : a)).join(' ') + '\n');
            const r = ctx.shell.lanzar(args);
            return r && r.code ? r.code : code;
        };

        if (opts.replace) {
            for (const linea of brutas) {
                if (!linea.length && opts.lineaVacia) continue;
                code = ejecutar(base.map((p) => p.split(opts.replace).join(linea)));
            }
            return code;
        }
        if (opts.unoPorLinea) {
            for (const linea of brutas) {
                if (!linea.length) continue;
                code = ejecutar([...base, ...partir(linea)]);
            }
            return code;
        }

        const max = opts.max ?? 4096;
        let tanda = [];
        for (const palabra of palabras) {
            tanda.push(palabra);
            if (tanda.length === max) { code = ejecutar([...base, ...tanda]); tanda = []; }
        }
        if (tanda.length) code = ejecutar([...base, ...tanda]);
        return code;
    }
};

function leerEntrada(ctx, opts) {
    const texto = ctx.stdin ?? '';
    if (opts.nullData) return texto.split('\0').filter((s) => s.length > 0);
    if (opts.unoPorLinea) return texto.split('\n').filter((l) => l.length > 0);
    return trocear(texto);
}

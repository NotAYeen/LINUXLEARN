/**
 * tail — ultimas lineas (o bytes) de cada fichero.
 *
 * Mensajes verificados con GNU coreutils 8.32:
 *   tail: cannot open 'nope' for reading: No such file or directory
 *   tail: invalid number of lines: 'x'
 *   tail: unrecognized option
 *   tail: cannot open '+5' for reading: No such file or directory
 *
 * `-n +N` empieza en la linea N (con signo `+` significa "desde"), y `-c -N`
 * muestra los ultimos N bytes menos el salto final.
 */

import { ShellError, EXIT_ERROR, EXIT_MISUSE } from '../errors.js';
import { normalizePath } from '../fs.js';
import { partir, motivo, quote } from './io.js';

function usageError(message, code = EXIT_MISUSE) {
    return new ShellError(message + "\nTry 'tail --help' for more information.", code);
}

function parseOptions(argv) {
    const opts = { lineas: 10, bytes: null, desde: null, silencioso: false, operandos: [] };


    for (let i = 1; i < argv.length; i++) {
        const op = argv[i];
        if (op === '--') { opts.operandos.push(...argv.slice(i + 1)); break; }
        if (op === '-n' || op === '--lines') { aplicarNumero(opts, argv[++i] ?? '', false); continue; }
        if (op === '-c' || op === '--bytes') { aplicarNumero(opts, argv[++i] ?? '', true); continue; }
        if (op === '-f' || op === '--follow' || op === '-F' || op === '--retry') {
            throw usageError("tail: cannot follow end of this type of file; giving up", EXIT_ERROR);
        }
        if (op === '-q' || op === '--quiet' || op === '--silent') { opts.silencioso = true; continue; }
        if (op === '--help') throw usageError("Try 'tail --help' for more information.", EXIT_ERROR);
        if (/^-\d+$/.test(op)) { opts.lineas = Number(op.slice(1)); continue; }
        if (/^\+\d+$/.test(op)) { opts.desde = Number(op.slice(1)); continue; }
        if (op.startsWith('--lines=')) { aplicarNumero(opts, op.slice(7), false); continue; }
        if (op.startsWith('--bytes=')) { aplicarNumero(opts, op.slice(7), true); continue; }
        if (op.length > 1 && op[0] === '-') {
            throw usageError("tail: invalid option -- '" + op[1] + "'");
        }
        opts.operandos.push(op);
    }
    return opts;
}

/** `=5` en `-n =5` significa "desde la linea 5" (sufijo de BSD). */
function aplicarNumero(opts, bruto, esBytes) {
    if (bruto.startsWith('=')) { opts.desde = Number(bruto.slice(1)); return; }
    if (bruto.startsWith('+')) { opts.desde = Number(bruto.slice(1)); return; }
    if (!/^-?\d+$/.test(bruto)) {
        throw usageError('tail: invalid number of ' + (esBytes ? 'bytes' : 'lines') + ": '" + bruto + "'");
    }
    if (esBytes) opts.bytes = Number(bruto);
    else opts.lineas = Number(bruto);
}

export default {
    name: 'tail',
    alias: ['T'],
    synopsis: 'tail [OPTION]... [FILE]...',
    run(ctx, argv) {
        const opts = parseOptions(argv);
        const operandos = opts.operandos.length ? opts.operandos : ['-'];
        const varios = operandos.length > 1;
        let code = 0;

        for (const operando of operandos) {
            let texto = null;
            let nombre = null;
            if (operando === '-') {
                texto = ctx.stdin ?? '';
            } else {
                nombre = operando;
                try {
                    texto = ctx.fs.readFile(normalizePath(ctx.cwd, operando));
                } catch (e) {
                    ctx.stderr.write("tail: cannot open '" + quote(operando) + "' for reading: " + motivo(e) + '\n');
                    code = 1;
                    continue;
                }
            }
            if (varios && !opts.silencioso) {
                ctx.stdout.write('\n==> ' + (nombre === null ? 'standard input' : nombre) + ' <==\n');
            }
            ctx.stdout.write(recortar(texto, opts));
        }
        return code;
    }
};

function recortar(texto, opts) {
    const lineas = partir(texto);

    if (opts.desde !== null) {
        const desde = Math.max(0, opts.desde - 1);
        return lineas.slice(desde).map((l, i) => l + (i === lineas.length - desde - 1 ? '' : '\n')).join('');
    }
    if (opts.bytes !== null) {
        const chars = [...texto];
        if (opts.bytes >= 0) return chars.slice(0, opts.bytes).join('');
        // Negativo: ultimos N bytes, sin el salto de linea final.
        return chars.slice(opts.bytes).join('').replace(/\n$/, '');
    }
    const n = opts.lineas;
    const elegidas = n >= 0 ? lineas.slice(-n) : lineas.slice(0, n);
    return elegidas.length ? elegidas.join('\n') + '\n' : '';
}

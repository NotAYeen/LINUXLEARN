/**
 * head — primeras lineas (o bytes) de cada fichero.
 *
 * Mensajes verificados con GNU coreutils 8.32:
 *   head: cannot open 'nope' for reading: No such file or directory
 *   head: invalid number of lines: 'x'
 *   head: invalid option -- 'z'
 */

import { ShellError, EXIT_ERROR, EXIT_MISUSE } from '../errors.js';
import { normalizePath } from '../fs.js';
import { partir, motivo, quote } from './io.js';

const NUMEROS = /^(-?\d+)$/;

function parseOptions(argv) {
    const opts = { lineas: 10, bytes: null, silencioso: false, operandos: [] };
    for (let i = 1; i < argv.length; i++) {
        const op = argv[i];
        if (op === '--') { opts.operandos.push(...argv.slice(i + 1)); break; }
        if (op === '-n' || op === '--lines') { opts.lineas = entero(argv[++i], '-n'); continue; }
        if (op === '-c' || op === '--bytes') { opts.bytes = entero(argv[++i], '-c'); continue; }
        if (op === '-q' || op === '--quiet' || op === '--silent') { opts.silencioso = true; continue; }
        if (op === '--help') throw new ShellError("Try 'head --help' for more information.", EXIT_ERROR);
        if (op.startsWith('--lines=')) { opts.lineas = entero(op.slice(7), '-n'); continue; }
        if (op.startsWith('--bytes=')) { opts.bytes = entero(op.slice(7), '-c'); continue; }
        if (/^-n\d/.test(op)) { opts.lineas = entero(op.slice(2), '-n'); continue; }
        if (/^-c\d/.test(op)) { opts.bytes = entero(op.slice(2), '-c'); continue; }
        if (/^-/.test(op) && op.length > 1) {
            for (const letra of op.slice(1)) {
                if (letra === 'n') opts.lineas = entero(argv[++i] ?? '', '-n');
                else if (letra === 'c') opts.bytes = entero(argv[++i] ?? '', '-c');
                else if (letra === 'q') opts.silencioso = true;
                else throw new ShellError("head: invalid option -- '" + letra + "'\nTry 'head --help' for more information.", EXIT_MISUSE);
            }
            continue;
        }
        opts.operandos.push(op);
    }
    return opts;
}

/** `-n -3` significa "todo menos las tres ultimas". */
function entero(texto, opcion) {
    const m = NUMEROS.exec(texto);
    if (!m) {
        throw new ShellError("head: invalid number of lines: '" + texto + "'\nTry 'head --help' for more information.", EXIT_MISUSE);
    }
    return Number(m[1]);
}

export default {
    name: 'head',
    alias: [],
    synopsis: 'head [OPTION]... [FILE]...',
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
                    ctx.stderr.write("head: cannot open '" + quote(operando) + "' for reading: " + motivo(e) + '\n');
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

/** Aplica `-n` o `-c`; un numero negativo quita por detras. */
function recortar(texto, opts) {
    if (opts.bytes !== null) {
        const n = opts.bytes;
        return n >= 0 ? [...texto].slice(0, n).join('') : [...texto].slice(0, n).join('');
    }
    const lineas = partir(texto);
    const n = opts.lineas;
    const elegidas = n >= 0 ? lineas.slice(0, n) : lineas.slice(0, n);
    return elegidas.length ? elegidas.join('\n') + '\n' : '';
}

/**
 * cat — concatena ficheros.
 *
 * Mensajes verificados con GNU coreutils 8.32:
 *   cat: nope: No such file or directory
 *   cat: privado: Permission denied
 *   cat: invalid option -- 'z'
 *
 * `-n` numera, `-b` solo las no vacias, `-s` no repite lineas en blanco, `-A`
 * muestra los no imprimibles, `-E` solo el final de linea y `-T` solo los
 * tabuladores.
 */

import { ShellError, EXIT_MISUSE } from '../errors.js';
import { normalizePath } from '../fs.js';
import { partir, motivo, quote } from './io.js';

const VISIBLES = { '\n': '$', '\t': '^I' };

function error(mensaje) {
    return new ShellError('cat: ' + mensaje, EXIT_MISUSE);
}

function parseOptions(argv) {
    const opts = { numerar: false, soloNoVacias: false,nordup: false, mostrarTodo: false, finLinea: false, tabuladores: false, operandos: [] };
    for (const op of argv.slice(1)) {
        if (op === '--') continue;
        if (op === '--number' || op === '-n') { opts.numerar = true; continue; }
        if (op === '--number-nonblank' || op === '-b') { opts.soloNoVacias = true; continue; }
        if (op === '--squeeze-blank' || op === '-s') { opts.squash = true; continue; }
        if (op === '--show-all' || op === '-A' || op === '-v') { opts.mostrarTodo = true; continue; }
        if (op === '--show-ends' || op === '-E') { opts.finLinea = true; continue; }
        if (op === '--show-tabs' || op === '-T') { opts.tabuladores = true; continue; }
        if (op === '--help') throw new ShellError("Try 'cat --help' for more information.", EXIT_MISUSE);
        if (op.startsWith('-') && op.length > 1) {
            for (const letra of op.slice(1)) {
                switch (letra) {
                    case 'n': opts.numerar = true; break;
                    case 'b': opts.soloNoVacias = true; break;
                    case 's': opts.squash = true; break;
                    case 'A': case 'v': opts.mostrarTodo = true; break;
                    case 'E': opts.finLinea = true; break;
                    case 'T': opts.tabuladores = true; break;
                    case 'e': opts.mostrarTodo = true; opts.finLinea = true; break;
                    case 't': opts.tabuladores = true; break;
                    default: error("invalid option -- '" + letra + "'");
                }
            }
            continue;
        }
        opts.operandos.push(op);
    }
    if (!opts.operandos.length) opts.operandos.push('-');
    return opts;
}

export default {
    name: 'cat',
    alias: [],
    synopsis: 'cat [OPTION]... [FILE]...',
    run(ctx, argv) {
        const opts = parseOptions(argv);
        let code = 0;
        let numero = 0;
        let blancoPrevio = false;

        for (const operando of opts.operandos) {
            let texto = null;
            if (operando === '-') texto = ctx.stdin ?? '';
            else {
                try {
                    texto = ctx.fs.readFile(normalizePath(ctx.cwd, operando));
                } catch (e) {
                    ctx.stderr.write('cat: ' + operando + ': ' + motivo(e) + '\n');
                    code = 1;
                    continue;
                }
            }
            for (const linea of partir(texto)) {
                if (opts.squash && linea === '') {
                    if (blancoPrevio) continue;
                    blancoPrevio = true;
                } else blancoPrevio = false;
                const vacia = linea === '';
                if (opts.numerar || opts.soloNoVacias) {
                    if (opts.soloNoVacias && vacia) { ctx.stdout.write('\n'); continue; }
                    numero++;
                    ctx.stdout.write(String(numero).padStart(6) + '\t' + transformar(linea, opts) + '\n');
                    continue;
                }
                ctx.stdout.write(transformar(linea, opts) + '\n');
            }
        }
        return code;
    }
};

/** `-A`, `-E` y `-T` hacen visibles los caracteres que no se ven. */
function transformar(linea, opts) {
    if (!opts.mostrarTodo && !opts.finLinea && !opts.tabuladores) return linea;
    let salida = '';
    for (const ch of linea) {
        if (ch === '\t' && (opts.mostrarTodo || opts.tabuladores)) { salida += '^I'; continue; }
        if (VISIBLES[ch] && (opts.mostrarTodo || opts.finLinea)) { salida += VISIBLES[ch]; continue; }
        if (opts.mostrarTodo && ch < ' ') salida += '^' + String.fromCharCode(ch.charCodeAt(0) + 64);
        else salida += ch;
    }
    return salida;
}

/**
 * wc — cuenta lineas, palabras y bytes.
 *
 * Formato de GNU verificado con coreutils 8.32:
 *   wc -l f              -> 1 f
 *   wc f f2              -> 1 1 2 f / 1 1 2 f2 / 2 2 4 total
 *   printf 'a\n' | wc    -> "      1       1       2"  (siete columnas)
 * Cuando hay ficheros, cada cuenta se alinea a derecha con el ancho del mayor
 * numero de su columna; si la entrada es una tuberia, GNU reserva 7 columnas
 * porque no sabe de antemano quantos digitos haran falta.
 *
 * Mensajes: wc: /nope: No such file or directory
 */

import { ShellError, EXIT_ERROR } from '../errors.js';
import { leerEntradas } from './io.js';

const USOS = [
    'Usage: wc [OPTION]... [FILE]...',
    '',
    'Print newline, word, and byte counts for each FILE, or standard input if',
    'no FILE is given or if FILE is -.  With more than one FILE, wc prints a',
    'line with total counts.',
    '',
    '  -c, --bytes            print the number of bytes',
    '  -m, --chars            print the number of characters',
    '  -l, --lines            print the number of newlines',
    '  -w, --words            print the number of words',
    '  -L, --max-line-length  print the maximum display line length'
].join('\n');

function usageError(message) {
    return new ShellError(message + "\nTry 'wc --help' for more information.\n" + USOS, EXIT_ERROR);
}

const CORTAS = { l: 'l', w: 'w', c: 'c', m: 'm', L: 'L' };
const LARGAS = {
    lines: 'l', newline: 'l', words: 'w', bytes: 'c', chars: 'm',
    'max-line-length': 'L', 'byte-count': 'c', 'char-count': 'm', 'word-count': 'w'
};

function parseOptions(argv) {
    const activas = [];
    const pedir = (c) => { if (!activas.includes(c)) activas.push(c); };
    const operandos = [];
    for (const op of argv.slice(1)) {
        if (op === '--') { operandos.push(...argv.slice(argv.indexOf('--') + 1)); break; }
        if (op === '--help') throw usageError(USOS);
        if (op.startsWith('--')) {
            const clave = op.slice(2);
            if (!(clave in LARGAS)) throw usageError("wc: unrecognized option '" + op + "'");
            pedir(LARGAS[clave]);
            continue;
        }
        if (op.length > 1 && op[0] === '-') {
            for (const letra of op.slice(1)) {
                if (!(letra in CORTAS)) throw usageError("wc: unrecognized option '" + op + "'");
                pedir(CORTAS[letra]);
            }
            continue;
        }
        operandos.push(op);
    }
    if (!activas.length) { pedir('l'); pedir('w'); pedir('c'); }
    return { activas, operandos };
}

/** Secuencias no vacias separadas por blanco, como cuenta GNU. */
function palabras(texto) {
    return texto.split(/\s+/).filter((t) => t.length > 0).length;
}

export default {
    name: 'wc',
    alias: [],
    synopsis: 'wc [OPTION]... [FILE]...',
    run(ctx, argv) {
        const { activas, operandos } = parseOptions(argv);
        const { textos, code } = leerEntradas(ctx, 'wc', operandos);

        const filas = textos.map((entrada) => {
            const lineas = entrada.lineas;
            const texto = lineas.join('\n') + (lineas.length ? '\n' : '');
            return {
                nombre: entrada.nombre,
                l: lineas.length,
                w: palabras(texto),
                c: [...texto].reduce((n, ch) => n + utf8(ch), 0),
                m: [...texto].length,
                L: lineas.reduce((n, l) => Math.max(n, [...l].length), 0)
            };
        });

        const conTotal = filas.length > 1;
        if (conTotal) {
            const suma = { nombre: 'total', l: 0, w: 0, c: 0, m: 0, L: 0 };
            for (const fila of filas) for (const c of ['l', 'w', 'c', 'm', 'L']) suma[c] += fila[c];
            filas.push(suma);
        }

        // Una tuberia no permite saber el ancho de antemano: GNU usa 7.
        const desdeTuberia = !operandos.length;
        const anchos = {};
        for (const c of activas) {
            anchos[c] = desdeTuberia && activas.length > 1
                ? 7
                : Math.max(...filas.map((f) => String(f[c]).length));
        }

        for (const fila of filas) {
            const cuentas = activas.map((c) => String(fila[c]).padStart(anchos[c]));
            const nombre = fila.nombre === null ? '' : ' ' + fila.nombre;
            ctx.stdout.write((cuentas.join(' ') + nombre).replace(/\s+$/, '') + '\n');
        }
        return code;
    }
};

/** Longitud en bytes UTF-8 de un caracter. */
function utf8(ch) {
    const cp = ch.codePointAt(0);
    return cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
}

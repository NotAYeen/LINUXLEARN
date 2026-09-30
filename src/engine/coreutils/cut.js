/**
 * cut — corta columnas de caracteres o de un separador.
 *
 * Mensajes verificados con GNU coreutils 8.32:
 *   cut: invalid field number
 *   cut: you must specify a list of bytes, characters, or fields
 *   cut: delimiter must be a single character
 *   cut: /nope: No such file or directory
 *
 * `-f LISTA` con `1,3`, `2-`, `-3`; `-c LISTA` con rangos de caracteres, y
 * `-b` cuenta bytes. Sin `-d`, un solo tabulador.
 */

import { ShellError, EXIT_MISUSE } from '../errors.js';
import { leerEntradas, partir, juntar } from './io.js';

function error(mensaje) {
    return new ShellError('cut: ' + mensaje, EXIT_MISUSE);
}

const RANGO = /^(\d*)-(\d*)$/;
const NUMERO = /^\d+$/;

function parseOptions(argv) {
    const opts = { campos: null, caracteres: null, bytes: null, separador: '\t', soloDelimitado: false, operandos: [], complement: false };
    for (let i = 1; i < argv.length; i++) {
        const op = argv[i];
        if (op === '--') { opts.operandos.push(...argv.slice(i + 1)); break; }
        // Valores separados: `-f 1,3`, `-d ,`.
        if (op === '-f' || op === '--fields') { opts.campos = argv[++i] ?? ''; continue; }
        if (op === '-c' || op === '--characters') { opts.caracteres = argv[++i] ?? ''; continue; }
        if (op === '-b' || op === '--bytes') { opts.bytes = argv[++i] ?? ''; continue; }
        if (op === '-d' || op === '--delimiter') { opts.separador = argv[++i] ?? ''; continue; }
        if (op === '-s' || op === '--only-delimited') { opts.soloDelimitado = true; continue; }
        if (op === '--complement') { opts.complement = true; continue; }
        // Valores pegados: `-d,`, `-f1`, `-c1-3`.
        if (/^-d./.test(op) || op === '--delimiter=') {
            opts.separador = op.startsWith('--') ? op.slice(11) : op.slice(2);
            continue;
        }
        if (/^-f.+/.test(op)) { opts.campos = op.slice(2); continue; }
        if (/^-c.+/.test(op)) { opts.caracteres = op.slice(2); continue; }
        if (/^-b.+/.test(op)) { opts.bytes = op.slice(2); continue; }
        if (op.startsWith('--fields=')) { opts.campos = op.slice(9); continue; }
        if (op.startsWith('--characters=')) { opts.caracteres = op.slice(13); continue; }
        if (op.length > 1 && op[0] === '-') throw error("invalid option -- '" + op[1] + "'");
        opts.operandos.push(op);
    }
    if (opts.campos === null && opts.caracteres === null && opts.bytes === null) {
        throw error('you must specify a list of bytes, characters, or fields');
    }
    if (opts.campos !== null) opts.campos = interpretarLista(opts.campos, true);
    if (opts.caracteres !== null) opts.caracteres = interpretarLista(opts.caracteres, true);
    if (opts.bytes !== null) opts.bytes = interpretarLista(opts.bytes, false);
    if ([...opts.separador].length !== 1) throw error('delimiter must be a single character');
    return opts;
}

/** Convierte `1,3`, `2-`, `-3` o `1-3` en una lista de pares [desde, hasta]. */
function interpretarLista(texto, unoBased) {
    const rangos = [];
    for (const trozo of texto.split(',')) {
        if (NUMERO.test(trozo)) {
            rangos.push([Number(trozo), Number(trozo)]);
            continue;
        }
        const m = RANGO.exec(trozo);
        if (!m) throw error('invalid field number');
        const desde = m[1] === '' ? (unoBased ? 1 : 0) : Number(m[1]);
        const hasta = m[2] === '' ? Infinity : Number(m[2]);
        rangos.push([desde, hasta]);
    }
    return rangos;
}

function enRangos(n, rangos, complemento) {
    const dentro = rangos.some(([a, b]) => n >= a && n <= b);
    return complemento ? !dentro : dentro;
}

export default {
    name: 'cut',
    alias: [],
    synopsis: 'cut OPTION... [FILE]...',
    run(ctx, argv) {
        const opts = parseOptions(argv);
        const { textos, code } = leerEntradas(ctx, 'cut', opts.operandos);
        const salida = [];

        for (const entrada of textos) {
            for (const linea of entrada.lineas) {
                if (opts.caracteres !== null) {
                    salida.push(recortarCaracteres([...linea], opts.caracteres, opts.complement));
                } else if (opts.bytes !== null) {
                    salida.push(recortarBytes(linea, opts.bytes, opts.complement));
                } else if (opts.soloDelimitado && !linea.includes(opts.separador)) {
                    continue;
                } else {
                    const trozos = linea.split(opts.separador);
                    const picked = trozos.filter((_, i) => enRangos(i + 1, opts.campos, opts.complement));
                    salida.push(picked.join(opts.separador));
                }
            }
        }
        ctx.stdout.write(juntar(salida));
        return code;
    }
};

function recortarCaracteres(chars, rangos, complemento) {
    return chars.filter((_, i) => enRangos(i + 1, rangos, complemento)).join('');
}

function recortarBytes(texto, rangos, complemento) {
    // En un fichero UTF-8 los indices son de bytes, no de caracteres.
    const bytes = [...Buffer.from(texto, 'utf8')];
    const picked = bytes.filter((_, i) => enRangos(i + 1, rangos, complemento));
    return Buffer.from(picked).toString('utf8');
}

/**
 * uniq — elimina lineas repetidas seguidas.
 *
 * Mensajes verificados con GNU coreutils 8.32:
 *   uniq: /nope: No such file or directory
 *   uniq: invalid number of fields to skip
 *   uniq: only one of -c and -i may be given
 *
 * Solo mira lineas consecutivas: por eso las misiones encadenan `sort | uniq`.
 * `-c` antepone la cuenta con siete columnas de ancho, como GNU.
 */

import { ShellError, EXIT_MISUSE } from '../errors.js';
import { leerEntradas, partir, juntar } from './io.js';

function error(mensaje) {
    return new ShellError('uniq: ' + mensaje, EXIT_MISUSE);
}

function parseOptions(argv) {
    const opts = { contar: false, duplicados: false, unicos: false, ignorarCase: false, campos: 0, chars: 0, separador: null, soloDelimitado: false, operandos: [] };
    let archivo = null;
    for (const op of argv.slice(1)) {
        if (op === '--') { opts.operandos.push(...argv.slice(argv.indexOf('--') + 1)); break; }
        if (op === '-c' || op === '--count') { opts.contar = true; continue; }
        if (op === '-d' || op === '--repeated' || op === '--only-duplicated') { opts.duplicados = true; continue; }
        if (op === '-u' || op === '--unique') { opts.unicos = true; continue; }
        if (op === '-i' || op === '--ignore-case') { opts.ignorarCase = true; continue; }
        if (op === '-f' || op === '--fields') { opts.campos = entero(op.slice(2)); continue; }
        if (op === '-s' || op === '--skip-fields') { opts.saltarCampos = entero(op.slice(2)); continue; }
        if (op === '-w' || op === '--check-chars') { opts.chars = entero(op.slice(2)); continue; }
        if (op === '-z' || op === '--zero-terminated') { error('zero-terminated input is not supported'); }
        if (op === '-s' || op === '--only-delimited') { opts.soloDelimitado = true; continue; }
        if (op === '--help') throw error("Try 'uniq --help' for more information.");
        if (op.startsWith('-')) error("invalid option -- '" + op[1] + "'");
        if (archivo === null && !op.startsWith('-')) { archivo = op; continue; }
        opts.operandos.push(op);
    }
    if (opts.contar && (opts.duplicados || opts.unicos)) {
        error('only one of -c and -d may be given together');
    }
    if (opts.duplicados && opts.unicos) {
        error("only one of -u and -d may be given");
    }
    if (archivo) opts.operandos.unshift(archivo);
    return opts;
}

function entero(texto) {
    if (!/^\d+$/.test(texto)) error('invalid number of fields to skip');
    return Number(texto);
}

/** Linea sin los primeros `campos` campos, como hacen -f y -s. */
function recortar(linea, opts) {
    let texto = linea;
    if (opts.saltarCampos) {
        const trozos = texto.split(/\s+/);
        texto = trozos.slice(opts.saltarCampos).join(' ');
    }
    if (opts.campos) {
        const trozos = texto.split(/\s+/);
        texto = trozos.slice(opts.campos).join(' ');
    }
    if (opts.chars) texto = texto.slice(0, opts.chars);
    return texto;
}

export default {
    name: 'uniq',
    alias: [],
    synopsis: 'uniq [OPTION]... [INPUT [OUTPUT]]',
    run(ctx, argv) {
        const opts = parseOptions(argv);
        const entrada = opts.operandos[0];
        const salida = opts.operandos[1];
        const { textos, code } = leerEntradas(ctx, 'uniq', entrada === undefined ? [] : [entrada]);

        const lineas = textos.flatMap((t) => t.lineas);
        const grupos = [];
        for (const linea of lineas) {
            const clave = recortar(linea, opts);
            const comparada = opts.ignorarCase ? clave.toLowerCase() : clave;
            const ultimo = grupos[grupos.length - 1];
            if (ultimo && ultimo.clave === comparada) { ultimo.cuenta++; continue; }
            grupos.push({ clave: comparada, linea, cuenta: 1 });
        }

        const elegidos = grupos.filter((g) => {
            if (opts.duplicados) return g.cuenta > 1;
            if (opts.unicos) return g.cuenta === 1;
            return true;
        });

        const texto = juntar(elegidos.map((g) => (opts.contar ? String(g.cuenta).padStart(7) + ' ' + g.linea : g.linea)));
        if (salida) ctx.fs.writeFile(salida, texto);
        else ctx.stdout.write(texto);
        return code;
    }
};

/**
 * sort — ordena lineas.
 *
 * Mensajes verificados con GNU coreutils 8.32:
 *   sort: cannot read: No such file or directory
 *   sort: invalid field number: 'x'
 *   sort: unknown option after -k: 'z'
 *   sort: multiple field separators
 *
 * GNU ordena por bytes, con la salvedad de que compara la linea entera cuando
 * las claves empatan ("last-resort comparison"), y por eso `-k1,1` puede dar un
 * resultado distinto de `-k1` si la clave es un prefijo comun.
 *
 * La comparacion numerica (`-n`) ignora los espacios iniciales, las claves con
 * `b` ignoran los blancos de la clave y `V` ordena como numeros de version.
 */

import { ShellError, EXIT_MISUSE } from '../errors.js';
import { leerEntradas, partir, juntar } from './io.js';

function error(mensaje) {
    return new ShellError('sort: ' + mensaje, EXIT_MISUSE);
}

const NUMERICO = /^[-+]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][-+]?[0-9]+)?$/;

function parseOptions(argv) {
    const opts = {
        numerico: false, human: false, inicial: false,Version: false, reverse: false,
        unico: false, sinMezclar: false, comprobar: false, estable: true,
        separador: null, claves: [], ignorarCase: false, iguales: false
    };
    const operandos = [];

    for (let i = 1; i < argv.length; i++) {
        const op = argv[i];
        if (op === '--') { operandos.push(...argv.slice(i + 1)); break; }
        if (op === '-n' || op === '--numeric-sort') { opts.numerico = true; continue; }
        if (op === '-h' || op === '--human-numeric-sort') { opts.human = true; continue; }
        if (op === '-V' || op === '--version-sort') { opts.Version = true; continue; }
        if (op === '-r' || op === '--reverse') { opts.reverse = true; continue; }
        if (op === '-u' || op === '--unique') { opts.unico = true; continue; }
        if (op === '-f' || op === '--ignore-case') { opts.ignorarCase = true; continue; }
        if (op === '-b' || op === '--ignore-leading-blanks') { opts.inicial = true; continue; }
        if (op === '-s' || op === '--stable') { opts.stably = true; continue; }
        if (op === '-R' || op === '--random-sort') { error('random sort is not deterministic'); }
        if (op === '-M' || op === '--month-sort') { opts.meses = true; continue; }
        if (op === '--help') throw error("Try 'sort --help' for more information.");
        if (op.startsWith('--key=') || op.startsWith('-k')) {
            opts.claves.push(...interpretarClave(op));
            if (op === '-k' || op === '--key') i++;
            continue;
        }
        // `-t,` pega el separador; `-t ,` lo lleva separado.
        if (op === '-t' || op === '--separator') { opts.separador = argv[++i]; continue; }
        if (/^-t./.test(op)) { opts.separador = op.slice(2); continue; }
        if (op.startsWith('--separator=')) { opts.separador = op.slice(11); continue; }
        if (op.startsWith('--')) error("unrecognized option '" + op + "'");
        if (op.length > 1 && op[0] === '-') {
            for (const letra of op.slice(1)) {
                if ('nhrVfusbMgi'.includes(letra)) {
                    if (letra === 'n') opts.numerico = true;
                    else if (letra === 'h') opts.human = true;
                    else if (letra === 'V') opts.Version = true;
                    else if (letra === 'r') opts.reverse = true;
                    else if (letra === 'u') opts.unico = true;
                    else if (letra === 'f') opts.ignorarCase = true;
                    else if (letra === 'b') opts.inicial = true;
                    else if (letra === 'M') opts.meses = true;
                } else error("invalid option -- '" + letra + "'");
            }
            continue;
        }
        operandos.push(op);
    }
    if (!opts.claves.length) {
        // Sin `-k`, GNU ordena por la linea entera. Con `-n`, `-V` o `-M` la
        // clave por defecto hereda ese modo: `sort -n` ordena numericamente.
        opts.claves.push({
            desde: 1,
            hasta: Infinity,
            numerico: opts.numerico,
            human: opts.human,
            version: opts.Version,
            meses: opts.meses,
            inicial: opts.inicial,
            ignorarCase: opts.ignorarCase
        });
    }
    return { opts, operandos };
}

/** `-k2`, `-k2,3nr`, `-k 2`... devuelve la clave ya interpretada. */
function interpretarClave(op) {
    const bruto = op.startsWith('-k') && op !== '--key' ? op.slice(2) : (op.startsWith('--key=') ? op.slice(6) : '');
    if (bruto === '') return [{ desde: 2, hasta: Infinity }];
    const m = /^(\d+)?(\.(\d+))?([,])?(\d+)?([a-zA-Z]*)$/.exec(bruto);
    if (!m) {
        if (/^\d/.test(bruto)) error("invalid field number: '" + bruto + "'");
        error("invalid field number: '" + bruto + "'");
    }
    const desde = m[1] ? Number(m[1]) : 1;
    const hasta = m[5] ? Number(m[5]) : Infinity;
    const mod = m[6] ?? '';
    return [{
        desde, hasta,
        numerico: mod.includes('n') || mod.includes('g'),
        inicial: mod.includes('b'),
        reverse: mod.includes('r'),
        ignorarCase: mod.includes('f')
    }];
}

/** Trocea la linea por el separador, conservando el numero de campo (1..n). */
function campos(linea, separador) {
    if (separador === null) {
        // Por defecto son los blancos: con -b, el campo empieza en el primer
        // blanco y termina en el siguiente.
        const m = /^(\s*)(\S*)(\s*)(.*)$/.exec(linea);
        return [m[2], m[4].trimStart()];
    }
    const trozos = linea.split(separador);
    if (trozos.length && trozos[trozos.length - 1] === '') trozos.pop();
    return trozos;
}

/** Valor de una clave, ya recortado al rango pedido. */
function valorClave(linea, clave, opts) {
    const bruto = opts.separador === null
        ? (clave.desde === 1 ? linea.replace(/^\s+/, '') : linea).trimEnd()
        : linea;
    const trozos = campos(bruto, opts.separador);
    const desde = (clave.desde ?? 1) - 1;
    const hasta = clave.hasta === Infinity ? trozos.length : (clave.hasta - 1);
    const eleccion = trozos.slice(desde, hasta + 1);
    // En modo numerico, GNU compara solo el primer campo de la clave: sin esto,
    // `sort -k3 -n` de un CSV compararia "salario,alta" y no "salario".
    if (clave.numerico && eleccion.length > 1) return eleccion[0];
    let valor = eleccion.join(opts.separador === null ? ' ' : opts.separador);
    if (clave.inicial) valor = valor.replace(/^\s+/, '');
    return valor;
}

/**
 * Valor numerico de una clave, o `null` si no es un numero entero o decimal.
 * La distincion importa: GNU `sort -n` pone las claves no numericas detras de
 * las numericas, en vez de convertirlas a 0.
 */
function numeroDe(texto) {
    const t = String(texto).trim();
    return /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t) ? Number(t) : null;
}

/** Ordena como `sort -V`: v1.9 va antes que v1.10. */
function compararVersion(a, b) {
    const trozos = (t) => t.match(/[0-9]+|\D+/g) ?? [t];
    const ta = trozos(a);
    const tb = trozos(b);
    for (let i = 0; i < Math.max(ta.length, tb.length); i++) {
        const x = ta[i] ?? '';
        const y = tb[i] ?? '';
        if (x === y) continue;
        const nx = /^[0-9]+$/.test(x);
        const ny = /^[0-9]+$/.test(y);
        if (nx && ny) return Number(x) - Number(y);
        return x < y ? -1 : 1;
    }
    return 0;
}

const MESES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** Comparador por defecto: como `strcmp`, con la reserva final de GNU. */
function compararTexto(a, b, ignorarCase) {
    const x = ignorarCase ? a.toLowerCase() : a;
    const y = ignorarCase ? b.toLowerCase() : b;
    return x < y ? -1 : x > y ? 1 : 0;
}

function construirComparador(opts) {
    const claves = opts.claves.length ? opts.claves : [{ desde: 1, hasta: Infinity }];
    // `sort -k3 -n` aplica el numerico a TODAS las claves, no solo a la primera.
    const aplicar = (clave) => ({
        ...clave,
        // `||` y no `??`: una clave sin `n` vale `false`, y con `??` el
        // `-n` global no llegaria a `sort -k3 -n`.
        numerico: clave.numerico || opts.numerico,
        inicial: clave.inicial || opts.inicial,
        ignorarCase: clave.ignorarCase || opts.ignorarCase
    });
    return (a, b) => {
        for (const cruda of claves) {
            const clave = aplicar(cruda);
            const va = valorClave(a.linea, clave, { ...opts, ...clave });
            const vb = valorClave(b.linea, clave, { ...opts, ...clave });
            let r = 0;
            if (clave.numerico) {
                // Regla de GNU: si los dos keys son numeros se comparan
                // numericamente; si uno no lo es, ese va ANTES (por eso la
                // cabecera de un CSV queda la primera en `sort -k3 -n`).
                const na = numeroDe(va);
                const nb = numeroDe(vb);
                if (na === null && nb === null) r = compararTexto(va, vb, clave.ignorarCase);
                else if (na === null) r = -1;
                else if (nb === null) r = 1;
                else r = na - nb;
            } else if (clave.version || opts.Version) {
                r = compararVersion(va, vb);
            } else if (opts.meses) {
                r = MESES.indexOf(va.slice(0, 3).toLowerCase()) - MESES.indexOf(vb.slice(0, 3).toLowerCase());
            } else {
                r = compararTexto(va, vb, clave.ignorarCase || opts.ignorarCase);
            }
            if (r !== 0) return clave.reverse ? -r : r;
        }
        // Last-resort comparison de GNU: si las claves empatan, la linea entera.
        const final = compararTexto(a.linea, b.linea, opts.ignorarCase);
        return final;
    };
}

export default {
    name: 'sort',
    alias: [],
    synopsis: 'sort [OPTION]... [FILE]...',
    run(ctx, argv) {
        const { opts, operandos } = parseOptions(argv);
        const { textos, code } = leerEntradas(ctx, 'sort', operandos);

        const lineas = [];
        for (const entrada of textos) {
            for (const linea of entrada.lineas) lineas.push({ linea, fichero: entrada.nombre });
        }

        const compara = construirComparador(opts);
        lineas.sort((a, b) => {
            const r = compara(a, b);
            return opts.reverse ? -r : r;
        });

        let salida = [];
        let anterior = null;
        for (const item of lineas) {
            if (opts.unico && anterior !== null && item.linea === anterior) continue;
            anterior = item.linea;
            salida.push(opts.sinMezclar && item.fichero ? item.fichero + '\t' + item.linea : item.linea);
        }
        ctx.stdout.write(juntar(salida));
        return code;
    }
};

/**
 * tr — traduce, borra o comprime caracteres.
 *
 * Mensajes verificados con GNU coreutils 8.32:
 *   tr: when not truncating set1, string2 must be non-empty
 *   tr: when truncating set1, the string2 must be contained in set1
 *   tr: unterminated quoted string
 *
 * Usa la sintaxis POSIX: `a-z`, `[:lower:]`, `\\n`, `\\t`, `\\r` y las
 * secuencias `NNN` en octal. `tr` no hace expansion de ficheros: su
 * sintaxis no empieza por `-`, asi que se toma de stdin salvo `-a`/`--delete`
 * con fichero, como haria el shell.
 */

import { ShellError, EXIT_MISUSE } from '../errors.js';

const NOMBRES = {
    alpha: 'A-Za-z', digit: '0-9', alnum: '0-9A-Za-z', upper: 'A-Z', lower: 'a-z',
    space: ' \\t\\n\\r\\f\\v', blank: ' \\t', punct: '!-/:-@\\[-`{-~', print: ' -~', graph: '!-~', cntrl: '\\0-\\x1f\\x7f', xdigit: '0-9A-F'
};

/** Lee los operandos de tr tal cual, sin expansion (los ve el shell, no el parser). */
function parseOptions(argv) {
    const opts = { borrar: false, complemento: false, duplicados: false,operandos: [] };
    for (const op of argv.slice(1)) {
        if (op === '-d' || op === '--delete') { opts.borrar = true; continue; }
        if (op === '-c' || op === '--complement') { opts.complemento = true; continue; }
        if (op === '-s' || op === '--squeeze-repeats') { opts.duplicados = true; continue; }
        if (op === '-t' || op === '--truncate-set1') { opts.truncar = true; continue; }
        if (op === '--help') throw new ShellError("Usage: tr [OPTION]... SET1 [SET2]", EXIT_MISUSE);
        if (op === '--') continue;
        if (op.length > 1 && op[0] === '-') throw new ShellError("tr: unrecognized option '" + op + "'", EXIT_MISUSE);
        opts.operandos.push(op);
    }
    return opts;
}

/** Convierte un conjunto POSIX en una lista de caracteres, en orden de rango. */
function expandirConjunto(texto, complemento) {
    let chars = [];
    let i = 0;
    const s = String(texto);
    while (i < s.length) {
        const c = s[i];
        if (c === '\\') {
            const resto = s.slice(i);
            const octal = /^\\[0-7]{1,3}/.exec(resto);
            if (octal) { chars.push(String.fromCharCode(parseInt(octal[0].slice(1), 8))); i += octal[0].length; continue; }
            const esc = /^\\x[0-9A-Fa-f]{1,2}/.exec(resto) || /^\\[abfnrtv\\]/.exec(resto);
            if (esc) { chars.push(escapar(esc[0])); i += esc[0].length; continue; }
            chars.push('\\'); i += 1; continue;
        }
        if (c === '[' && /^(\[:\w+:])/.test(s.slice(i))) {
            const clase = /^(\[:\w+:])/.exec(s.slice(i))[1];
            const rango = NOMBRES[clase.slice(2, -2)];
            if (!rango) throw new ShellError("tr: character class syntax error", EXIT_MISUSE);
            chars = chars.concat(...expandirConjunto(rango, false));
            i += clase.length;
            continue;
        }
        if (c === '[' && s[i + 1] === ':') {
            const fin = s.indexOf(':]', i);
            if (fin < 0) throw new ShellError("tr: missing ':]' after character class", EXIT_MISUSE);
            throw new ShellError("tr: character class syntax error", EXIT_MISUSE);
        }
        if (s[i + 1] === '-' && i + 2 < s.length) {
            const hasta = s[i + 2];
            if (hasta === ']') { chars.push(c); i += 1; continue; }
            for (let k = c.charCodeAt(0); k <= hasta.charCodeAt(0); k++) chars.push(String.fromCharCode(k));
            i += 3;
            continue;
        }
        chars.push(c);
        i += 1;
    }
    if (complemento) {
        const usados = new Set(chars);
        const todos = [];
        for (let k = 0; k < 256; k++) {
            const ch = String.fromCharCode(k);
            if (!usados.has(ch)) todos.push(ch);
        }
        return todos;
    }
    return chars;
}

const ESCAPES = { '\\': '\\', a: '\x07', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v' };

function escapar(texto) {
    if (texto.length === 2) return ESCAPES[texto[1]];
    if (/^\\x[0-9A-Fa-f]{1,2}$/.test(texto)) return String.fromCharCode(parseInt(texto.slice(2), 16));
    return texto;
}

export default {
    name: 'tr',
    alias: [],
    synopsis: 'tr [OPTION]... SET1 [SET2]',
    run(ctx, argv) {
        const opts = parseOptions(argv);
        const [c1, c2] = opts.operandos;

        if (c1 === undefined) {
            ctx.stderr.write('tr: missing operand\n');
            return 1;
        }
        const set1 = expandirConjunto(c1, opts.complemento);
        const set2 = c2 === undefined ? [] : expandirConjunto(c2, false);

        if (opts.borrar) {
            const fuera = new Set(set1);
            ctx.stdout.write([...(ctx.stdin ?? '')].filter((ch) => !fuera.has(ch)).join(''));
            return 0;
        }
        if (c2 === undefined) {
            if (opts.duplicados) {
                ctx.stdout.write(comprimir(ctx.stdin ?? '', set1));
                return 0;
            }
            ctx.stderr.write('tr: when not truncating set1, string2 must be non-empty\n');
            return 1;
        }

        if (opts.truncar && set2.some((ch) => !set1.includes(ch))) {
            ctx.stderr.write("tr: when truncating set1, the string2 must be contained in set1\n");
            return 1;
        }
        const origen = opts.truncar ? set2 : set1;
        const destino = opts.truncar ? set2 : set2;
        const tabla = new Map();
        origen.forEach((ch, i) => { if (!tabla.has(ch)) tabla.set(ch, destino[i % destino.length]); });
        let salida = [...(ctx.stdin ?? '')].map((ch) => (tabla.has(ch) ? tabla.get(ch) : ch)).join('');
        if (opts.duplicados) salida = comprimir(salida, destino);
        ctx.stdout.write(salida);
        return 0;
    }
};

/** Deja una sola aparicion de cada racha de caracteres de `set1`. */
function comprimir(texto, set1) {
    const dentro = new Set(set1);
    let salida = '';
    let anterior = null;
    for (const ch of texto) {
        if (anterior === ch && dentro.has(ch)) continue;
        salida += ch;
        anterior = ch;
    }
    return salida;
}

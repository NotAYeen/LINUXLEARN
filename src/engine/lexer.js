/**
 * Lexico de la linea de ordenes.
 *
 * Divide una linea en palabras y operadores respetando comillas, escapes y
 * sustituciones. Una palabra no es una cadena sino una lista de tramos
 * (`lit`, `param`, `sub`, `arith`, `tilde`), porque cada tramo se expande con
 * reglas distintas: dentro de comillas dobles no se parte en palabras, pero las
 * variables si se expanden.
 *
 * `foo ()` se tokeniza como palabra `foo` mas parentesis: el parser es quien
 * reconoce la definicion de funcion. Asi un subshell `( cd /tmp )` nunca se
 * confunde con el nombre de un comando.
 */

/** Caracteres que rompen una palabra sin comillas. */
const BREAKS = ' \t\n|;&<>()';

/**
 * Operador que empieza en `i`, o null. El prefijo de descriptor de fichero
 * (`2>`, `2>>`, `1>&2`) forma parte del operador, nunca de la palabra.
 */
export function isOperatorAt(s, i) {
    const rest = s.slice(i, i + 4);
    const c = s[i];
    if (c === '{' || c === '}') {
        // `{}` es el marcador de `find -exec` y va como palabra. `{a,b}` y
        // `{1..3}` son patrones de expansio de llaves, no llaves de bloque.
        if (rest.startsWith('{}')) return null;
        const next = s[i + 1];
        return next === undefined || next === ' ' || next === '\t' || ';&|'.includes(next) ? c : null;
    }
    let m;
    if ((m = /^(\d*)&>>/.exec(rest))) return m[0];
    if ((m = /^(\d*)>&/.exec(rest))) return m[0];
    if ((m = /^(\d*)<&/.exec(rest))) return m[0];
    if ((m = /^<<-/.exec(rest))) return m[0];
    if ((m = /^<</.exec(rest))) return m[0];
    if ((m = /^(\d*)>>/.exec(rest))) return m[0];
    if ((m = /^(\d*)>/.exec(rest))) return m[0];
    if ((m = /^(\d*)</.exec(rest))) return m[0];
    if ((m = /^&&/.exec(rest))) return m[0];
    if ((m = /^\|\|/.exec(rest))) return m[0];
    if ((m = /^;;/.exec(rest))) return m[0];
    if ((m = /^([|;&(){}])/.exec(rest))) return m[0];
    return null;
}

const NAME_START = /[A-Za-z_]/;
const NAME_CHAR = /[A-Za-z0-9_]/;

/**
 * Trozo de palabra sin comillas ni operadores. La barra invertida tambien
 * corta: la resuelve `readWord`, que además marca el carácter como protegido
 * para que `a\ b` siga siendo una sola palabra y `\*` no sea un comodín.
 */
const BARE_STOP = ' \t\n|;&<>()$`\'"\\';

function readBareWord(s, start) {
    let i = start;
    while (i < s.length) {
        if (BARE_STOP.includes(s[i])) break;
        i++;
    }
    return s.slice(start, i);
}

/**
 * Lee una palabra completa a partir de `start`.
 * `raw` es un espejo exacto del fuente consumido: por eso el tokenizador puede
 * avanzar con `i += word.raw.length` sin volver a escanear.
 */
export function readWord(s, start) {
    const parts = [];
    let lit = '';
    let i = start;
    let consumed = 0;

    const flush = () => {
        if (lit !== '') { parts.push({ k: 'lit', v: lit, q: false }); lit = ''; }
    };
    const push = (p) => { flush(); parts.push(p); };
    const take = (n) => { i += n; consumed += n; };

    while (i < s.length) {
        const c = s[i];
        if (BREAKS.includes(c)) {
            if (c === '\\' || c === '\'' || c === '"' || c === '$' || c === '`') {
                // escaped or quoted character, keep going
            } else {
                break;
            }
        }
        // Cada trozo protegido va en su propia parte. Si se juntara con el
        // texto suelto de al lado, `pre"a b"post` y `prea bpost` serían
        // indistinguibles y la máscara mentiría.
        if (c === '\\') {
            if (i + 1 < s.length) { push({ k: 'lit', v: s[i + 1], q: true }); take(2); continue; }
            lit += '\\'; take(1); continue;
        }
        if (c === "'") {
            const end = s.indexOf("'", i + 1);
            if (end === -1) throw new ShellSyntax('unexpected EOF while looking for matching \'\'');
            push({ k: 'lit', v: s.slice(i + 1, end), q: true });
            take(end + 1 - i);
            continue;
        }
        if (c === '"') {
            const dq = readDoubleQuoted(s, i + 1);
            for (const p of dq.parts) push({ ...p, q: true });
            take(dq.end + 1 - i);
            continue;
        }
        if (c === '`') {
            const end = s.indexOf('`', i + 1);
            if (end === -1) throw new ShellSyntax('unexpected EOF while looking for matching `');
            push({ k: 'sub', src: s.slice(i + 1, end) });
            take(end + 1 - i);
            continue;
        }
        if (c === '$') {
            const sub = readDollar(s, i);
            if (sub) {
                take(sub.end - i);
                if (sub.part.k === 'brace') push({ k: 'lit', v: sub.part.v, q: true });
                else if (sub.part.k === 'param' && !sub.part.name) lit += '$';
                else push(sub.part);
                continue;
            }
            lit += c; take(1); continue;
        }
        if (c === '~' && lit === '' && parts.length === 0) {
            let j = i + 1;
            let user = null;
            if (s[j] === '/') user = null;
            else if (NAME_START.test(s[j] || '')) {
                let name = '';
                while (j < s.length && NAME_CHAR.test(s[j])) { name += s[j]; j++; }
                user = name;
            } else if (s[j] === undefined || BREAKS.includes(s[j]) || s[j] === '"' || s[j] === "'" || s[j] === '`') {
                // `echo ~` termina la palabra: la tilde sola vale el HOME.
                user = null;
            } else { lit += c; take(1); continue; }
            push({ k: 'tilde', user });
            take(j - i);
            continue;
        }
        const bare = readBareWord(s, i);
        lit += bare;
        take(bare.length);
    }

    flush();
    if (parts.length === 0) return null;
    return { type: 'word', parts, raw: s.slice(start, start + consumed) };
}

function readDoubleQuoted(s, start) {
    const parts = [];
    let lit = '';
    const flush = () => { if (lit) { parts.push({ k: 'lit', v: lit, q: true }); lit = ''; } };
    let i = start;
    while (i < s.length) {
        const c = s[i];
        if (c === '"') { flush(); return { parts, end: i }; }
        if (c === '\\' && '"\\$`'.includes(s[i + 1])) { lit += s[i + 1]; i += 2; continue; }
        if (c === '$') {
            const sub = readDollar(s, i);
            if (sub) { flush(); parts.push(marcado(sub.part)); i = sub.end; continue; }
            lit += c; i++; continue;
        }
        if (c === '`') {
            const end = s.indexOf('`', i + 1);
            if (end === -1) throw new ShellSyntax('unexpected EOF while looking for matching `');
            flush();
            parts.push({ k: 'sub', src: s.slice(i + 1, end), q: true });
            i = end + 1;
            continue;
        }
        lit += c;
        i++;
    }
    throw new ShellSyntax('unexpected EOF while looking for matching "');
}

/** Marca un tramo como protegido: dentro de comillas no se parte ni se expande. */
function marcado(part) {
    if (part.q) return part;
    return { ...part, q: true };
}

/** Indice del cierre que corresponde al apertura en `start`. */
export function matchPair(s, start, open, close) {
    let depth = 0;
    for (let i = start; i < s.length; i++) {
        if (s[i] === '\\') { i++; continue; }
        if (s[i] === open) depth++;
        else if (s[i] === close) { depth--; if (depth === 0) return i; }
    }
    return -1;
}

/** Lee `$...`: variable, parametro, sustitucion de orden o aritmetica. */
function readDollar(s, i) {
    const next = s[i + 1];
    if (next == null) return null;
    if (next === '(') {
        if (s[i + 2] === '(') {
            const end = s.indexOf('))', i + 3);
            if (end !== -1) {
                return { part: { k: 'arith', src: s.slice(i + 3, end) }, end: end + 2 };
            }
        }
        const end = matchPair(s, i + 1, '(', ')');
        if (end === -1) throw new ShellSyntax('unexpected EOF while looking for matching )');
        return { part: { k: 'sub', src: s.slice(i + 2, end) }, end: end + 1 };
    }
    if (next === '{') {
        let depth = 0;
        let j = i + 1;
        for (; j < s.length; j++) {
            if (s[j] === '\\') { j++; continue; }
            if (s[j] === '{') depth++;
            else if (s[j] === '}') { depth--; if (depth === 0) break; }
        }
        if (j >= s.length) throw new ShellSyntax('unexpected EOF while looking for matching }');
        return { part: parseBrace(s.slice(i + 2, j)), end: j + 1 };
    }
    if (NAME_START.test(next)) {
        let j = i + 1;
        while (j < s.length && NAME_CHAR.test(s[j])) j++;
        return { part: { k: 'param', name: s.slice(i + 1, j) }, end: j };
    }
    if (/[0-9]/.test(next)) return { part: { k: 'param', name: next }, end: i + 2 };
    if ('?$!#@*-'.includes(next)) return { part: { k: 'param', name: next }, end: i + 2 };
    return null;
}

/** Convierte el interior de `${...}` en un tramo de parametro. */
function parseBrace(body) {
    let m = /^([A-Za-z_][A-Za-z0-9_]*):(\d+)(?::(\d+))?$/.exec(body);
    if (m) return { k: 'param', name: m[1], op: 'slice', offset: m[2], length: m[3] ?? null };
    m = /^([A-Za-z_][A-Za-z0-9_]*)\/([#%])(.*)$/s.exec(body);
    if (m && tieneSustitucion(m[3])) return { k: 'param', name: m[1], op: '/' + m[2], arg: m[3] };
    m = /^([A-Za-z_][A-Za-z0-9_]*|[-?$!#@*])([-+]?\d+)?(\^\^|\^|,,|:=|:\?|:\+|:-|\+|-|##|#|%%|%|=|==|!=|\?|\?\?|\?\/|\/\/?|\/\/)(.*)$/s.exec(body);
    if (m) {
        return { k: 'param', name: m[1], offset: m[2] || null, op: m[3], arg: m[4] };
    }
    m = /^([A-Za-z_][A-Za-z0-9_]*)\/(.*)$/s.exec(body);
    if (m) return { k: 'param', name: m[1], op: '/', arg: m[2] };
    if ((m = /^#([A-Za-z_][A-Za-z0-9_]*)$/.exec(body))) return { k: 'param', name: m[1], op: '#len' };
    if (/^#/.test(body)) return { k: 'param', name: '#', op: 'bad' };
    if (/^([A-Za-z_][A-Za-z0-9_]*)$/.test(body)) return { k: 'param', name: body };
    return { k: 'brace', v: body };
}

/**
 * Los reemplazos anclados se escriben `${v/%p/r}` y `${v/#p/r}`, con la barra
 * ANTES del ancla. `${v%p/r}` es una eliminación con el patron `p/r`, que es
 * justo lo que pasa si se olvida la barra. La segunda barra tiene que separar
 * patron y reemplazo, así que no vale una que sea el primer caracter.
 */
function tieneSustitucion(s) {
    if (s[0] === '/') return false;
    for (let i = 0; i < s.length; i++) {
        if (s[i] === '\\') { i++; continue; }
        if (s[i] === '/') return true;
    }
    return false;
}

export class ShellSyntax extends Error {
    constructor(message) {
        super(message);
        this.name = 'ShellSyntax';
    }
}

/** Tokeniza una linea: `[{type:'op',v} | {type:'word',parts,raw}]`. */
export function tokenize(line) {
    const tokens = [];
    let i = 0;
    while (i < line.length) {
        if (/\s/.test(line[i])) { i++; continue; }
        // `#` solo abre comentario al empezar una palabra; dentro de ella es
        // un caracter normal (`grep '#'`).
        if (line[i] === '#') break;
        const op = isOperatorAt(line, i);
        if (op) { tokens.push({ type: 'op', v: op }); i += op.length; continue; }
        const word = readWord(line, i);
        if (!word) { i++; continue; }
        tokens.push(word);
        i += word.raw.length;
    }
    return tokens;
}

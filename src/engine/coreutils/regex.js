/**
 * regex.js — traduce expresiones regulares POSIX (BRE y ERE) a JavaScript.
 *
 * `grep`, `sed` y `awk` compilan sus patrones aqui. El traductor recorre el
 * patron con un descenso recursivo y emite la fuente equivalente para
 * `new RegExp`, respetando las diferencias entre ambos dialectos:
 *
 *   BRE: `(`, `)`, `+`, `?`, `{` y `}` son literales; los operadores van
 *        escapados (`\(`, `\+`, `\{`). `^` solo ancla al principio de la rama
 *        y `$` solo al final, asi que `a^b` busca un caret literal.
 *   ERE: operadores sin escapar, `^` y `$` anclan en cualquier posicion.
 *
 * Los mensajes de error son los de GNU grep 3.0 (gnulib), verificados contra
 * `C:\Program Files\Git\bin\bash.exe`:
 *
 *   grep '['         -> grep: Invalid regular expression
 *   grep -G 'a\'     -> grep: Trailing backslash
 *   grep -E '('      -> grep: Unmatched ( or \(
 *   grep -G 'a\)'    -> grep: Unmatched ) or \)
 *   grep -E 'a{2,1}' -> grep: Invalid content of \{\}
 *   grep '[z-a]'     -> grep: Invalid range end
 *   grep '\1'        -> grep: Invalid back reference
 *
 * Desvios conscientes:
 *  - Sin locales: `[[:alpha:]]` es `A-Za-z`, no la clasificacion del sistema.
 *  - Los patrones combinados con `-e` se unen como alternacion y JavaScript
 *    resuelve los empates tomando la PRIMERA alternativa; POSIX eligiria la mas
 *    larga. Solo se nota con `-o` y patrones que comparten prefijo.
 *  - `\<` y `\>` se implementan con miradas hacia atras/adelante, que no admiten
 *    cuantificador: `\<*` no tiene sentido y se ignora.
 */

/** Error de compilacion. El llamante decide como presentarlo (grep: ..., sed: ...). */
export class RegexError extends Error {
    constructor(message) {
        super(message);
        this.name = 'RegexError';
    }
}

/** Clases POSIX -> fragmento de clase de JavaScript. */
const CLASES = {
    alpha: 'A-Za-z',
    digit: '0-9',
    alnum: 'A-Za-z0-9',
    upper: 'A-Z',
    lower: 'a-z',
    space: '\\x09-\\x0d\\x20',
    blank: '\\x09\\x20',
    punct: '\\x21-\\x2f\\x3a-\\x40\\x5b-\\x60\\x7b-\\x7e',
    print: '\\x20-\\x7e',
    graph: '\\x21-\\x7e',
    cntrl: '\\x00-\\x1f\\x7f',
    xdigit: '0-9A-Fa-f',
    word: '\\w'
};

/** Escapa un caracter para que signifique a si mismo fuera de una clase. */
function escaparSuelto(c) {
    if (/[.*+?^${}()|[\]\\]/.test(c)) return '\\' + c;
    const code = c.codePointAt(0);
    if (code < 0x20 || code === 0x7f) return '\\x' + code.toString(16).padStart(2, '0');
    return c;
}

/** Escapa un caracter para que signifique a si mismo dentro de una clase. */
function escaparEnClase(c) {
    if (c === ']' || c === '\\' || c === '^' || c === '-') return '\\' + c;
    const code = c.codePointAt(0);
    if (code < 0x20 || code === 0x7f) return '\\x' + code.toString(16).padStart(2, '0');
    return c;
}

/** Cadena fija -> fuente de expresion regular que la busca en cualquier sitio. */
export function escaparLiteral(texto) {
    let out = '';
    for (const c of String(texto)) out += escaparSuelto(c);
    return out;
}

/**
 * Compila un patron.
 *
 * @param {string} patron
 * @param {object} opciones `{ ere, literal, icase }`
 * @returns {RegExp} sin bandera `g`: el llamante la anyade si necesita
 *                   recorrer varias coincidencias.
 */
export function compilarPatron(patron, opciones = {}) {
    const texto = String(patron == null ? '' : patron);
    const fuente = opciones.literal
        ? escaparLiteral(texto)
        : convertir(texto, opciones.ere === true);
    try {
        return new RegExp(fuente, opciones.icase ? 'i' : '');
    } catch (e) {
        throw new RegexError('Invalid regular expression');
    }
}

/**
 * Compila varios patrones en UNA sola expresion alternada. Hace falta para
 * `-e a -e b` y `-f fichero`: GNU los une y recorre el linea de izquierda a
 * derecha, de modo que `-o` imprime las coincidencias en orden de posicion y
 * no agrupadas por patron.
 */
export function compilarPatrones(patrones, opciones = {}) {
    if (patrones.length === 1) return compilarPatron(patrones[0], opciones);
    const partes = [];
    for (const p of patrones) {
        partes.push('(?:' + (opciones.literal
            ? escaparLiteral(String(p == null ? '' : p))
            : convertir(String(p == null ? '' : p), opciones.ere === true)) + ')');
    }
    try {
        return new RegExp(partes.join('|'), opciones.icase ? 'i' : '');
    } catch (e) {
        throw new RegexError('Invalid regular expression');
    }
}

// ---------- descenso recursivo ----------

function convertir(texto, ere) {
    const st = { src: texto, i: 0, grupos: 0 };
    const fuente = parseAlternacion(st, ere, false);
    if (st.i < st.src.length) throw new RegexError('Unmatched ) or \\)');
    return fuente;
}

/** `rama ('|' rama)*`, ya sea `|` (ERE) o `\|` (BRE). */
function parseAlternacion(st, ere, enGrupo) {
    let salida = parseRama(st, ere, enGrupo);
    while (hayAlternacion(st, ere)) {
        st.i += ere ? 1 : 2;
        salida += '|' + parseRama(st, ere, enGrupo);
    }
    return salida;
}

function hayAlternacion(st, ere) {
    if (st.i >= st.src.length) return false;
    if (ere) return st.src[st.i] === '|';
    return st.src[st.i] === '\\' && st.src[st.i + 1] === '|';
}

function hayCierreDeGrupo(st, ere) {
    if (st.i >= st.src.length) return false;
    if (ere) return st.src[st.i] === ')' && true;
    return st.src[st.i] === '\\' && st.src[st.i + 1] === ')';
}

/** Una rama: la secuencia de piezas hasta `|`, `\|`, cierre de grupo o fin. */
function parseRama(st, ere, enGrupo) {
    const src = st.src;
    let salida = '';
    while (st.i < src.length) {
        if (hayAlternacion(st, ere)) break;
        if (hayCierreDeGrupo(st, ere)) {
            if (enGrupo || !ere) break;
            // ERE sin grupo abierto: `)` suelto es literal (verificado).
            salida += '\\)';
            st.i++;
            continue;
        }
        const alInicio = salida === '';
        const antes = st.i;
        salida += parsePieza(st, ere, alInicio);
        if (st.i === antes) {
            // Red de seguridad: toda pieza debe consumir algo.
            salida += escaparSuelto(src[st.i]);
            st.i++;
        }
    }
    return salida;
}

/** Una pieza: atomo mas sus cuantificadores (`*`, `+`, `?`, `{n,m}`). */
function parsePieza(st, ere, alInicio) {
    const src = st.src;

    // Operadores sin atomo previo al principio de la rama.
    if (alInicio) {
        if (src[st.i] === '*') {
            st.i++;
            return ere ? '' : '\\*';
        }
        if (ere && (src[st.i] === '+' || src[st.i] === '?')) {
            st.i++;
            return '';
        }
        if (!ere && src[st.i] === '\\' && (src[st.i + 1] === '+' || src[st.i + 1] === '?')) {
            st.i += 2;
            return '\\' + src[st.i - 1];
        }
    }

    let js;
    let cuant = false;
    const c = src[st.i];

    if (c === '^') {
        // ERE: siempre ancla. BRE: solo al principio de la rama.
        if (ere || alInicio) { js = '^'; } else { js = '\\^'; }
        st.i++;
    } else if (c === '$' && (ere || esFinDeRama(src, st.i))) {
        js = '$';
        st.i++;
    } else {
        const a = parseAtomo(st, ere);
        js = a.js;
        cuant = a.cuant;
    }

    for (;;) {
        if (st.i >= src.length) break;
        const k = src[st.i];

        if (k === '*') {
            st.i++;
            js += cuant ? '*' : (ere ? '' : '\\*');
            continue;
        }
        if (ere && (k === '+' || k === '?')) {
            st.i++;
            if (cuant) js += k;
            continue;
        }
        if (!ere && k === '\\' && (src[st.i + 1] === '+' || src[st.i + 1] === '?')) {
            const op = src[st.i + 1];
            st.i += 2;
            if (cuant) js += op;
            continue;
        }
        const abreIntervalo = k === '{' ? st.i + 1
            : (!ere && k === '\\' && src[st.i + 1] === '{' ? st.i + 2 : -1);
        if (abreIntervalo >= 0) {
            const r = leerIntervalo(src, abreIntervalo, ere);
            if (r) {
                st.i = r.i;
                if (cuant) js += r.js;
                continue;
            }
            break; // `{` sin forma de intervalo: se vuelve a leer como literal.
        }
        break;
    }

    return js;
}

/** `$` es ancla en BRE solo si cierra la rama o el grupo. */
function esFinDeRama(src, i) {
    const n = src[i + 1];
    if (n === undefined || n === '|') return true;
    return n === '\\' && (src[i + 2] === ')' || src[i + 2] === '|');
}

/** Lee `{n}`, `{n,}` o `{n,m}`. Devuelve null si no tiene esa forma. */
function leerIntervalo(src, pos, ere) {
    let i = pos;
    let n = 0;
    let hayDigitos = false;
    while (i < src.length && src[i] >= '0' && src[i] <= '9') {
        n = n * 10 + (src[i].charCodeAt(0) - 48);
        i++;
        hayDigitos = true;
        if (n > 1000000) n = 1000000;
    }
    if (!hayDigitos) return null;

    let m = n;
    let abierto = false;
    if (i < src.length && src[i] === ',') {
        i++;
        abierto = true;
        if (i < src.length && src[i] >= '0' && src[i] <= '9') {
            m = 0;
            while (i < src.length && src[i] >= '0' && src[i] <= '9') {
                m = m * 10 + (src[i].charCodeAt(0) - 48);
                i++;
                if (m > 1000000) m = 1000000;
            }
        } else {
            m = Infinity;
        }
    }

    const cerrador = ere ? '}' : '\\}';
    if (!src.startsWith(cerrador, i)) return null;
    i += cerrador.length;

    if (m < n) throw new RegexError('Invalid content of \\{\\}');

    const js = abierto
        ? (m === Infinity ? '{' + n + ',' : '{' + n + ',' + m + '}')
        : '{' + n + '}';
    return { js, i };
}

/** Un atomo. `cuant` dice si detras puede ir un cuantificador valido. */
function parseAtomo(st, ere) {
    const src = st.src;
    const c = src[st.i];

    if (c === '.') { st.i++; return { js: '.', cuant: true }; }
    if (c === '[') {
        const r = leerClase(src, st.i);
        st.i = r.i;
        return { js: r.js, cuant: r.cuant };
    }

    if (c === '\\') {
        if (st.i + 1 >= src.length) throw new RegexError('Trailing backslash');
        const d = src[st.i + 1];
        if (!ere && d === '(') {
            st.i += 2;
            st.grupos++;
            const interior = parseAlternacion(st, ere, true);
            if (!(src[st.i] === '\\' && src[st.i + 1] === ')')) {
                throw new RegexError('Unmatched ( or \\(');
            }
            st.i += 2;
            return { js: '(?:' + interior + ')', cuant: true };
        }
        st.i += 2;
        return escapeAtomica(d, st);
    }

    if (ere && c === '(') {
        st.i++;
        st.grupos++;
        const interior = parseAlternacion(st, ere, true);
        if (src[st.i] !== ')') throw new RegexError('Unmatched ( or \\(');
        st.i++;
        return { js: '(?:' + interior + ')', cuant: true };
    }

    st.i++;
    return { js: escaparSuelto(c), cuant: true };
}

/** `\c` fuera de una clase. */
function escapeAtomica(d, st) {
    // Clases de caracteres que GNU conoce sin `-P`.
    if (d === 'w' || d === 'W' || d === 's' || d === 'S' || d === 'b' || d === 'B') {
        return { js: '\\' + d, cuant: true };
    }
    // Bordes de palabra de GNU: se expresan con miradas, que no admiten `*`.
    if (d === '<') return { js: '(?<!\\w)', cuant: false };
    if (d === '>') return { js: '(?!\\w)', cuant: false };

    if (d >= '0' && d <= '9') {
        const n = d.charCodeAt(0) - 48;
        if (n === 0) return { js: '\\x00', cuant: true };
        if (n > st.grupos) throw new RegexError('Invalid back reference');
        return { js: '\\' + n, cuant: true };
    }

    if (d === 'n') return { js: '\\x0a', cuant: true };
    if (d === 'r') return { js: '\\x0d', cuant: true };
    if (d === 't') return { js: '\\x09', cuant: true };
    if (d === 'f') return { js: '\\x0c', cuant: true };
    if (d === 'v') return { js: '\\x0b', cuant: true };
    if (d === 'a') return { js: '\\x07', cuant: true };
    if (d === 'e') return { js: '\\x1b', cuant: true };

    return { js: escaparSuelto(d), cuant: true };
}

/**
 * Lee una expresion de corchete desde `src[i] === '['`.
 * Cubre `^`, `!`, `]` inicial, rangos, `\` y `[:clase:]`.
 */
function leerClase(src, i) {
    let j = i + 1;
    let negado = false;
    if (src[j] === '^') { negado = true; j++; }

    let cuerpo = '';
    let primero = true;
    let anterior = null;
    while (j < src.length) {
        const c = src[j];

        if (c === ']' && !primero) {
            return { js: '[' + (negado ? '^' : '') + cuerpo + ']', i: j + 1, cuant: true };
        }

        if (c === '[' && src[j + 1] === ':') {
            const fin = src.indexOf(':]', j + 2);
            if (fin > 0) {
                const nombre = src.slice(j + 2, fin);
                const fragmento = CLASES[nombre];
                if (fragmento) { cuerpo += fragmento; j = fin + 2; primero = false; anterior = null; continue; }
            }
        }

        if (c === ']') { cuerpo += '\\]'; j++; primero = false; anterior = ']'; continue; }

        // Dentro de un conjunto POSIX la barra invertida NO escapa: `[\]]`
        // es el conjunto {\} seguido de un ] literal, y `[\.]` contiene tanto
        // la barra como el punto. Verificado con GNU grep 3.0.
        if (anterior !== null && c === '-' && j + 1 < src.length && src[j + 1] !== ']') {
            // El `-` cierra un rango cuyo extremo izquierdo es `anterior`.
            let limite = src[j + 1];
            let salto = 2;
            if (limite === '\\' && j + 2 < src.length) { limite = src[j + 2]; salto = 3; }
            if (limite.codePointAt(0) < anterior.codePointAt(0)) {
                throw new RegexError('Invalid range end');
            }
            cuerpo += '-' + escaparEnClase(limite);
            j += salto;
            anterior = null;
            primero = false;
            continue;
        }

        cuerpo += escaparEnClase(c);
        anterior = c;
        j++;
        primero = false;
    }

    throw new RegexError('Invalid regular expression');
}

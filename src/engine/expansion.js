/**
 * Expansion de palabras, la fase que bash llama "Cape".
 *
 * El parser entrega cada palabra como una lista de tramos (`lit`, `param`,
 * `sub`, `arith`, `tilde`) y cada tramo sabe si venia entrecomillado. Esa
 * distinction es la que sostiene todo el modulo: `"a b"` es un solo argumento,
 * `a b` son dos, y `ls *` expande pero `ls "*"` no.
 *
 * El orden es el de bash:
 *
 *   1. tilde
 *   2. variables, sustituciones y aritmetica
 *   3. division en palabras, respetando los tramos entrecomillados
 *   4. expansion de llaves
 *   5. globbing
 *
 * Solo esta fase ve el sistema de ficheros: es la que decide si `*.txt` se
 * queda literal o se convierte en la lista de ficheros que existen.
 */

import { ShellError, EXIT_MISUSE } from './errors.js';
import { normalizePath } from './fs.js';

export const IFS_POR_DEFECTO = ' \t\n';

const OPCIONES = {
    tilde: true,
    split: true,
    glob: true,
    brace: true
};

/**
 * Convierte las palabras de una orden en la lista final de argumentos.
 *
 * @param {object} ctx   `{ fs, cwd, env, getVar, setVar, runSub, evalArith, expand, globState }`
 * @param {Array}  words palabras del AST
 * @param {object} opts  permite desactivar fases: `{ tilde, split, glob, brace }`
 */
export function expandWords(ctx, words, opts = {}) {
    const opciones = { ...OPCIONES, ...opts };
    if (!opciones.tilde && !opciones.split && !opciones.glob && !opciones.brace) {
        return words.map((w) => textOf(w.parts));
    }
    const ifs = ctx.ifs ?? IFS_POR_DEFECTO;
    const salida = [];
    for (const palabra of words) {
        for (const campo of camposDe(ctx, palabra, opciones, ifs)) salida.push(campo);
    }
    return salida;
}

/**
 * Una palabra produce cero, uno o varios campos. Cero solo ocurre con `$@`/`$*`
 * sin argumentos entrecomillados, que se resuelve en `camposDe`.
 */
export function camposDe(ctx, palabra, opciones, ifs) {
    const { texto, mascara, limites } = expandirTramos(ctx, palabra.parts, opciones);
    const campos = opciones.split
        ? dividirCampos(texto, mascara, ifs, limites)
        : [{ texto, mascara }];
    const finales = [];
    for (const campo of campos) {
        if (opciones.brace) {
            for (const v of expandBraces(campo.texto, campo.mascara)) finales.push(opciones.glob ? glob(ctx, v, campo.mascara) : v);
        } else {
            finales.push(opciones.glob ? glob(ctx, campo.texto, campo.mascara) : campo.texto);
        }
    }
    return finales.flat();
}

/**
 * Resuelve tilde, variables, sustituciones y aritmetica.
 *
 * Devuelve el texto junto a una mascara booleana por caracter: `true` si el
 * caracter venia protegido. La mascara la usan luego la division en campos y
 * el globbing, y por eso se devuelve en vez de un string suelto.
 *
 * `limites` marca los puntos donde `"$@"` empieza un argumento nuevo. Es
 * información que no cabe en el texto: `set -- "uno dos" tres; echo "$@"` son
 * dos palabras, y eso solo se sabe si se recuerda dónde iba la separación.
 */
export function expandirTramos(ctx, parts, opciones = OPCIONES) {
    let texto = '';
    const mascara = [];
    const limites = new Set();
    for (const parte of parts) {
        const trozo = resolverParte(ctx, parte, opciones);
        const desplazamiento = texto.length;
        texto += trozo.texto;
        const protegido = parte.q === true;
        for (let i = 0; i < trozo.texto.length; i++) {
            mascara.push(protegido || trozo.mascara?.[i] === true);
        }
        if (trozo.limites) {
            for (const l of trozo.limites) limites.add(desplazamiento + l);
        }
    }
    return { texto, mascara, limites };
}

function resolverParte(ctx, parte, opciones) {
    switch (parte.k) {
        case 'lit':
            return plano(parte.v);
        case 'tilde':
            return plano(opciones.tilde === false ? '~' : homeDe(ctx, parte.user));
        case 'param':
            return valorParametro(ctx, parte);
        case 'sub':
            return plano(sustitucion(ctx, parte.src));
        case 'arith':
            return plano(String(ctx.evalArith(parte.src) | 0));
        default:
            throw new ShellError(`bad substitution`, EXIT_MISUSE);
    }
}

/** Tramo sincomsillas internas: la mascara la pone el llamante. */
function plano(texto) {
    return { texto };
}

/**
 * El texto que devuelve `ctx.expand` puede traer su propia mascara, y tiene que
 * respetarse: `${x:-"a b"}` es una sola palabra aunque dentro haya un espacio.
 * Se acepta tambien un string a pelo, por si quien lo implementa no lleva la
 * cuenta; en ese caso no hay nada protegido.
 */
function normalizarExpansion(r) {
    if (typeof r === 'string') return plano(r);
    return { texto: r.texto ?? '', mascara: r.mascara ?? [], limites: r.limites };
}
function textOf(parts) {
    let out = '';
    for (const p of parts) {
        if (p.k === 'lit') out += p.v;
        else if (p.k === 'param') out += '';
    }
    return out;
}

function homeDe(ctx, user) {
    if (!user) return ctx.env.HOME ?? '~';
    return ctx.passwd?.[user]?.home ?? '~' + user;
}

/** `$(...)` y backticks: stdout del subshell sin el salto de linea final. */
function sustitucion(ctx, src) {
    const r = ctx.runSub(src);
    let texto = r.stdout ?? '';
    if (texto.endsWith('\n')) texto = texto.slice(0, -1);
    return texto;
}

// ---------- parametros ----------

/**
 * Valor de `$x`, `$1`, `$?` y `${x:-y}` y sus variantes. Los operadores que
 * llevan patron expanden `arg` como una palabra normal, de modo que
 * `${x#$HOME}` y `${x/$(ls)/y}` funcionan.
 */
export function valorParametro(ctx, parte) {
    const { name, op, arg } = parte;

    if (name === '@' || name === '*') return posicionales(ctx, parte);
    if (!op) return plano(valorSimple(ctx, name));
    if (op === '#len') return plano(String((ctx.getVar(name) ?? '').length));
    if (op === 'slice') return plano(rebanar(ctx.getVar(name) ?? '', parte));

    const actual = ctx.getVar(name);
    const defined = actual != null;
    const vacio = actual === '';
    const valor = actual ?? '';

    if (op === ':=' || op === '=') {
        const usar = op.startsWith(':') ? vacio || !defined : !defined;
        if (usar) {
            const r = normalizarExpansion(ctx.expand(arg));
            ctx.setVar(name, r.texto);
            return r;
        }
        return plano(valor);
    }
    if (op === ':+' || op === '+') {
        const usar = op.startsWith(':') ? !vacio : defined;
        return usar ? normalizarExpansion(ctx.expand(arg)) : plano('');
    }
    if (op === ':?' || op === '?') {
        if (op.startsWith(':') ? vacio || !defined : !defined) {
            throw new ShellError(`${name}: ${arg}`, EXIT_MISUSE);
        }
        return plano(valor);
    }
    if (op === ':-' || op === '-') {
        const usar = op.startsWith(':') ? vacio || !defined : !defined;
        return usar ? normalizarExpansion(ctx.expand(arg)) : plano(valor);
    }

    // A partir de aquí el `arg` es un patrón: se expande como una palabra y el
    // resultado se usa como texto, nunca como una lista de campos. Se expande
    // perezoso para que un operador desconocido lance `bad substitution` sin
    // haber tocado el lexer.
    const patron = () => normalizarExpansion(ctx.expand(arg ?? '')).texto;
    if (op === '##') return plano(quitarPrefijo(valor, patron(), true));
    if (op === '#') return plano(quitarPrefijo(valor, patron(), false));
    if (op === '%%') return plano(quitarSufijo(valor, patron(), true));
    if (op === '%') return plano(quitarSufijo(valor, patron(), false));
    if (op === '//' || op === '/') return plano(reemplazar(valor, patron(), op === '//'));
    if (op === '/#') return plano(sustituirExtremo(valor, patron(), 'prefijo'));
    if (op === '/%') return plano(sustituirExtremo(valor, patron(), 'sufijo'));
    if (op === '^^' || op === '^') return plano(cambiarCaso(valor, 'mayus', op === '^^'));
    if (op === ',,' || op === ',') return plano(cambiarCaso(valor, 'minus', op === ',,'));

    throw new ShellError(`bad substitution`, EXIT_MISUSE);
}

/**
 * `$@` y `$*` devuelven los argumentos posicionales.
 *
 * La diferencia entre los dos solo aparece con comillas: `"$@"` mantiene cada
 * argumento por separado aunque tenga espacios dentro, mientras que `"$*"` los
 * junta en una sola palabra. Sin comillas los dos se comportan igual, porque
 * luego la division en campos se encarga de partirlo todo.
 */
function posicionales(ctx, parte) {
    const lista = ctx.argumentos ?? [];
    if (lista.length === 0) return plano('');
    const texto = lista.join(' ');
    if (parte.name === '@' && parte.q === true) {
        const limites = [];
        let salto = 0;
        for (const arg of lista.slice(0, -1)) {
            salto += arg.length + 1;
            limites.push(salto);
        }
        return { texto, mascara: new Array(texto.length).fill(true), limites };
    }
    if (parte.q === true) {
        return { texto, mascara: new Array(texto.length).fill(true) };
    }
    return plano(texto);
}

/** `${x^^}` y `${x^}`: mayusculas, la forma corta solo sobre el primer caracter. */
function cambiarCaso(valor, modo, todo) {
    if (todo) return modo === 'mayus' ? valor.toUpperCase() : valor.toLowerCase();
    if (valor === '') return valor;
    const primero = modo === 'mayus' ? valor[0].toUpperCase() : valor[0].toLowerCase();
    return primero + valor.slice(1);
}

function valorSimple(ctx, name) {
    if (name === '?') return String(ctx.lastStatus ?? 0);
    if (name === '$') return String(ctx.pid ?? 1);
    if (name === '#') return String(ctx.argumentos?.length ?? 0);
    if (/^\d+$/.test(name)) return ctx.argumentos?.[Number(name) - 1] ?? '';
    return ctx.getVar(name) ?? '';
}

function rebanar(valor, parte) {
    const desde = Number(parte.offset);
    const hasta = parte.length == null ? undefined : desde + Number(parte.length);
    return valor.slice(desde, hasta);
}

/**
 * `${x/#p/r}` y `${x/%p/r}`. A diferencia de `${x%p}`, aqui el patron no tiene
 * que casar con el sufijo entero: `${v/%log/LOGS}` cambia la `log` final y
 * deja intacto el resto, asi que el anclado va al final y no a los dos extremos.
 */
function sustituirExtremo(valor, arg, lado) {
    const { patron, reemplazo } = dividirSustitucion(arg);
    const cuerpo = globAPatron(patron);
    const re = new RegExp(lado === 'prefijo' ? '^' + cuerpo : cuerpo + '$');
    return valor.replace(re, reemplazo);
}

function reemplazar(valor, arg, global) {
    const { patron, reemplazo } = dividirSustitucion(arg);
    return valor.replace(new RegExp(globAPatron(patron), global ? 'g' : ''), reemplazo);
}

/** `${x/patron/reemplazo}`; si falta el segundo `/`, el reemplazo es vacio. */
function dividirSustitucion(arg) {
    for (let i = 0; i < arg.length; i++) {
        if (arg[i] === '\\') { i++; continue; }
        if (arg[i] === '/') {
            return { patron: descapar(arg.slice(0, i)), reemplazo: descapar(arg.slice(i + 1)) };
        }
    }
    return { patron: descapar(arg), reemplazo: '' };
}

/** `\/` es una barra literal; el patron vuelve a ser una expresion regular. */
function descapar(s) {
    let out = '';
    for (let i = 0; i < s.length; i++) {
        if (s[i] === '\\' && i + 1 < s.length) { out += s[++i]; continue; }
        out += s[i];
    }
    return out;
}

/**
 * `${x#p}` quita el prefijo mas corto y `${x##p}` el mas largo.
 *
 * No se resuelve con una unica expresion regular porque "el mas corto" y "el
 * mas largo" dependen de donde ancla el patron, y un regex con cuantificador
 * vago o codicioso se equivoca de lado segun el caso. Aqui el patron se
 * ancla a la vez por los dos extremos sobre cada prefijo candidato, que es
 * justo lo que dice el manual: el patron tiene que casar con el prefijo
 * entero. Las cadenas son cortas, asi que recorrerlas es barato.
 */
function quitarPrefijo(valor, patron, largo) {
    const re = new RegExp('^' + globAPatron(patron) + '$');
    let corte = null;
    for (let i = 0; i <= valor.length; i++) {
        if (!re.test(valor.slice(0, i))) continue;
        if (!largo) return valor.slice(i);
        corte = i;
    }
    return corte === null ? valor : valor.slice(corte);
}

function quitarSufijo(valor, patron, largo) {
    const re = new RegExp('^' + globAPatron(patron) + '$');
    let corte = null;
    for (let i = valor.length; i >= 0; i--) {
        if (!re.test(valor.slice(i))) continue;
        if (!largo) return valor.slice(0, i);
        corte = i;
    }
    return corte === null ? valor : valor.slice(0, corte);
}

/**
 * Convierte un patron de shell en expresion regular. Se cubren `*`, `?`,
 * `[...]` y las barras invertidas, que es lo que aparece en las misiones.
 *
 * Hay dos dialectos y la diferencia importa: en el glob de rutas el asterisco
 * no cruza `/` (`/e*` no baja de directorio), pero al recortar `${x##patron}`
 * se come las barras, porque ahi se recorta una cadena y no un nombre.
 */
export function globAPatron(patron, opciones = {}) {
    const cualquiera = opciones.ruta ? '[^/]' : '.';
    let out = '';
    for (let i = 0; i < patron.length; i++) {
        const c = patron[i];
        if (c === '*') { out += cualquiera + '*'; continue; }
        if (c === '?') { out += cualquiera; continue; }
        if (c === '\\') { out += escapar(patron[++i] ?? '\\'); continue; }
        if (c === '[') {
            const clase = leerClase(patron, i);
            if (clase) { out += clase.regex; i = clase.fin; continue; }
            out += '\\[';
            continue;
        }
        out += escapar(c);
    }
    return out;
}

function escapar(c) {
    return /[.*+?^${}()|[\]\\]/.test(c) ? '\\' + c : c;
}

/** Lee `[abc]`, `[a-z]` o `[!abc]`. `fin` es el indice de la llave de cierre. */
function leerClase(patron, i) {
    let j = i + 1;
    let negado = false;
    if (patron[j] === '!' || patron[j] === '^') { negado = true; j++; }
    let cuerpo = '';
    if (patron[j] === ']') { cuerpo += '\\]'; j++; }
    while (j < patron.length && patron[j] !== ']') {
        if (patron[j] === '\\') { cuerpo += escapar(patron[j + 1] ?? '\\'); j += 2; continue; }
        cuerpo += escapar(patron[j]);
        j++;
    }
    if (j >= patron.length) return null;
    return { regex: `[${negado ? '^' : ''}${cuerpo}]`, fin: j };
}

// ---------- division en campos ----------

/**
 * Parte el texto por los separadores de IFS que NO estan protegidos. Un
 * separador entrecomillado vale como un caracter normal, y por eso la mascara
 * viene acompanando al texto desde `expandirTramos`.
 *
 * `limites` son los puntos donde `"$@"` corta entre argumentos aunque no haya
 * ninguno de esos separadores: `set -- "uno dos" tres; echo "$@"` son dos
 * palabras. El caracter anterior al limite es siempre el espacio que puso la
 * propia expansion, asi que se descarta en vez de dejarlo pegado al campo.
 */
export function dividirCampos(texto, mascara, ifs, limites) {
    if (texto === '') return [{ texto: '', mascara }];
    const separadores = new Set(ifs);
    const campos = [];
    let actual = '';
    let mascaraActual = [];
    let hayAlgo = false;
    for (let i = 0; i < texto.length; i++) {
        if (limites?.has(i) === true && i > 0) {
            if (hayAlgo || actual !== '') {
                campos.push({ texto: actual.slice(0, -1), mascara: mascaraActual.slice(0, -1) });
            }
            actual = '';
            mascaraActual = [];
            hayAlgo = false;
        } else if (!mascara[i] && separadores.has(texto[i])) {
            if (hayAlgo) campos.push({ texto: actual, mascara: mascaraActual });
            actual = '';
            mascaraActual = [];
            hayAlgo = false;
            continue;
        }
        actual += texto[i];
        mascaraActual.push(mascara[i] === true);
        hayAlgo = true;
    }
    if (hayAlgo) campos.push({ texto: actual, mascara: mascaraActual });
    return campos;
}

// ---------- expansion de llaves ----------

/** `{a,b}`, `{1..9}` y `{01..03..2}`, con anidamiento equilibrado. */
export function expandBraces(texto, mascara) {
    const inicio = buscarLlave(texto, mascara);
    if (inicio < 0) return [texto];
    const cierre = emparejar(texto, inicio);
    if (cierre < 0) return [texto];

    const prefijo = texto.slice(0, inicio);
    const sufijo = texto.slice(cierre + 1);
    const cuerpo = texto.slice(inicio + 1, cierre);

    const rango = /^(-?\d+)\.\.(-?\d+)(?:\.\.(-?\d+))?$/.exec(cuerpo);
    if (rango) {
        const desde = Number(rango[1]);
        const hasta = Number(rango[2]);
        const paso = rango[3] === undefined ? 1 : Math.abs(Number(rango[3]));
        if (paso === 0) return [texto];
        const ancho = Math.max(cero(cuerpo, String(rango[1]).length), String(hasta).length);
        const salida = [];
        if (desde <= hasta) for (let i = desde; i <= hasta; i += paso) salida.push(prefijo + rellenar(i, ancho) + sufijo);
        else for (let i = desde; i >= hasta; i -= paso) salida.push(prefijo + rellenar(i, ancho) + sufijo);
        return salida;
    }

    const partes = dividirTopLevel(cuerpo);
    if (partes.length < 2) return [prefijo + '{' + cuerpo + '}' + sufijo];

    const salida = [];
    for (const parte of partes) {
        for (const v of expandBraces(prefijo + parte + sufijo)) salida.push(v);
    }
    return salida;
}

/** `{01..09}` rellena con ceros porque el primer termino lleva el ancho. */
function cero(cuerpo, ancho) {
    return /^0\d/.test(cuerpo) ? ancho : 0;
}

function rellenar(n, ancho) {
    return ancho ? String(n).padStart(ancho, '0') : String(n);
}

/**
 * Busca una llave que abra una lista o un rango.
 *
 * Bash no se guía por lo que va justo detrás de la llave: `a{b,c}d` y
 * `f{1..3}` se expanden, mientras que `find {}` y `{unico}` se quedan como
 * estaban. Lo que decide es qué hay dentro: una coma o un `..` antes de la
 * llave de cierre. Si algo de eso venía entrecomillado, la palabra entera se
 * respeta y no se toca.
 */
function buscarLlave(texto, mascara) {
    for (let i = 0; i < texto.length; i++) {
        if (texto[i] === '\\') { i++; continue; }
        if (texto[i] !== '{') continue;
        if (mascara?.[i] === true) continue;
        const cierre = emparejar(texto, i);
        if (cierre < 0) continue;
        const cuerpo = texto.slice(i + 1, cierre);
        if (!cuerpo.includes(',') && !cuerpo.includes('..')) continue;
        if (mascara && mascara.slice(i, cierre + 1).some((p) => p === true)) continue;
        return i;
    }
    return -1;
}

function emparejar(texto, inicio) {
    let depth = 0;
    for (let i = inicio; i < texto.length; i++) {
        if (texto[i] === '\\') { i++; continue; }
        if (texto[i] === '{') depth++;
        else if (texto[i] === '}') { depth--; if (depth === 0) return i; }
    }
    return -1;
}

function dividirTopLevel(cuerpo) {
    const partes = [];
    let depth = 0;
    let actual = '';
    for (let i = 0; i < cuerpo.length; i++) {
        const c = cuerpo[i];
        if (c === '\\') { actual += c + (cuerpo[++i] ?? ''); continue; }
        if (c === '{') depth++;
        if (c === '}') depth--;
        if (c === ',' && depth === 0) { partes.push(actual); actual = ''; continue; }
        actual += c;
    }
    partes.push(actual);
    return partes;
}

// ---------- globbing ----------

/**
 * Una palabra con comodines se convierte en las rutas que existen, ordenadas
 * como GNU. Si no hay ninguna, la palabra se queda literal: es lo que permite
 * que `ls *.txt` avise y que `echo *.txt` muestre el patron.
 *
 * `ls "*"a` no hace globbing. En cuanto un caracter de patron entre comillas se
 * mezcla con texto sin comillas, bash considera la palabra entera literal, y
 * con un solo `*` citado ya basta.
 */
export function glob(ctx, patron, mascara) {
    if (!/[?*[]/.test(patron)) return patron;
    if (mascara && hayComodinProtegido(patron, mascara)) return patron;
    const cache = ctx.globState?.cache;
    const key = ctx.cwd + ' ' + patron;
    const hit = cache?.get(key);
    if (hit !== undefined) return hit === null ? patron : hit.slice();

    const resultados = resolverGlob(ctx, patron);
    const salida = resultados.length ? resultados.slice() : patron;

    if (cache) {
        if (cache.size > 2000) cache.clear();
        cache.set(key, resultados.length ? resultados : null);
    }
    return salida;
}

function hayComodinProtegido(patron, mascara) {
    for (let i = 0; i < patron.length; i++) {
        if (mascara[i] === true && /[?*[]/.test(patron[i])) return true;
    }
    return false;
}

function resolverGlob(ctx, patron) {
    const absoluta = patron.startsWith('/');
    const segmentos = patron.split('/');
    let alcanzables = [absoluta ? '/' : ''];

    for (const segmento of segmentos) {
        if (absoluta && segmento === '') continue;
        const siguiente = [];
        for (const base of alcanzables) {
            if (segmento === '' || segmento === '.') { siguiente.push(base || '.'); continue; }
            if (segmento === '..') { siguiente.push(normalizePath(ctx.cwd, (base || '.') + '/..')); continue; }
            if (!/[?*[]/.test(segmento)) {
                siguiente.push(base === '/' ? '/' + segmento : base ? base + '/' + segmento : segmento);
                continue;
            }
            for (const nombre of nombresQueCasan(ctx, base || '.', segmento)) {
                siguiente.push(base === '/' ? '/' + nombre : base ? base + '/' + nombre : nombre);
            }
        }
        alcanzables = siguiente;
    }

    const salida = [];
    for (const ruta of alcanzables) {
        if (ruta === '' || ruta === '.') continue;
        if (ctx.fs.node(normalizePath(ctx.cwd, ruta))) salida.push(ruta);
    }
    return salida;
}

/** Nombres de `base` que encajan con el patron, con el orden de GNU. */
function nombresQueCasan(ctx, base, patron) {
    const node = ctx.fs.node(normalizePath(ctx.cwd, base));
    if (!node || node.type !== 'dir') return [];
    const re = new RegExp('^' + globAPatron(patron, { ruta: true }) + '$');
    const nombres = [];
    for (const hijo of node.list()) {
        if (hijo.name.startsWith('.') && !patron.startsWith('.')) continue;
        if (re.test(hijo.name)) nombres.push(hijo.name);
    }
    if (nombres.length === 1 && nombres[0] === '.') return [];
    nombres.sort(compararNombres);
    return nombres;
}

/**
 * Orden de GNU: los ocultos van al final porque empiezan por punto, y dentro de
 * cada grupo se compara sin distinguir mayusculas, como hace `ls`.
 */
function compararNombres(a, b) {
    const da = a.startsWith('.') ? 0 : 1;
    const db = b.startsWith('.') ? 0 : 1;
    if (da !== db) return da - db;
    const la = a.toLowerCase();
    const lb = b.toLowerCase();
    if (la !== lb) return la < lb ? -1 : 1;
    return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * awk — lenguaje de calculo sobre lineas.
 *
 * Mensajes verificados con GNU awk 5.1:
 *   awk: can't open file nope
 *   awk: cmd. line:1: unexpected '{'
 *   awk: division by zero
 *   awk: awk: command not satisfied
 *
 * Se cubre el subconjunto que aparece en las misiones: patron de entrada,
 * bloques `{ }`, `print` con separador configurable, `printf`, variables
 * (cadena y numerica), `NR`, `NF`, `$0`..`$n`, `split`, `length`, `substr`,
 * `index`, `toupper`, `tolower`, `sprintf`, arrays, `for`, `if/else`, mientras
 * y el bucle `while`, mas comparaciones numericas y de cadena.
 *
 * No se implementan: `getline` desde fichero, funciones de usuario, `system()`,
 * `ENVIRON`, `match()` con un array de tercer argumento, ni los bucles de gawk.
 */

import { ShellError, EXIT_ERROR, EXIT_MISUSE } from '../errors.js';
import { normalizePath } from '../fs.js';
import { partir, motivo, quote } from './io.js';

function error(mensaje) {
    return new ShellError('awk: ' + mensaje, EXIT_ERROR);
}

export default {
    name: 'awk',
    alias: [],
    synopsis: 'awk [OPTION]... \'program\' [FILE]...',
    run(ctx, argv) {
        const opts = { separador: ' ', programas: [], ficheros: [], variables: {} };
        for (let i = 1; i < argv.length; i++) {
            const op = argv[i];
            if (op === '-F' || op === '--field-separator') { opts.separador = argv[++i] ?? ' '; continue; }
            if (/^-F.+/.test(op)) { opts.separador = op.slice(2); continue; }
            if (op.startsWith('--field-separator=')) { opts.separador = op.slice(19); continue; }
            if (op === '-v') { const par = argv[++i] ?? ''; const eq = par.indexOf('='); if (eq > 0) opts.variables[par.slice(0, eq)] = par.slice(eq + 1); continue; }
            if (op === '-e' || op === '--expression') { opts.programas.push(argv[++i] ?? ''); continue; }
            if (op === '-f' || op === '--file') { opts.fichero = argv[++i]; continue; }
            if (op === '--help') throw new ShellError("Usage: awk [OPTION]... 'program' [FILE]...", EXIT_MISUSE);
            if (op.length > 1 && op[0] === '-') continue;
            opts.programas.push(op);
            opts.ficheros.push(...argv.slice(i + 1));
            break;
        }
        if (opts.fichero) {
            try {
                opts.programas.unshift(ctx.fs.readFile(normalizePath(ctx.cwd, opts.fichero)));
            } catch (e) {
                ctx.stderr.write("awk: can't open file " + opts.fichero + '\n');
                return 2;
            }
        }
        if (!opts.programas.length) throw error("no program specified");

        const ficheros = opts.ficheros.length ? opts.ficheros : ['-'];
        const inter = new Interprete(opts, ctx);
        let code = 0;
        inter.empezar();
        for (const fichero of ficheros) {
            let texto = null;
            if (fichero === '-') texto = ctx.stdin ?? '';
            else {
                try {
                    texto = ctx.fs.readFile(normalizePath(ctx.cwd, fichero));
                } catch (e) {
                    ctx.stderr.write("awk: can't open file " + quote(fichero) + ': ' + motivo(e) + '\n');
                    code = 2;
                    continue;
                }
            }
            inter.alinearSeparador();
            for (const linea of partir(texto)) {
                inter.registrar(linea);
                try {
                    inter.ejecutar();
                } catch (e) {
                    if (e instanceof ShellError) throw e;
                    throw error(e.message);
                }
            }
        }
        inter.fin();
        return code;
    }
};

/** Variables y funciones de awk. */
class Interprete {
    constructor(opts, ctx) {
        this.ctx = ctx;
        this.separador = opts.separador ?? ' ';
        this.vars = new Map(Object.entries(opts.variables));
        // `-F,` en la linea de ordenes equivale a FS=','.
        this.vars.set('FS', this.separador);
        this.vars.set('OFS', ' ');
        this.arrays = new Map();
        this.registro = { campos: [], texto: '' };
        this.nr = 0;
        this.salida = [];
        this.bien = null;
        this.asi = null;
        this.reglas = [];
        for (const programa of opts.programas) this.reglas.push(...this.compilarPrograma(programa));
    }

    alinearSeparador() {
        const s = this.vars.get('FS');
        if (s !== undefined) this.separador = s === ' ' ? ' ' : s;
    }

    registrar(linea) {
        this.nr++;
        this.registro.texto = linea;
        this.registro.campos = this.separar(linea);
        this.vars.set('NF', this.registro.campos.length);
        this.vars.set('NR', this.nr);
        this.vars.set('FNR', this.nr);
    }

    separar(linea) {
        if (this.separador === ' ') {
            const m = /^[\s]*(\S*)(\s+.*)?$/.exec(linea);
            if (!m) return [''];
            return [m[1], ...(m[2] ? m[2].trim().split(/\s+/) : [])];
        }
        if (/\\t/.test(this.separador)) this.separador = this.separador.replace(/\\t/g, '\t');
        return linea.split(this.separador);
    }

    /** `BEGIN` se ejecuta una vez antes de leer nada. */
    empezar() {
        if (this.bien) {
            this.registro.texto = '';
            this.registro.campos = [''];
            this.ejecutarCuerpo(this.bien);
        }
    }

    /** `END` se ejecuta una vez, despues de todos los registros. */
    fin() {
        if (this.asi) {
            this.registro.texto = '';
            this.registro.campos = [''];
            this.vars.set('NF', 0);
            this.ejecutarCuerpo(this.asi);
        }
    }

    /** Compila el programa en una lista de reglas `{ patron, cuerpo }`. */
    compilarPrograma(programa) {
        const reglas = [];
        const texto = programa.replace(/\\\{/g, '\u0001').replace(/\\\}/g, '\u0002');
        let i = 0;
        while (i < texto.length) {
            while (i < texto.length && /[\s;]/.test(texto[i])) i++;
            if (i >= texto.length) break;
            if (texto[i] === '{') {
                const bloque = this.leerCuerpo(texto, i);
                reglas.push({ patron: null, cuerpo: bloque.sentencias });
                i = bloque.fin + 1;
                continue;
            }
            const patron = this.leerHasta(texto, i, ['{']);
            i = patron.fin;
            if (texto[i] !== '{') {
                // `print` o `printf` sin bloque: se ejecuta siempre.
                reglas.push({ patron: null, cuerpo: [{ tipo: 'print', args: [{ v: patron.texto.trim() }] }] });
                continue;
            }
            const bloque = this.leerCuerpo(texto, i);
            const condicion = patron.texto.trim();
            if (condicion === 'BEGIN') this.bien = bloque.sentencias;
            else if (condicion === 'END') this.asi = bloque.sentencias;
            else reglas.push({ patron: condicion, cuerpo: bloque.sentencias });
            i = bloque.fin + 1;
        }
        return reglas;
    }

    /** Lee un bloque `{ ... }` y devuelve `{ sentencias, fin }`. */
    leerCuerpo(texto, inicio) {
        const fin = this.encontrarCierre(texto, inicio);
        const interior = texto.slice(inicio + 1, fin);
        return { sentencias: this.compilarSentencias(interior), fin };
    }

    encontrarCierre(texto, inicio) {
        let nivel = 0;
        for (let i = inicio; i < texto.length; i++) {
            if (texto[i] === '{') nivel++;
            else if (texto[i] === '}') { nivel--; if (nivel === 0) return i; }
        }
        throw error("unexpected '{'");
    }

    /** Lee hasta uno de los separadores dados, respetando comillas y parentesis. */
    leerHasta(texto, inicio, separadores) {
        let i = inicio;
        let dentro = null;
        let nivel = 0;
        while (i < texto.length) {
            const c = texto[i];
            if (dentro) { if (c === dentro) dentro = null; i++; continue; }
            if (c === '"' || c === "'") { dentro = c; i++; continue; }
            if (c === '(') { nivel++; i++; continue; }
            if (c === ')') { nivel--; i++; continue; }
            if (nivel === 0 && separadores.includes(c)) break;
            i++;
        }
        return { texto: texto.slice(inicio, i), fin: i };
    }

    /** Convierte un bloque de codigo en sentencias ejecutables. */
    compilarSentencias(fuente) {
        const sentencias = [];
        const texto = fuente.replace(/\u0001/g, '{').replace(/\u0002/g, '}');
        let i = 0;
        while (i < texto.length) {
            while (i < texto.length && /[\s;\n]/.test(texto[i])) i++;
            if (i >= texto.length) break;
            const sentencia = this.leerSentencia(texto, i);
            if (!sentencia) break;
            sentencias.push(sentencia);
            i = sentencia.fin;
        }
        return sentencias;
    }

    leerSentencia(texto, inicio) {
        const palabra = /^([A-Za-z_][A-Za-z_0-9]*)/.exec(texto.slice(inicio));
        const cmd = palabra ? palabra[1] : null;
        const desde = inicio + (palabra ? palabra[1].length : 0);

        switch (cmd) {
            case 'if': {
                const cond = this.leerHasta(texto, desde, ['{']);
                const bloque = this.leerCuerpo(texto, cond.fin);
                let fin = bloque.fin + 1;
                let alternativa = null;
                const resto = texto.slice(fin).match(/^\s*else/);
                if (resto) {
                    const pos = fin + resto[0].length;
                    if (texto[pos] === '{') {
                        const otro = this.leerCuerpo(texto, pos);
                        alternativa = otro.sentencias;
                        fin = otro.fin + 1;
                    }
                }
                return { tipo: 'if', cond: cond.texto.trim(), cuerpo: bloque.sentencias, alternativa, fin };
            }
            case 'for': case 'while': {
                const cab = this.leerHasta(texto, desde, ['{']);
                const bloque = this.leerCuerpo(texto, cab.fin);
                return { tipo: 'bloque', cabecera: cab.texto.trim(), cuerpo: bloque.sentencias, fin: bloque.fin + 1 };
            }
            case '{': {
                const bloque = this.leerCuerpo(texto, inicio);
                return { tipo: 'bloque', cabecera: null, cuerpo: bloque.sentencias, fin: bloque.fin + 1 };
            }
            case 'print': case 'printf': {
                const args = this.leerHasta(texto, desde, [';', '}', '\n']);
                return { tipo: cmd, args: this.parseArgumentos(args.texto), fin: args.fin };
            }
            default: {
                const expr = this.leerHasta(texto, inicio, [';', '}', '\n']);
                if (!expr.texto.trim()) return null;
                return { tipo: 'expr', expr: expr.texto.trim(), fin: expr.fin };
            }
        }
    }

    /** `print $1, $2 > "f"` y `print >> "f"`: redireccion a fichero. */
    parseArgumentos(texto) {
        const args = [];
        let i = 0;
        let actual = '';
        let dentro = null;
        while (i < texto.length) {
            const c = texto[i];
            if (dentro) { actual += c; if (c === dentro) dentro = null; i++; continue; }
            if (c === '"' || c === "'") { dentro = c; actual += c; i++; continue; }
            if (c === ',') { args.push(actual.trim()); actual = ''; i++; continue; }
            if (c === '>' && texto[i + 1] === '>') { args.push(actual.trim()); args.push({ red: '>>', destino: texto.slice(i + 2).trim() }); actual = ''; i = texto.length; break; }
            if (c === '>') { args.push(actual.trim()); args.push({ red: '>', destino: texto.slice(i + 1).trim() }); actual = ''; i = texto.length; break; }
            actual += c;
            i++;
        }
        if (actual.trim()) args.push(actual.trim());
        return args;
    }

    ejecutar() {
        for (const regla of this.reglas) {
            if (regla.patron === null) { this.ejecutarCuerpo(regla.cuerpo); continue; }
            if (this.cumplePatron(regla.patron)) this.ejecutarCuerpo(regla.cuerpo);
        }
    }

    cumplePatron(patron) {
        const m = /^(\/([^/\\]|\\.)*\/)([a-zA-Z]*)$/.exec(patron);
        if (!m) {
            // `BEGIN`, `END` o un patron como expresion: se compara el valor.
            const valor = this.evaluar(patron);
            return esCierto(valor);
        }
        const flags = m[3].includes('i') ? 'i' : '';
        let regex;
        try {
            regex = new RegExp(m[2], flags);
        } catch (e) {
            throw error('cmd. line:1: invalid regex');
        }
        return regex.test(this.registro.texto);
    }

    ejecutarCuerpo(cuerpo) {
        for (const sentencia of cuerpo) this.ejecutarSentencia(sentencia);
    }

    ejecutarSentencia(s) {
        switch (s.tipo) {
            case 'print': return this.hacerPrint(s, false);
            case 'printf': return this.hacerPrintf(s);
            case 'if':
                if (esCierto(this.evaluar(s.cond))) this.ejecutarCuerpo(s.cuerpo);
                else if (s.alternativa) this.ejecutarCuerpo(s.alternativa);
                return;
            case 'bloque': return this.ejecutarBloque(s);
            case 'expr': this.evaluar(s.expr); return;
            default: return;
        }
    }

    ejecutarBloque(s) {
        const cab = s.cabecera ?? '';
        if (cab.startsWith('while')) {
            const condicion = cab.slice(5).replace(/^\s*\(/, '').replace(/\)\s*$/, '').trim();
            let vueltas = 0;
            while (esCierto(this.evaluar(condicion))) {
                if (++vueltas > 1000000) throw error('infinite loop');
                this.ejecutarCuerpo(s.cuerpo);
            }
            return;
        }
        if (cab.startsWith('for')) {
            const m = /^for\s*\((.*?);(.*?);(.*?)\)\s*$/.exec(cab);
            if (!m) throw error('cmd. line:1: expected \'(\' in for');
            if (m[1].trim()) this.ejecutarSentencia({ tipo: 'expr', expr: m[1].trim() });
            let vueltas = 0;
            for (;;) {
                if (m[2].trim() && !esCierto(this.evaluar(m[2].trim()))) break;
                if (++vueltas > 1000000) throw error('infinite loop');
                this.ejecutarCuerpo(s.cuerpo);
                if (m[3].trim()) this.evaluar(m[3].trim());
            }
            return;
        }
        // `for (i in arr)`
        const m = /^for\s*\((\w+)\s+in\s+(.+)\)\s*$/.exec(cab);
        if (m) {
            const arr = this.arrays.get(this.evaluar(m[2].trim())) ?? new Map();
            for (const clave of [...arr.keys()]) {
                this.vars.set(m[1], clave);
                this.ejecutarCuerpo(s.cuerpo);
            }
            return;
        }
        this.ejecutarCuerpo(s.cuerpo);
    }

    hacerPrint(s, conSeparador) {
        const argumentos = s.args;
        let destino = null;
        const valores = [];
        for (const a of argumentos) {
            if (typeof a === 'object' && a.red) { destino = a; continue; }
            valores.push(this.evaluar(a));
        }
        let texto;
        if (!valores.length) texto = this.registro.texto;
        else texto = valores.map((v) => textoDe(v)).join(this.vars.get('OFS') ?? ' ');
        if (destino) {
            const ruta = textoDe(this.evaluar(destino.destino));
            const previo = this.ctx.fs.exists(ruta) ? this.ctx.fs.readFile(ruta) : '';
            this.ctx.fs.writeFile(ruta, destino.red === '>>' ? previo + texto + '\n' : texto + '\n');
            return;
        }
        this.escribir(texto + '\n');
    }

    hacerPrintf(s) {
        const argumentos = s.args;
        if (!argumentos.length) return;
        const formato = textoDe(this.evaluar(argumentos[0]));
        const valores = argumentos.slice(1).map((a) => this.evaluar(a));
        this.escribir(formatear(formato, valores));
    }

    escribir(texto) {
        this.ctx.stdout.write(texto);
    }

    // ---------- expresiones ----------

    evaluar(fuente) {
        return new Expresion(fuente, this).valor();
}

    campo(n) {
        if (n === 0) return this.registro.texto;
        return this.registro.campos[n - 1] ?? '';
    }
}

function esCierto(v) {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    return v !== '' && v !== '0';
}

/**
 * `<`, `<=`, `>` y `>=`: numerico si LOS DOS lados parecen numeros; si no,
 * como cadena. Es la regla de awk, y se nota: `"salario" > 3000` es verdad
 * porque "salario" va despues de "3" en el alfabeto.
 */
function esMenor(a, b) {
    const na = numeroDe(a);
    const nb = numeroDe(b);
    if (na !== null && nb !== null) return na < nb;
    return textoDe(a) < textoDe(b);
}

/** `==` sigue la misma regla: numerico solo si ambos son numeros. */
function iguales(a, b) {
    const na = numeroDe(a);
    const nb = numeroDe(b);
    if (na !== null && nb !== null) return na === nb;
    return textoDe(a) === textoDe(b);
}

function numeroDe(texto) {
    const t = String(texto).trim();
    return /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t) ? Number(t) : null;
}

/** Valor como cadena: es lo que imprimen `print` y las comparaciones. */
function textoDe(v) {
    if (typeof v === 'string') return v;
    if (typeof v === 'boolean') return v ? '1' : '0';
    return numero(v);
}

/** Formato de awk: enteros sin decimales, resto con hasta 6 (como %g). */
function numero(n) {
    if (!Number.isFinite(n)) return n > 0 ? 'inf' : '-inf';
    if (Number.isInteger(n)) return String(n);
    return String(Number(n.toPrecision(6)));
}

const CONVERSORES = {
    d: (v) => String(Math.trunc(Number(v))),
    i: (v) => String(Math.trunc(Number(v))),
    f: (v) => Number(v).toFixed(6),
    g: (v) => numero(Number(v)),
    s: (v) => textoDe(v),
    c: (v) => String.fromCharCode(Number(v)),
    x: (v) => Number(v).toString(16),
    X: (v) => Number(v).toString(16).toUpperCase(),
    o: (v) => Number(v).toString(8),
    e: (v) => Number(v).toExponential(6),
    '%': () => '%'
};

/** `printf` de awk: reutiliza el motor de C con los mismos especificadores. */
function formatear(formato, valores) {
    let i = 0;
    return formato.replace(/%[-+ #0]*[0-9]*(?:\.[0-9]+)?([diouxXeEfFgGcs%])/g, (todo, conv) => {
        if (conv === '%') return '%';
        const v = valores[i++] ?? 0;
        const f = CONVERSORES[conv] ?? CONVERSORES.g;
        return f(v);
    });
}

/** Evaluador de expresiones de awk por descenso recursivo. */
class Expresion {
    constructor(fuente, inter) {
        this.f = String(fuente).trim();
        this.i = 0;
        this.inter = inter;
    }

    valor() {
        const v = this.asignacion();
        if (this.f.slice(this.i).trim()) {
            throw error('cmd. line:1: syntax error at ' + this.f.slice(this.i).trim());
        }
        return v;
    }

    /** `n = expr`, `n += expr` y `a[i] = expr`: la asignacion mas externa. */
    asignacion() {
        // El patron mira el resto del texto, no el principio absoluto: si no,
        // `n=1` volveria a casar consigo mismo y no pararia nunca.
        const resto = this.f.slice(this.i);
        const m = /^\s*([A-Za-z_][A-Za-z_0-9]*)(\[[^\]]*\])?\s*(\+=|=)(?!=)/.exec(resto);
        if (!m) return this.ternario();
        this.i += m[0].length;
        const valor = this.asignacion();
        if (m[2]) {
            const arr = this.inter.arrays.get(m[1]) ?? new Map();
            this.inter.arrays.set(m[1], arr);
            const clave = m[2].slice(1, -1).trim();
            arr.set(clave, m[3] === '+=' ? num(arr.get(clave)) + num(valor) : valor);
        } else {
            const anterior = this.inter.vars.get(m[1]);
            this.inter.vars.set(m[1], m[3] === '+=' ? num(anterior) + num(valor) : valor);
        }
        return valor;
    }

    espacios() { while (this.i < this.f.length && /\s/.test(this.f[this.i])) this.i++; }

    ternario() {
        const cond = this.logico();
        this.espacios();
        if (this.f[this.i] === '?') {
            this.i++;
            const si = this.ternario();
            this.espacios();
            if (this.f[this.i] !== ':') throw error("cmd. line:1: expected ':'");
            this.i++;
            const no = this.ternario();
            return esCierto(cond) ? si : no;
        }
        return cond;
    }

    logico() {
        let izq = this.conector();
        for (;;) {
            this.espacios();
            if (this.f.startsWith('&&', this.i)) { this.i += 2; const der = this.conector(); izq = esCierto(izq) && esCierto(der); }
            else if (this.f.startsWith('||', this.i)) { this.i += 2; const der = this.conector(); izq = esCierto(izq) || esCierto(der); }
            else if (this.f[this.i] === '!' && this.f[this.i + 1] !== '=') { this.i++; izq = !esCierto(this.conector()); }
            else return izq;
        }
    }

    conector() {
        let izq = this.comparacion();
        for (;;) {
            this.espacios();
            const op = this.f.slice(this.i).match(/^(==|!=|<=|>=|&&|\|\||=~|<|>)/);
            if (!op) return izq;
            if (op[1] === '&&' || op[1] === '||') return izq;
            this.i += op[1].length;
            const der = this.comparacion();
            switch (op[1]) {
                case '==': izq = iguales(izq, der); break;
                case '!=': izq = !iguales(izq, der); break;
                case '<': izq = esMenor(izq, der); break;
                case '<=': izq = esMenor(izq, der) || iguales(izq, der); break;
                case '>': izq = esMenor(der, izq); break;
                case '>=': izq = esMenor(der, izq) || iguales(der, izq); break;
                case '=~': izq = new RegExp(textoDe(der)).test(textoDe(izq)); break;
                default: break;
            }
        }
    }

    comparacion() {
        let izq = this.adicion();
        for (;;) {
            this.espacios();
            const op = this.f.slice(this.i).match(/^(\+|-)/);
            if (!op) return izq;
            this.i++;
            const der = this.adicion();
            izq = op[0] === '+' ? num(izq) + num(der) : num(izq) - num(der);
        }
    }

    adicion() {
        let izq = this.producto();
        for (;;) {
            this.espacios();
            const op = this.f.slice(this.i).match(/^(\*|\/|%)/);
            if (!op) return izq;
            this.i++;
            const der = this.producto();
            if (op[0] === '*') izq = num(izq) * num(der);
            else if (op[0] === '/') {
                if (num(der) === 0) throw error('division by zero');
                izq = num(izq) / num(der);
            } else {
                if (num(der) === 0) throw error('division by zero in %');
                izq = num(izq) % num(der);
            }
        }
    }

    producto() {
        let izq = this.unario();
        for (;;) {
            this.espacios();
            if (this.f[this.i] === '^') { this.i++; izq = Math.pow(num(izq), num(this.unario())); continue; }
            if (this.f.startsWith('++', this.i) || this.f.startsWith('--', this.i)) {
                const signo = this.f.startsWith('++') ? 1 : -1;
                this.i += 2;
                const nombre = this.f.slice(this.i).match(/^[A-Za-z_][A-Za-z_0-9]*/)?.[0];
                if (!nombre) throw error("cmd. line:1: expected lvalue");
                this.i += nombre.length;
                this.inter.vars.set(nombre, num(this.inter.vars.get(nombre) ?? 0) + signo);
                continue;
            }
            return izq;
        }
    }

    unario() {
        this.espacios();
        if (this.f[this.i] === '-' && this.f[this.i + 1] !== '-') { this.i++; return -num(this.unario()); }
        if (this.f[this.i] === '+') { this.i++; return num(this.unario()); }
        if (this.f[this.i] === '!') { this.i++; return !esCierto(this.unario()); }
        return this.postfijo();
    }

    postfijo() {
        let v = this.primario();
        for (;;) {
            this.espacios();
            if (this.f.startsWith('++', this.i)) { this.i += 2; v = num(v) + 1; continue; }
            if (this.f.startsWith('--', this.i)) { this.i += 2; v = num(v) - 1; continue; }
            return v;
        }
    }

    primario() {
        this.espacios();
        const c = this.f[this.i];
        if (c === undefined) throw error('cmd. line:1: unexpected end of file');
        if (c === '(') {
            this.i++;
            const v = this.ternario();
            this.espacios();
            if (this.f[this.i] !== ')') throw error("cmd. line:1: expected ')'");
            this.i++;
            return v;
        }
        if (c === '$') {
            this.i++;
            const n = this.unario();
            return this.inter.campo(num(n));
        }
        if (c === '"') return this.cadena();
        if (c === "'") return this.cadena();
        if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(this.f[this.i + 1] ?? ''))) return this.numero();
        if (/[A-Za-z_]/.test(c)) return this.identificador();
        if (c === '!') { this.i++; return !esCierto(this.unario()); }
        throw error('cmd. line:1: unexpected \'' + c + '\'');
    }

    cadena() {
        const comilla = this.f[this.i];
        this.i++;
        let s = '';
        while (this.i < this.f.length && this.f[this.i] !== comilla) {
            if (this.f[this.i] === '\\') { s += desescapar(this.f[this.i + 1]); this.i += 2; continue; }
            s += this.f[this.i];
            this.i++;
        }
        this.i++;
        return s;
    }

    numero() {
        const m = /^[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?/.exec(this.f.slice(this.i));
        if (!m) throw error('cmd. line:1: syntax error');
        this.i += m[0].length;
        return Number(m[0]);
    }

    identificador() {
        const m = /^[A-Za-z_][A-Za-z_0-9]*/.exec(this.f.slice(this.i));
        this.i += m[0].length;
        const nombre = m[0];

        this.espacios();
        if (this.f[this.i] === '(') {
            this.i++;
            const args = [];
            this.espacios();
            if (this.f[this.i] !== ')') {
                for (;;) {
                    this.espacios();
                    args.push(this.ternario());
                    this.espacios();
                    if (this.f[this.i] === ',') { this.i++; continue; }
                    break;
                }
            }
            this.espacios();
            if (this.f[this.i] !== ')') throw error("cmd. line:1: expected ')' in call to '" + nombre + "'");
            this.i++;
            return this.llamar(nombre, args);
        }

        // `arr[i]` es un elemento de array.
        if (this.f[this.i] === '[') {
            this.i++;
            const clave = textoDe(this.ternario());
            this.espacios();
            if (this.f[this.i] !== ']') throw error("cmd. line:1: expected ']'");
            this.i++;
            const arr = this.inter.arrays.get(nombre) ?? new Map();
            this.inter.arrays.set(nombre, arr);
            if (!arr.has(clave)) arr.set(clave, '');
            return arr.get(clave);
        }
        // Un Map no admite `in`: hay que preguntar con `has`.
        if (this.inter.vars.has(nombre)) return this.inter.vars.get(nombre);
        return '';
    }

    /** Funciones de la libreria de awk que necesitar el estado del interprete. */
    llamar(nombre, args) {
        const i = this.inter;
        switch (nombre) {
            case 'length': return args.length ? textoDe(args[0]).length : textoDe(i.registro.texto).length;
            case 'substr': {
                const s = textoDe(args[0]);
                const ini = Math.trunc(num(args[1]));
                const largo = args.length > 2 ? Math.trunc(num(args[2])) : s.length;
                const desde = ini - 1;
                return desde < 0 ? (largo > 0 ? s.slice(0, largo) : '') : s.slice(desde, desde + largo);
            }
            case 'index': return textoDe(args[0]).indexOf(textoDe(args[1])) + 1;
            case 'toupper': return textoDe(args[0]).toUpperCase();
            case 'tolower': return textoDe(args[0]).toLowerCase();
            case 'int': return Math.trunc(num(args[0]));
            case 'sqrt': return Math.sqrt(num(args[0]));
            case 'exp': return Math.exp(num(args[0]));
            case 'log': return Math.log(num(args[0]));
            case 'sin': return Math.sin(num(args[0]));
            case 'cos': return Math.cos(num(args[0]));
            case 'rand': return 0;
            case 'srand': { i.vars.set('__semilla', num(args[0] ?? 0)); return 0; }
            case 'printf': {
                const texto = formatear(textoDe(args[0]), args.slice(1));
                i.escribir(texto);
                return '';
            }
            case 'system': return 0;
            case 'split': {
                const partes = textoDe(args[0]).split(this.inter.separador === ' ' ? /\s+/ : this.inter.separador);
                const arr = i.arrays.get(textoDe(args[1])) ?? new Map();
                partes.forEach((p, k) => arr.set(String(k + 1), p));
                i.arrays.set(textoDe(args[1]), arr);
                return partes.length;
            }
            case 'sub': case 'gsub': {
                const global = nombre === 'gsub';
                return this.sustituir(args, global);
            }
            case 'match': {
                const m = new RegExp(textoDe(args[1])).exec(textoDe(args[0]));
                return m ? m.index + 1 : 0;
            }
            default:
                throw error("cmd. line:1: calling undefined function " + nombre);
        }
    }

    /** `sub`/`gsub` cambian `$0` o el campo indicado, y devuelven 1 si cambian. */
    sustituir(args, global) {
        const i = this.inter;
        const destino = args.length > 2 ? Math.trunc(num(args[2])) : 0;
        const patron = textoDe(args[0]);
        const texto = textoDe(destino ? i.campo(destino) : i.registro.texto);
        const regex = new RegExp(patron, global ? 'g' : '');
        const cuenta = texto.match(regex)?.length ?? 0;
        if (!cuenta) return 0;
        const nuevo = texto.replace(regex, args.length > 1 ? textoDe(args[1]) : '&');
        if (destino) {
            const campos = i.registro.campos.slice();
            campos[destino - 1] = nuevo;
            i.registro.campos = campos;
            i.registro.texto = campos.join(i.separador === ' ' ? ' ' : i.separador);
            i.vars.set('NF', campos.length);
        } else {
            i.registro.texto = nuevo;
            i.registro.campos = i.separar(nuevo);
            i.vars.set('NF', i.registro.campos.length);
        }
        return cuenta;
    }
}

function num(v) {
    if (typeof v === 'number') return v;
    if (v === '' || v === null || v === undefined) return 0;
    const n = Number(v);
    return Number.isNaN(n) ? 0 : n;
}

const ESCAPES_AWK = { n: '\n', t: '\t', r: '\r', '\\': '\\', '"': '"', '/': '/' };

function desescapar(c) {
    return ESCAPES_AWK[c] ?? c;
}

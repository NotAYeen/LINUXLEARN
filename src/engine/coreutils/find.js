/**
 * find — busca ficheros por sus propiedades.
 *
 * Mensajes verificados con GNU findutils 4.9:
 *   find: ‘nope’: No such file or directory
 *   find: paths must precede expression: -name
 *   find: unknown predicate -z
 *   find: missing argument to `-name'
 *
 * La expresion se analiza como en GNU: `-a` une, `-o` une con cortocircuito,
 * `!` niega y `( )` agrupa. Los predicados que se cubren son los de las
 * misiones: -name, -iname, -path, -ipath, -regex, -type, -size, -mtime, -mmin,
 * -newer, -empty, -perm, -user, -group, -maxdepth, -mindepth, -readable,
 * -writable, -executable, -prune, -print, -print0, -ls, -delete, -exec y
 * -execdir con `{}` y `\;`.
 */

import { ShellError, EXIT_ERROR } from '../errors.js';
import { normalizePath, formatOctal } from '../fs.js';
import { compilarPatron, RegexError } from './regex.js';
import { globAPatron } from '../expansion.js';
import { motivo } from './io.js';

function error(mensaje, code = EXIT_ERROR) {
    return new ShellError('find: ' + mensaje, code);
}

/** Predicados que llevan un argumento y los que no. */
const CON_ARGUMENTO = new Set([
    '-name', '-iname', '-wholename', '-path', '-ipath', '-regex', '-type',
    '-size', '-mtime', '-atime', '-mmin', '-amin', '-perm', '-user', '-group',
    '-newer', '-maxdepth', '-mindepth', '-samefile'
]);
const SIN_ARGUMENTO = new Set([
    '-empty', '-print', '-print0', '-ls', '-delete', '-prune', '-true',
    '-false', '-readable', '-writable', '-executable', '-nouser', '-nogroup'
]);

/** Convierte la cola de `argv` en una lista de { tipo, ... }. */
function lexear(argv) {
    const items = [];
    for (let i = 0; i < argv.length; i++) {
        const op = argv[i];
        if (op === '(' || op === ')') { items.push({ tipo: op }); continue; }
        if (op === '!') { items.push({ tipo: '!' }); continue; }
        if (op === '-a' || op === '-and' || op === ',') { items.push({ tipo: 'a' }); continue; }
        if (op === '-o' || op === '-or') { items.push({ tipo: 'o' }); continue; }
        if (op === '-not') { items.push({ tipo: '!' }); continue; }
        if (CON_ARGUMENTO.has(op)) {
            const valor = argv[++i];
            if (valor === undefined) error("missing argument to `" + op + "'");
            items.push({ tipo: 'pred', nombre: op, valor });
            continue;
        }
        if (SIN_ARGUMENTO.has(op)) { items.push({ tipo: 'pred', nombre: op }); continue; }
        if (op === '-exec' || op === '-execdir' || op === '-ok' || op === '-okdir') {
            const cmds = [];
            for (i++; i < argv.length; i++) {
                cmds.push(argv[i]);
                if (argv[i] === ';' || argv[i] === '+') break;
            }
            const fin = cmds.pop();
            if (fin !== ';' && fin !== '+') error("missing ';' before");
            if (!cmds.length) error("missing argument to `" + op + "'");
            items.push({ tipo: 'pred', nombre: op, comandos: cmds, cierre: fin });
            continue;
        }
        if (op.startsWith('-')) error('unknown predicate -' + op.replace(/^-/, ''));
        error('paths must precede expression: ' + op);
    }
    return items;
}

/** Expresion: `-o` separa alternativas, `-a` une, `!` niega, `( )` agrupa. */
function analizar(items) {
    let i = 0;

    function alternativa() {
        let izq = conjuncion();
        while (items[i] && items[i].tipo === 'o') {
            i++;
            const der = conjuncion();
            izq = { tipo: 'o', izq, der };
        }
        return izq;
    }

    function conjuncion() {
        let izq = unario();
        while (i < items.length && (items[i].tipo === 'a' || (items[i] && items[i].tipo !== 'o' && items[i].tipo !== ')'))) {
            if (items[i].tipo === 'a') i++;
            const der = unario();
            izq = { tipo: 'a', izq, der };
        }
        return izq;
    }

    function unario() {
        const t = items[i];
        if (t && t.tipo === '!') { i++; return { tipo: 'no', hijo: unario() }; }
        if (t && t.tipo === '(') {
            i++;
            const dentro = alternativa();
            if (!items[i] || items[i].tipo !== ')') error('missing closing )');
            i++;
            return dentro;
        }
        if (!t || t.tipo !== 'pred') error('expected expression');
        i++;
        return { tipo: 'pred', ...t };
    }

    const arbol = alternativa();
    if (i < items.length) error('expected expression');
    return arbol;
}

export default {
    name: 'find',
    alias: [],
    synopsis: 'find [PATH]... [EXPRESSION]',
    run(ctx, argv) {
        const args = argv.slice(1);
        const raices = [];
        let i = 0;
        while (i < args.length && !args[i].startsWith('-') && args[i] !== '(' && args[i] !== '!') {
            raices.push(args[i]);
            i++;
        }
        if (!raices.length) raices.push('.');

        const items = lexear(args.slice(i));
        const arbol = items.length ? analizar(items) : null;
        const ev = new EvaluadorFind(ctx, arbol);
        const salida = [];
        let code = 0;

        for (const raiz of raices) {
            const abs = normalizePath(ctx.cwd, raiz);
            if (!ctx.fs.exists(abs)) {
                ctx.stderr.write("find: ‘" + raiz + "’: No such file or directory\n");
                code = 1;
                continue;
            }
            ev.recorrer(ctx.fs.node(abs), abs, raiz, salida, 0);
        }

        for (const linea of salida) ctx.stdout.write(linea + '\n');
        return code;
    }
};

class EvaluadorFind {
    constructor(ctx, arbol) {
        this.ctx = ctx;
        this.arbol = arbol;
        this.salidas = [];
        this.hayBorrado = containsDelete(arbol);
        this.maxDepth = Number(buscarValor(arbol, '-maxdepth') ?? Infinity);
        this.minDepth = Number(buscarValor(arbol, '-mindepth') ?? 0);
        // Si la expresion ya trae -print, -ls, -print0 o -exec, esa accion es la
        // que imprime: GNU no imprime nada mas por su cuenta.
        this.accionImpresion = !!buscarAccion(arbol);
    }

    /** Recorrido en profundidad, en el orden de GNU. */
    recorrer(nodo, abs, mostrado, salida, profundidad) {
        if (!nodo) return;
        this.salidas = [];
        const cumple = this.arbol ? this.evaluar(this.arbol, nodo, abs, mostrado) : true;
        const podar = this.arbol && cumple && buscarNombre(this.arbol, '-prune') !== null;

        if (cumple && profundidad >= this.minDepth) {
            if (this.hayBorrado) {
                if (nodo.isDir) {
                    this.ctx.stderr.write("find: cannot delete '" + mostrado + "': Is a directory\n");
                } else {
                    try { this.ctx.fs.unlink(abs); } catch (e) {
                        this.ctx.stderr.write("find: cannot delete '" + mostrado + "': " + motivo(e) + '\n');
                    }
                }
            } else if (this.accionImpresion) {
                for (const linea of this.salidas) salida.push(linea);
            } else {
                salida.push(this.etiqueta(mostrado, nodo));
            }
        }
        if (podar) return;
        if (!nodo.isDir) return;
        if (profundidad + 1 > this.maxDepth) return;
        for (const hijo of [...nodo.list()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
            const hijoAbs = abs === '/' ? '/' + hijo.name : abs + '/' + hijo.name;
            const etiqueta = mostrado.endsWith('/') ? mostrado + hijo.name : mostrado + '/' + hijo.name;
            this.recorrer(hijo, hijoAbs, etiqueta, salida, profundidad + 1);
        }
    }

    /** Evalua la expresion; `-o` cortocircuita como en GNU. */
    evaluar(nodo, vfsNodo, abs, mostrado) {
        switch (nodo.tipo) {
            case 'o': return this.evaluar(nodo.izq, vfsNodo, abs, mostrado) || this.evaluar(nodo.der, vfsNodo, abs, mostrado);
            case 'a': return this.evaluar(nodo.izq, vfsNodo, abs, mostrado) && this.evaluar(nodo.der, vfsNodo, abs, mostrado);
            case 'no': return !this.evaluar(nodo.hijo, vfsNodo, abs, mostrado);
            default: return this.predicado(nodo, vfsNodo, abs, mostrado);
        }
    }

    predicado(nodo, vfsNodo, abs, mostrado) {
        const ctx = this.ctx;
        switch (nodo.nombre) {
            case '-name': case '-iname': case '-wholename': {
                // -name compara solo el nombre base; -wholename, la ruta entera.
                const base = nodo.nombre === '-wholename' ? abs : baseDe(mostrado);
                return casar(base, nodo.valor, nodo.nombre === '-iname');
            }
            case '-path': return casar(abs, nodo.valor, false);
            case '-ipath': return casar(abs, nodo.valor, true);
            case '-regex': {
                try { return compilarPatron(nodo.valor, { ere: true }).test(abs); }
                catch (e) { if (e instanceof RegexError) return error('invalid regex'); throw e; }
            }
            case '-type': {
                if (nodo.valor === 'f') return vfsNodo.type === 'file';
                if (nodo.valor === 'd') return vfsNodo.type === 'dir';
                if (nodo.valor === 'l') return vfsNodo.type === 'link';
                return error('unknown file type: ' + nodo.valor);
            }
            case '-empty': return vfsNodo.type === 'file' ? vfsNodo.content === '' : vfsNodo.list().length === 0;
            case '-size': return tamano(ctx.sizeOf(vfsNodo), nodo.valor);
            case '-mtime': return antiguedad(ctx.shell.now, vfsNodo.mtime, Number(nodo.valor), 86400);
            case '-atime': return antiguedad(ctx.shell.now, vfsNodo.mtime, Number(nodo.valor), 86400);
            case '-mmin': return antiguedad(ctx.shell.now, vfsNodo.mtime, Number(nodo.valor), 60);
            case '-amin': return antiguedad(ctx.shell.now, vfsNodo.mtime, Number(nodo.valor), 60);
            case '-perm': {
                if (nodo.valor.startsWith('-')) return (vfsNodo.mode & 0o7777) === Number(nodo.valor.slice(1));
                return (vfsNodo.mode & Number(nodo.valor)) !== 0;
            }
            case '-user': return String(vfsNodo.uid) === nodo.valor || usuarioDe(ctx, vfsNodo.uid) === nodo.valor;
            case '-group': return String(vfsNodo.gid) === nodo.valor;
            case '-newer': {
                const otro = ctx.fs.node(normalizePath(ctx.cwd, nodo.valor));
                return otro ? vfsNodo.mtime > otro.mtime : false;
            }
            case '-readable': return ctx.fs.canRead(vfsNodo, ctx.owner);
            case '-writable': return ctx.fs.canWrite(vfsNodo, ctx.owner);
            case '-executable': return ctx.fs.canExec(vfsNodo, ctx.owner);
            case '-true': return true;
            case '-false': return false;
            case '-maxdepth': case '-mindepth': return true;
            case '-prune': return true;
            case '-print': this.salidas.push(this.etiqueta(mostrado, vfsNodo)); return true;
            case '-print0': this.salidas.push(mostrado); return true;
            case '-ls':
                this.salidas.push([
                    vfsNodo.mtime, 0, abs, formatOctal(vfsNodo.mode),
                    ctx.fs.sizeOf(vfsNodo), this.etiqueta(mostrado, vfsNodo)
                ].join(' '));
                return true;
            case '-delete': return true;
            case '-exec': case '-execdir': {
                this.salidas.push(...this.ejecutar(nodo, abs));
                return true;
            }
            case '-ok': case '-okdir': return true;
            default: return error('unknown predicate ' + nodo.nombre);
        }
    }

    /** GNU imprime la ruta tal cual: los directorios no llevan barra final. */
    etiqueta(mostrado, vfsNodo) {
        return mostrado;
    }

    /** `{}` se sustituye por la ruta; `\;` ejecuta, `+` al final del todo. */
    ejecutar(nodo, abs) {
        const argvExec = nodo.comandos.map((c) => c.split('{}').join(abs));
        if (nodo.cierre === '+') {
            const r = this.ctx.shell.lanzarConArgumentos(argvExec, abs);
            return r && r.stdout ? r.stdout.split('\n').filter((l) => l.length) : [];
        }
        const r = this.ctx.shell.lanzar(argvExec);
        return r && r.stdout ? r.stdout.split('\n').filter((l) => l.length) : [];
    }
}

function ctx_stderr(ctx, texto) { ctx.stderr.write(texto); }

/** Ultimo componente de una ruta: lo que `-name` compara. */
function baseDe(ruta) {
    const partes = String(ruta).split('/').filter((p) => p.length);
    return partes[partes.length - 1] ?? '';
}

/** `casar` compara el nombre (o la ruta) con el patron completo. */
function casar(texto, patron, ignoraCase) {
    // A diferencia de grep, aqui `*` y `?` SI son comodines (find usa glob).
    const regex = new RegExp('^' + globAPatron(patron, { ruta: patron.includes('/') }) + '$',
        ignoraCase ? 'i' : '');
    return regex.test(texto);
}

/** `-size 0`, `-size +1k`: unidades de 512 bytes si no se indica otra. */
function tamano(bytes, valor) {
    const m = /^([-+]?)(\d+)([ckMGb]?)$/.exec(String(valor));
    if (!m) return error('invalid argument to -size: ' + valor);
    const unidades = { c: 1, k: 1024, M: 1048576, G: 1073741824, b: 512, '': 512 };
    const cuentas = Math.ceil(bytes / unidades[m[3]]);
    if (m[1] === '+') return cuentas > Number(m[2]);
    if (m[1] === '-') return cuentas < Number(m[2]);
    return cuentas === Number(m[2]);
}

/** GNU cuenta bloques hacia atras: `-mtime 0` es "hoy", `-mtime 1` es ayer. */
function antiguedad(ahora, mtime, n, paso) {
    return Math.floor((ahora - mtime) / paso) === n;
}

function usuarioDe(ctx, uid) {
    for (const [nombre, info] of Object.entries(ctx.shell.passwd ?? {})) {
        if (info.uid === uid) return nombre;
    }
    return null;
}

function containsDelete(arbol) {
    return buscarNombre(arbol, '-delete') !== null;
}

function buscarNombre(arbol, nombre) {
    if (!arbol) return null;
    if (arbol.tipo === 'pred') return arbol.nombre === nombre ? arbol : null;
    return buscarNombre(arbol.izq, nombre) ?? buscarNombre(arbol.der, nombre)
        ?? buscarNombre(arbol.hijo, nombre);
}

function buscarValor(arbol, nombre) {
    const nodo = buscarNombre(arbol, nombre);
    return nodo ? nodo.valor : null;
}

/** ¿La expresion trae alguna accion que ya imprime (-print, -ls, -exec...)? */
function buscarAccion(arbol) {
    return buscarNombre(arbol, '-print')
        ?? buscarNombre(arbol, '-print0')
        ?? buscarNombre(arbol, '-ls')
        ?? buscarNombre(arbol, '-exec')
        ?? buscarNombre(arbol, '-execdir');
}

/**
 * test / [ — evalua expresiones condicionales.
 *
 * Mensajes verificados con GNU coreutils 8.32:
 *   test: missing ]
 *   test: too many arguments
 *   test: unary operator expected
 *   test: unknown operator
 *   bash: [: missing `]'
 *
 * Los codigos de salida son los de test: 0 verdadera, 1 falsa, 2 error de uso.
 * Devolver 1 es lo que hace que `if [ -f x ]; then` decida.
 */

import { ShellError, EXIT_MISUSE } from '../errors.js';
import { normalizePath, parseMode } from '../fs.js';

const ERROR = 2;

/** Operadores unarios de una letra, los unicos validos con dos argumentos. */
const UNARIOS = new Set(['-n', '-z', '-e', '-f', '-d', '-h', '-L', '-s', '-r', '-w', '-x',
    '-b', '-c', '-p', '-S', '-g', '-u', '-k', '-G', '-O', '-N', '-t']);

/** Operadores binarios que test entiende. */
const BINARIOS = new Set(['=', '==', '!=', '-eq', '-ne', '-lt', '-le', '-gt', '-ge', '-nt', '-ot', '-ef']);

function uso(mensaje) {
    return new ShellError('test: ' + mensaje, EXIT_MISUSE);
}

export default {
    name: 'test',
    alias: ['['],
    synopsis: 'test [OPTION]... EXPRESSION',
    run(ctx, argv) {
        const esBracket = argv[0] === '[';
        let args = argv.slice(1);
        if (esBracket) {
            const ultimo = args[args.length - 1];
            if (ultimo !== ']') {
                throw new ShellError("[: missing `]'", EXIT_MISUSE);
            }
            args = args.slice(0, -1);
        }
        try {
            return evaluar(ctx, args) ? 0 : 1;
        } catch (e) {
            if (e instanceof ShellError) {
                if (e.code === EXIT_MISUSE) {
                    ctx.stderr.write((esBracket ? '[: ' : 'test: ') + e.message.replace(/^test: /, '') + '\n');
                    return ERROR;
                }
                throw e;
            }
            throw e;
        }
    }
};

/** Evalua la lista de argumentos como una expresion de `test`. */
function evaluar(ctx, args) {
    if (args.length === 0) return false;
    if (args.length === 1) return args[0] !== '';
    if (args.length === 2) {
        const [a, b] = args;
        if (a === '!') return b !== '';
        if (UNARIOS.has(a)) return unario(ctx, a, b);
        throw uso('too many arguments');
    }
    if (args.length === 3) {
        const [a, op, b] = args;
        if (op === '-a' || op === '-o') {
            const izq = a === '!' ? b !== '' : evaluar(ctx, [a]);
            const der = b === '!' ? args[2] !== '' : evaluar(ctx, [b]);
            return op === '-a' ? (izq && der) : (izq || der);
        }
        if (BINARIOS.has(op)) return binario(ctx, op, a, b);
        if (UNARIOS.has(op)) return unario(ctx, op, a);
        throw uso('unknown operator: ' + op);
    }

    // `( expr )`: los parentesis solo valen en la posicion de los extremos.
    if (args[0] === '(' && args[args.length - 1] === ')') {
        return evaluar(ctx, args.slice(1, -1));
    }
    if (args[0] === '!') return !evaluar(ctx, args.slice(1));
    if (args[args.length - 1] === ')') throw uso("unary operator expected");

    // `-a` y `-o` unen sin parentesis, y cortocircuitan.
    for (let i = 1; i < args.length - 1; i++) {
        if (args[i] === '-a' || args[i] === '-o') {
            const izq = evaluar(ctx, args.slice(0, i));
            const der = args[i] === '-a' ? (izq && evaluar(ctx, args.slice(i + 1))) : (izq || evaluar(ctx, args.slice(i + 1)));
            return der;
        }
    }
    throw uso('too many arguments');
}

function unario(ctx, op, a) {
    const abs = normalizePath(ctx.cwd, a);
    const nodo = ctx.fs.node(abs, { follow: op !== '-h' && op !== '-L' });
    switch (op) {
        case '-n': return a !== '';
        case '-z': return a === '';
        case '-e': return nodo !== null && nodo !== undefined;
        case '-f': return nodo?.type === 'file';
        case '-d': return nodo?.type === 'dir';
        case '-h': case '-L': return nodo?.type === 'link';
        case '-s': return nodo && ctx.fs.sizeOf(nodo) > 0;
        case '-r': return nodo ? ctx.fs.canRead(nodo, ctx.owner) : false;
        case '-w': return nodo ? ctx.fs.canWrite(nodo, ctx.owner) : false;
        case '-x': return nodo ? ctx.fs.canExec(nodo, ctx.owner) : false;
        case '-b': case '-c': case '-p': case '-S': return false;
        default: throw uso('unknown operator: ' + op);
    }
}

function binario(ctx, op, a, b) {
    if (op === '=' || op === '==') return a === b;
    if (op === '!=') return a !== b;
    if (op === '-nt' || op === '-ot' || op === '-ef') {
        const na = ctx.fs.node(normalizePath(ctx.cwd, a));
        const nb = ctx.fs.node(normalizePath(ctx.cwd, b));
        if (op === '-ef') return na && nb && na === nb;
        if (!na) return false;
        if (!nb) return op === '-nt';
        return op === '-nt' ? na.mtime > nb.mtime : na.mtime < nb.mtime;
    }
    const x = Number(a);
    const y = Number(b);
    if (Number.isNaN(x) || Number.isNaN(y)) throw uso('integer expression expected');
    switch (op) {
        case '-eq': return x === y;
        case '-ne': return x !== y;
        case '-lt': return x < y;
        case '-le': return x <= y;
        case '-gt': return x > y;
        default: return x >= y;
    }
}

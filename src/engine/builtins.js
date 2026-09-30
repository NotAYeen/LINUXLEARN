/**
 * Builtins del shell: los que no son ficheros del sistema de ficheros.
 *
 * Todos siguen el mismo contrato que los coreutils pero con una diferencia
 * importante: pueden modificar el estado de la sesion (variables, cwd, funciones,
 * `set -e`, `trap`) y unos pocos cortan la ejecucion lanzando `ExitSignal` o
 * `ReturnSignal`, que `shell.js` recoge.
 *
 * Los mensajes son los de bash 5.3, en ingles y con su prefijo `bash: line N:`
 * (el prefijo lo pone el shell, aqui solo el texto).
 */

import {
    ShellError, ExitSignal, InterruptSignal, EXIT_ERROR, EXIT_MISUSE, EXIT_NOT_FOUND
} from './errors.js';
import { normalizePath, dirnameOf } from './fs.js';
import { evaluarEntero } from './arith.js';
import { partir } from './coreutils/io.js';

/** `return` dentro de una funcion: la recoge el ejecutor de funciones. */
export class ReturnSignal extends Error {
    constructor(code = 0) {
        super('return ' + code);
        this.name = 'ReturnSignal';
        this.code = code;
    }
}

/** Error de uso de un builtin: el shell lo imprime con su prefijo. */
function uso(mensaje) {
    return new ShellError(mensaje, EXIT_MISUSE);
}

/** Nombre de las opciones de `cd` que se comen como argumento. */
function opcionesCd(argv) {
    const opts = { logico: true, verbose: false, fisico: false };
    const resto = [];
    for (const a of argv) {
        if (a === '-L' || a === '--logical') opts.logico = true;
        else if (a === '-P' || a === '--physical') opts.fisico = true;
        else if (a === '-e' || a === '--' ) opts.logico = true;
        else if (a === '-') resto.push(a);
        else if (a.startsWith('-') && a.length > 1) uso("cd: " + a + ": invalid option");
        else resto.push(a);
    }
    return { opts, resto };
}

const builtinCd = {
    name: 'cd',
    synopsis: 'cd [DIRECTORIO]',
    run(ctx, argv) {
        const { opts, resto } = opcionesCd(argv.slice(1));
        if (resto.length > 1) uso('cd: too many arguments');
        const destino = resto[0] ?? (opts.logico ? ctx.env.HOME ?? ctx.shell.home : ctx.shell.home);
        const abs = normalizePath(ctx.cwd, destino);
        const nodo = ctx.fs.node(abs);
        if (!nodo) {
            ctx.stderr.write('bash: cd: ' + destino + ": No such file or directory\n");
            ctx.shell.estado = 1;
            return 1;
        }
        if (!nodo.isDir) {
            ctx.stderr.write('bash: cd: ' + destino + ": Not a directory\n");
            ctx.shell.estado = 1;
            return 1;
        }
        if (!ctx.fs.canRead(nodo, ctx.owner)) {
            ctx.stderr.write('bash: cd: ' + destino + ": Permission denied\n");
            ctx.shell.estado = 1;
            return 1;
        }
        const logico = opts.logico && !opts.fisico;
        ctx.shell.cambiarCwd(logico ? abs : ctx.fs.realpath(abs));
        if (opts.verbose) ctx.stdout.write(destino + '\n');
        ctx.shell.estado = 0;
        return 0;
    }
};

const pwdBuiltin = {
    name: 'pwd',
    synopsis: 'pwd [-LP]',
    run(ctx, argv) {
        const fisico = argv.includes('-P') || argv.includes('--physical');
        ctx.stdout.write((fisico ? ctx.shell.pwdFisico() : ctx.cwd) + '\n');
        return 0;
    }
};

const exit = {
    name: 'exit',
    synopsis: 'exit [N]',
    run(ctx, argv) {
        const n = argv[0];
        if (n === undefined) throw new ExitSignal(ctx.shell.estado);
        if (!/^-?\d+$/.test(n)) uso('exit: ' + n + ': numeric argument required');
        throw new ExitSignal(Number(n) & 0xff);
    }
};

const exportBuiltin = {
    name: 'export',
    synopsis: 'export [-p] [NAME[=VALOR]...]',
    run(ctx, argv) {
        const args = argv.slice(1);
        if (!args.length || args[0] === '-p') {
            for (const [nombre, v] of ctx.shell.vars) {
                if (v.exportado) ctx.stdout.write('declare -x ' + nombre + '="' + v.valor + '"\n');
            }
            return 0;
        }
        for (const a of args) {
            if (a.startsWith('-')) continue;
            const eq = a.indexOf('=');
            if (eq === -1) {
                const actual = ctx.shell.vars.get(a);
                if (actual) actual.exportado = true;
                else ctx.shell.vars.set(a, { valor: '', exportado: true });
            } else {
                ctx.shell.definir(a.slice(0, eq), a.slice(eq + 1), true);
            }
        }
        return 0;
    }
};

const unset = {
    name: 'unset',
    synopsis: 'unset [-fv] NAME...',
    run(ctx, argv) {
        const funciones = argv.includes('-f');
        for (const a of argv.slice(1)) {
            if (a.startsWith('-')) continue;
            if (funciones) ctx.shell.funciones.delete(a);
            else ctx.shell.vars.delete(a);
        }
        return 0;
    }
};

const set = {
    name: 'set',
    synopsis: 'set [-euo pipefail] [ARG]...',
    run(ctx, argv) {
        const args = argv.slice(1);
        if (!args.length) {
            for (const [nombre, v] of ctx.shell.vars) {
                if (v.exportado) ctx.stdout.write(nombre + '=' + v.valor + '\n');
            }
            return 0;
        }
        for (const a of args) {
            if (a === '--') { ctx.shell.posicionales = []; continue; }
            if (!a.startsWith('-') || a === '-') { ctx.shell.posicionales = args.slice(args.indexOf(a)); return 0; }
            const opciones = a.slice(1);
            for (const letra of opciones) {
                if (letra === 'e') ctx.shell.opciones.e = true;
                else if (letra === 'u') ctx.shell.opciones.u = true;
                else if (letra === 'o') continue;
                else uso('set: ' + a + ': invalid option');
            }
            if (opciones.includes('o')) {
                const valor = args[argv.indexOf(a) + 1];
                if (valor === 'pipefail') ctx.shell.opciones.pipefail = true;
                else if (valor === 'nounset') ctx.shell.opciones.u = true;
                else if (valor === 'errexit') ctx.shell.opciones.e = true;
                else uso('set: -o: invalid option name');
            }
        }
        return 0;
    }
};

const source = {
    name: 'source',
    alias: ['.'],
    synopsis: 'source FICHERO [ARG]...',
    run(ctx, argv) {
        const guion = argv[0];
        if (!guion) uso('source: filename argument required');
        const abs = normalizePath(ctx.cwd, guion);
        let nodo = null;
        try {
            nodo = ctx.fs.node(abs);
        } catch (e) {
            ctx.stderr.write('bash: ' + guion + ': ' + motivoDe(e) + '\n');
            ctx.shell.estado = 1;
            return 1;
        }
        if (!nodo) {
            ctx.stderr.write('bash: ' + guion + ': No such file or directory\n');
            ctx.shell.estado = 1;
            return 1;
        }
        if (nodo.isDir) {
            ctx.stderr.write('bash: ' + guion + ': Is a directory\n');
            ctx.shell.estado = 1;
            return 1;
        }
        ctx.shell.fuente(nodo.content, argv.slice(1));
        return ctx.shell.estado;
    }
};

const alias = {
    name: 'alias',
    synopsis: 'alias [NAME[=VALOR]...]',
    run(ctx, argv) {
        const args = argv.slice(1);
        if (!args.length) {
            for (const [nombre, valor] of ctx.shell.alias) ctx.stdout.write("alias " + nombre + "='" + valor + "'\n");
            return 0;
        }
        for (const a of args) {
            const eq = a.indexOf('=');
            if (eq === -1) {
                const valor = ctx.shell.alias.get(a);
                if (valor === undefined) {
                    ctx.stderr.write('bash: alias: ' + a + ': not found\n');
                    ctx.shell.estado = 1;
                    return 1;
                }
                ctx.stdout.write("alias " + a + "='" + valor + "'\n");
                continue;
            }
            ctx.shell.alias.set(a.slice(0, eq), a.slice(eq + 1));
        }
        return 0;
    }
};

const unalias = {
    name: 'unalias',
    synopsis: 'unalias [-a] NAME...',
    run(ctx, argv) {
        const args = argv.slice(1);
        if (args.includes('-a')) { ctx.shell.alias.clear(); return 0; }
        for (const a of args) {
            if (!ctx.shell.alias.has(a)) {
                ctx.stderr.write('bash: unalias: ' + a + ': not found\n');
                return 1;
            }
            ctx.shell.alias.delete(a);
        }
        return 0;
    }
};

const read = {
    name: 'read',
    synopsis: 'read [-r] [-d DELIM] [-p TEXTO] [-t N] [NAME...]',
    run(ctx, argv) {
        const args = argv.slice(1);
        const opts = { raw: false, delim: '\n', prompt: null, nombres: [] };
        for (let i = 0; i < args.length; i++) {
            const a = args[i];
            if (a === '-r') opts.raw = true;
            else if (a === '-d') opts.delim = args[++i] ?? '\0';
            else if (a === '-p') opts.prompt = args[++i] ?? '';
            else if (a === '-s') continue;
            else if (a.startsWith('-') && a.length > 1) uso('read: ' + a + ': invalid option');
            else opts.nombres.push(a);
        }
        if (opts.prompt) ctx.stderr.write(opts.prompt);
        // `read` consume del flujo de entrada compartido: asi
        // `while read l; do ...; done < fichero` lee linea a linea. Sin flujo
        // compartido (echo uno | read l) lee de `stdin` una sola vez.
        const flujo = ctx.flujoEntrada;
        let disponible = flujo ? flujo.texto : (ctx.stdin ?? '');
        if (disponible === '') {
            ctx.shell.estado = 1;
            return 1;
        }
        const corte = disponible.indexOf(opts.delim);
        const entrada = corte === -1 ? disponible : disponible.slice(0, corte);
        const campos = entrada.split(/[ \t]+/).filter((c) => c.length);
        if (!opts.nombres.length) opts.nombres = ['REPLY'];
        if (opts.nombres.length === 1) {
            // bash quita la proteccion inicial salvo con -r.
            ctx.shell.definir(opts.nombres[0], opts.raw ? entrada : entrada.replace(/^\s+/, ''), false);
        } else {
            opts.nombres.forEach((nombre, i) => {
                ctx.shell.definir(nombre, i === opts.nombres.length - 1 ? campos.slice(i).join(' ') : (campos[i] ?? ''), false);
            });
        }
        if (flujo) flujo.texto = corte === -1 ? '' : disponible.slice(corte + opts.delim.length);
        ctx.shell.estado = 1;
        return 0;
    }
};

const shiftBuiltin = {
    name: 'shift',
    synopsis: 'shift [N]',
    run(ctx, argv) {
        const n = argv[0] === undefined ? 1 : Number(argv[0]);
        if (Number.isNaN(n)) uso('shift: ' + argv[0] + ': numeric argument required');
        if (n > ctx.shell.posicionales.length) return 1;
        ctx.shell.posicionales = ctx.shell.posicionales.slice(n);
        return 0;
    }
};

const returnBuiltin = {
    name: 'return',
    synopsis: 'return [N]',
    run(ctx, argv) {
        const n = argv[0];
        if (n !== undefined && !/^-?\d+$/.test(n)) uso('return: ' + n + ': numeric argument required');
        throw new ReturnSignal(n === undefined ? ctx.shell.estado : Number(n) & 0xff);
    }
};

const breakBuiltin = {
    name: 'break',
    synopsis: 'break [N]',
    run(ctx, argv) {
        const n = argv[0] === undefined ? 1 : Number(argv[0]);
        ctx.shell.romper = Math.max(1, n);
        return 0;
    }
};

const continueBuiltin = {
    name: 'continue',
    synopsis: 'continue [N]',
    run(ctx, argv) {
        const n = argv[0] === undefined ? 1 : Number(argv[0]);
        ctx.shell.continuar = Math.max(1, n);
        return 0;
    }
};

const evalBuiltin = {
    name: 'eval',
    synopsis: 'eval [ARG]...',
    run(ctx, argv) {
        if (!argv.length) return 0;
        const r = ctx.shell.ejecutarEnContexto(argv.join(' '), { nuevoAlcance: false });
        return r ? r.code : 0;
    }
};

const execBuiltin = {
    name: 'exec',
    synopsis: 'exec [COMANDO [ARG]...]',
    run(ctx, argv) {
        if (!argv.length) return 0;
        const r = ctx.shell.lanzar(argv);
        throw new ExitSignal(r ? r.code : 0);
    }
};

const trapBuiltin = {
    name: 'trap',
    synopsis: "trap [ACCION [SEÑAL]...]",
    run(ctx, argv) {
        const args = argv.slice(1);
        if (!args.length) {
            for (const [senal, accion] of ctx.shell.traps) {
                ctx.stdout.write('trap -- ' + (accion === '' ? "''" : "'" + accion + "'") + ' ' + senal + '\n');
            }
            return 0;
        }
        const accion = args[0];
        if (accion === '-' || accion === '--') {
            if (args.length === 1) ctx.shell.traps.clear();
            else for (const senal of args.slice(1)) ctx.shell.traps.delete(senal);
            return 0;
        }
        if (args.length === 1) {
            ctx.shell.traps.set('EXIT', accion === '' ? null : accion);
            return 0;
        }
        for (const senal of args.slice(1)) ctx.shell.traps.set(nombreSenal(senal), accion === '' ? null : accion);
        return 0;
    }
};

const typeBuiltin = {
    name: 'type',
    synopsis: 'type NAME...',
    run(ctx, argv) {
        if (!argv.length) uso('type: no se especifico ningun argumento');
        let code = 0;
        for (const nombre of argv) {
            const builtin = buscarBuiltin(nombre);
            if (builtin) { ctx.stdout.write(nombre + ' is a shell builtin\n'); continue; }
            if (ctx.shell.funciones.has(nombre)) { ctx.stdout.write(nombre + ' is a function\n'); continue; }
            if (ctx.shell.alias.has(nombre)) { ctx.stdout.write(nombre + ' is aliased to `' + ctx.shell.alias.get(nombre) + "'\n"); continue; }
            if (ctx.shell.comandoExterno(nombre)) { ctx.stdout.write(nombre + ' is ' + nombre + '\n'); continue; }
            ctx.stderr.write('bash: type: ' + nombre + ': not found\n');
            code = 1;
        }
        return code;
    }
};

const commandBuiltin = {
    name: 'command',
    synopsis: 'command [-p] NAME [ARG]...',
    run(ctx, argv) {
        const args = argv.slice(1).filter((a) => a !== '-p' && a !== '-v' && a !== '-V');
        if (!args.length) return 0;
        const r = ctx.shell.lanzar(args);
        if (!r) {
            ctx.stderr.write('bash: ' + args[0] + ': ' + args[0] + ': command not found\n');
            return EXIT_NOT_FOUND;
        }
        return r.code;
    }
};

const letBuiltin = {
    name: 'let',
    synopsis: 'let EXPR...',
    run(ctx, argv) {
        if (!argv.length) uso('let: expression expected');
        for (const expr of argv) {
            ctx.shell.definir('?', String(evaluarEntero(expr, (n) => ctx.shell.leer(n))), false);
        }
        return Number(ctx.shell.leer('?')) === 0 ? 1 : 0;
    }
};

const umaskBuiltin = {
    name: 'umask',
    synopsis: 'umask [-S] [MODO]',
    run(ctx, argv) {
        if (argv.length === 0) {
            const m = (~ctx.shell.umask) & 0o777;
            const simbolico = [
                (m & 0o400) ? 'r' : '-', (m & 0o200) ? 'w' : '-', (m & 0o100) ? 'x' : '-',
                (m & 0o040) ? 'r' : '-', (m & 0o020) ? 'w' : '-', (m & 0o010) ? 'x' : '-',
                (m & 0o004) ? 'r' : '-', (m & 0o002) ? 'w' : '-', (m & 0o001) ? 'x' : '-'
            ].join('');
            ctx.stdout.write((argv[0] === '-S' ? simbolico : '0' + (m & 0o777).toString(8).padStart(3, '0')) + '\n');
            return 0;
        }
        const modo = argv[argv.length - 1];
        ctx.shell.umask = parseInt(modo, 8) & 0o777;
        return 0;
    }
};

const localBuiltin = {
    name: 'local',
    synopsis: 'local [NAME[=VALOR]...]',
    run(ctx, argv) {
        for (const a of argv.slice(1)) {
            const eq = a.indexOf('=');
            if (eq === -1) ctx.shell.declararLocal(a);
            else ctx.shell.definirLocal(a.slice(0, eq), a.slice(eq + 1));
        }
        return 0;
    }
};

const colon = {
    name: ':',
    synopsis: ': [ARG]...',
    run() { return 0; }
};

const history = {
    name: 'history',
    synopsis: 'history',
    run(ctx) {
        ctx.shell.historial.forEach((linea, i) => ctx.stdout.write(String(i + 1).padStart(5) + '  ' + linea + '\n'));
        return 0;
    }
};

/**
 * Tabla de builtins por nombre. El ejecutor la consulta antes que el registro.
 * `echo`, `printf` y `test` no estan aqui: su comportamiento de orden coincide
 * con el del coreutils, asi que los resuelve el registro.
 */
export const BUILTINS = new Map();
for (const b of [alias, breakBuiltin, builtinCd, colon, commandBuiltin, continueBuiltin, evalBuiltin,
    execBuiltin, exit, exportBuiltin, history, letBuiltin, localBuiltin, pwdBuiltin, read,
    returnBuiltin, set, shiftBuiltin, source, trapBuiltin, typeBuiltin, umaskBuiltin,
    unalias, unset]) {
    BUILTINS.set(b.name, b);
    for (const alias of b.alias ?? []) BUILTINS.set(alias, b);
}

export function buscarBuiltin(nombre) {
    return BUILTINS.get(nombre) ?? null;
}

function motivoDe(e) {
    const s = String(e.message ?? e);
    const i = s.indexOf(': ');
    return i >= 0 ? s.slice(i + 2) : s;
}

/** `trap` usa nombres como INT, TERM, EXIT... */
function nombreSenal(s) {
    const mapa = { '0': 'EXIT', '1': 'SIGHUP', '2': 'SIGINT', '3': 'SIGQUIT', '9': 'SIGKILL', '15': 'SIGTERM' };
    if (mapa[s]) return mapa[s];
    if (s === 'EXIT' || s.startsWith('SIG')) return s;
    return 'SIG' + s;
}

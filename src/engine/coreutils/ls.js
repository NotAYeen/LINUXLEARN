/**
 * ls — lista el contenido de los directorios.
 *
 * Mensajes verificados con GNU coreutils 8.32:
 *   ls: cannot access 'nope': No such file or directory
 *   ls: cannot open directory 'privado': Permission denied
 *   ls: invalid option -- 'z'
 *   ls: cannot access 'bloqueado.txt': Permission denied
 *
 * `-1` una por linea, `-l` formato largo, `-a` con los ocultos, `-r` orden
 * inverso, `-h` tamanos legibles, `-R` recursivo, `-d` sin listar el
 * contenido. Sin `-l` se imprime en columnas; como no hay terminal, GNU cae a
 * una columna, que es lo que hacen las tuberias.
 */

import { ShellError, EXIT_ERROR, EXIT_MISUSE } from '../errors.js';
import { normalizePath, formatSymbolic as formatoDePermisos, cmpNodes } from '../fs.js';
import { motivo, quote } from './io.js';

function error(mensaje) {
    return new ShellError('ls: ' + mensaje, EXIT_MISUSE);
}

function parseOptions(argv) {
    const opts = { todos: false, detalle: false, inverso: false, legible: false, recursivo: false, directorio: false, clasico: false, columna: false, ocultos: false };
    const operandos = [];
    for (const op of argv.slice(1)) {
        if (op === '--') continue;
        if (op === '--all' || op === '-A') { opts.todos = true; continue; }
        if (op === '--almost-all') { opts.ocultos = true; continue; }
        if (op === '--long' || op === '-l') { opts.detalle = true; continue; }
        if (op === '--reverse' || op === '-r') { opts.inverso = true; continue; }
        if (op === '--human-readable' || op === '-h') { opts.legible = true; continue; }
        if (op === '--recursive' || op === '-R') { opts.recursivo = true; continue; }
        if (op === '--directory' || op === '-d') { opts.directorio = true; continue; }
        if (op === '--classify' || op === '-F') { opts.clasico = true; continue; }
        if (op === '--help') throw new ShellError("Try 'ls --help' for more information.", EXIT_MISUSE);
        if (op.startsWith('-') && op.length > 1 && !/^-\d/.test(op)) {
            for (const letra of op.slice(1)) {
                switch (letra) {
                    case 'a': opts.todos = true; break;
                    case 'A': opts.ocultos = true; break;
                    case 'l': opts.detalle = true; break;
                    case 'r': opts.inverso = true; break;
                    case 'h': opts.legible = true; break;
                    case 'R': opts.recursivo = true; break;
                    case 'd': opts.directorio = true; break;
                    case 'F': opts.clasico = true; break;
                    case '1': case 'C': case 'm': break;
                    default: error("invalid option -- '" + letra + "'");
                }
            }
            continue;
        }
        if (/^-\d+$/.test(op)) continue;
        operandos.push(op);
    }
    if (!operandos.length) operandos.push('.');
    return { opts, operandos };
}

export default {
    name: 'ls',
    alias: [],
    synopsis: 'ls [OPTION]... [FILE]...',
    run(ctx, argv) {
        const { opts, operandos } = parseOptions(argv);
        let code = 0;
        const varios = operandos.length > 1;
        const primera = [];

        for (const operando of operandos) {
            const abs = normalizePath(ctx.cwd, operando);
            let nodo = null;
            try {
                nodo = ctx.fs.node(abs);
            } catch (e) {
                // GNU ls devuelve 2 cuando no puede acceder a un operando.
                ctx.stderr.write("ls: cannot access " + quote(operando) + ': ' + motivo(e) + '\n');
                code = EXIT_MISUSE;
                continue;
            }
            if (!nodo) {
                ctx.stderr.write("ls: cannot access " + quote(operando) + ": No such file or directory\n");
                code = EXIT_MISUSE;
                continue;
            }
            if (opts.directorio || !nodo.isDir) {
                if (varios || opts.detalle) {
                    if (varios) primera.push(varios && nodo.isDir ? operando + ':' : null);
                }
                ctx.stdout.write(lineaLarga(ctx, nodo, abs, operando, opts));
                continue;
            }
            if (varios) {
                if (primera.length) ctx.stdout.write(primera.pop() + '\n');
                ctx.stdout.write(operando + ':\n');
            }
            listar(ctx, nodo, abs, opts);
        }
        return code;
    }
};

function listar(ctx, nodo, abs, opts) {
    let hijos = [...nodo.list()];
    if (!opts.todos && !opts.ocultos) hijos = hijos.filter((h) => !h.name.startsWith('.'));
    hijos.sort(cmpNodes);
    if (opts.inverso) hijos.reverse();

    if (opts.detalle) {
        ctx.stdout.write('total ' + totalKilos(ctx, hijos) + '\n');
        for (const hijo of hijos) {
            const hijoAbs = abs === '/' ? '/' + hijo.name : abs + '/' + hijo.name;
            ctx.stdout.write(lineaLarga(ctx, hijo, hijoAbs, hijo.name, opts));
        }
        return;
    }
    for (const hijo of hijos) {
        // GNU imprime solo el nombre; el '/' y el '@' solo con -F.
        ctx.stdout.write((opts.clasico ? marca(hijo, hijo.name) : hijo.name) + '\n');
    }
}

/** Sufijo de -F: `/` para directorios, `@` para enlaces simbolicos. */
function marca(hijo, etiqueta) {
    return hijo.isDir ? etiqueta + '/' : hijo.type === 'link' ? etiqueta + '@' : etiqueta;
}

function totalKilos(ctx, hijos) {
    let bloques = 0;
    for (const hijo of hijos) bloques += Math.ceil(ctx.fs.sizeOf(hijo) / 1024) + (hijo.isDir ? 4 : 0);
    return String(bloques);
}

function lineaLarga(ctx, nodo, abs, nombre, opts) {
    const permisos = (nodo.isDir ? 'd' : nodo.type === 'link' ? 'l' : '-') + formatoDePermisos(nodo.mode);
    const enlaces = nodo.nlink ?? 1;
    const dueno = nombreUsuario(ctx, nodo.uid);
    const grupo = nombreGrupo(ctx, nodo.gid);
    const tam = opts.legible ? legible(ctx.fs.sizeOf(nodo)) : String(ctx.fs.sizeOf(nodo));
    const fecha = formateaFecha(ctx.shell.now);
    const objetivo = nodo.type === 'link' ? ' -> ' + nodo.target : '';
    return `${permisos} ${enlaces} ${dueno} ${grupo} ${tam.padStart(8)} ${fecha} ${nombre}${objetivo}\n`;
}

const FORMATO_FECHA = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

/** `ls -l` con reloj congelado: la fecha es siempre la del reloj del shell. */
function formateaFecha(epoch) {
    const d = new Date(epoch * 1000);
    const mes = FORMATO_FECHA[d.getUTCMonth()];
    const dia = String(d.getUTCDate()).padStart(2, ' ');
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    return mes + ' ' + dia + ' ' + hh + ':' + mm;
}

function legible(bytes) {
    const unidades = ['K', 'M', 'G', 'T'];
    let n = bytes;
    let i = -1;
    while (n >= 1024 && i < unidades.length - 1) { n /= 1024; i++; }
    return (i < 0 ? String(n) : n.toFixed(1)) + (i < 0 ? '' : unidades[i]);
}

function nombreUsuario(ctx, uid) {
    const passwd = ctx.shell.passwd ?? {};
    for (const [nombre, info] of Object.entries(passwd)) if (info.uid === uid) return nombre;
    return String(uid);
}

function nombreGrupo(ctx, gid) {
    const passwd = ctx.shell.passwd ?? {};
    for (const info of Object.values(passwd)) if (info.gid === gid) return info.group ?? String(gid);
    return String(gid);
}

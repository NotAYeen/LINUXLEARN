/**
 * stat — imprime el estado de un fichero.
 *
 * El formato por defecto esta copiado letra a letra del de GNU coreutils 8.32
 * (`default_format()` de src/stat.c), verificado con `stat | cat -A` contra el
 * bash real:
 *
 *   File: nombre
 *   Size: 3         \tBlocks: 1          IO Block: 65536  regular file
 * Device: 20853a81h/545602177d\tInode: 5066549581895882  Links: 1
 * Access: (0644/-rw-r--r--)  Uid: (197609/    Kite)   Gid: (197121/ UNKNOWN)
 * Access: 2026-02-01 12:00:00.000000000 +0000
 * ...
 *  Birth: 2026-02-01 12:00:00.000000000 +0000
 *
 * Desvios conscientes:
 *  - El VFS no guarda inodes: se usa un hash FNV-1a de 13 cifras, siempre sin
 *    rellenar, para que dos rutas distintas no compartan numero.
 *  - `IO Block` vale 4096 y `Blocks` vale `ceil(size/512)`, que es lo que da
 *    Linux; el bash de Git en Windows pone 65536 y 1024.
 *  - No hay marcas de tiempo distintas: `Access`, `Modify`, `Change` y
 *    ` Birth` salen todas con el `mtime`, y el reloj esta congelado.
 *  - Sin `-f` (sistema de ficheros), `-t` (terse), `--cached` ni SELinux.
 */

import { ShellError, EXIT_ERROR } from '../errors.js';
import { normalizePath, formatSymbolic, DIR, LINK } from '../fs.js';

const BLKSIZE = 4096;
const DEV_DECIMAL = 128;

/** Error de uso con la ayuda corta, tal y como la imprime GNU. */
function usageError(message) {
    return new ShellError(message + "\nTry 'stat --help' for more information.", EXIT_ERROR);
}

/** Comilla simple al estilo de GNU `quote()` con estilo shell-always. */
function quote(text) {
    return "'" + String(text).replace(/'/g, "'\\''") + "'";
}

/** Desempaqueta las opciones. `-c` admite valor pegado. */
function parseOptions(argv) {
    const opts = { format: null, dereference: false, operands: [] };
    for (let i = 1; i < argv.length; i++) {
        const op = argv[i];
        if (op === '--format') {
            if (i + 1 >= argv.length) throw usageError('stat: option requires an argument -- c');
            opts.format = argv[++i];
            continue;
        }
        if (op.startsWith('--format=')) { opts.format = op.slice('--format='.length); continue; }
        if (op === '--dereference') { opts.dereference = true; continue; }
        if (op.startsWith('--')) throw usageError('stat: unknown option -- ' + op.slice(2));
        if (op.length > 1 && op[0] === '-') {
            const flags = op.slice(1);
            for (let j = 0; j < flags.length; j++) {
                const flag = flags[j];
                if (flag === 'L') { opts.dereference = true; continue; }
                if (flag === 'c') {
                    const rest = flags.slice(j + 1);
                    if (rest) opts.format = rest;
                    else if (i + 1 < argv.length) opts.format = argv[++i];
                    else throw usageError('stat: option requires an argument -- c');
                    break;
                }
                throw usageError('stat: unknown option -- ' + flag);
            }
            continue;
        }
        opts.operands.push(op);
    }
    return opts;
}

/** 1769947200 -> '2026-02-01 12:00:00.000000000 +0000' */
function formatTime(seconds) {
    const d = new Date(seconds * 1000);
    const p = (n, w) => String(n).padStart(w, '0');
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1, 2)}-${p(d.getUTCDate(), 2)} ` +
        `${p(d.getUTCHours(), 2)}:${p(d.getUTCMinutes(), 2)}:${p(d.getUTCSeconds(), 2)}.000000000 +0000`;
}

/** Hash FNV-1a de 13 cifras: identidad estable de un nodo sin inode real. */
function pseudoInode(path) {
    let h = 1469598103934665603;
    for (let i = 0; i < path.length; i++) {
        h ^= path.charCodeAt(i);
        h = Math.imul(h, 1099511628211) >>> 0;
    }
    return 1000000000000 + (h % 8999999999999);
}

/** Tipo de fichero con la convencion de GNU `file_type()`. */
function typeOf(node) {
    if (node.isLink) return 'symbolic link';
    if (node.isDir) return 'directory';
    return node.content.length === 0 ? 'regular empty file' : 'regular file';
}

/** Letra inicial del modo: -, d o l. */
function typeChar(node) {
    if (node.isLink) return LINK[0];
    if (node.isDir) return DIR[0];
    return '-';
}

/** Nombre de usuario o `UNKNOWN`, como hace getpwuid(). */
function userOf(info, uid) {
    const passwd = (info.ctx.shell.passwd) || {};
    for (const name of Object.keys(passwd)) {
        if (passwd[name].uid === uid) return name;
    }
    return 'UNKNOWN';
}

/** Nombre de grupo o `UNKNOWN`, como hace getgrgid(). */
function groupOf(info, gid) {
    if (gid === 0) return 'root';
    const passwd = (info.ctx.shell.passwd) || {};
    for (const name of Object.keys(passwd)) {
        if (passwd[name].gid === gid) return name;
    }
    return 'UNKNOWN';
}

/** Coleta los datos de un fichero listos para imprimir. */
function collect(ctx, abs, operand, dereference) {
    const node = ctx.fs.node(abs, { follow: dereference });
    if (!node) return null;
    const isLink = !dereference && node.isLink;
    const mode = node.mode & 0o7777;
    const size = node.isDir ? countSize(ctx, abs, node) : (node.isLink ? node.target.length : node.content.length);
    const nlink = node.isDir ? 2 + node.list().length : 1;
    return {
        ctx,
        name: operand,
        node,
        size,
        blocks: size === 0 ? 0 : Math.ceil(size / 512),
        mode,
        type: typeOf(node),
        typeChar: typeChar(node),
        sym: typeChar(node) + formatSymbolic(mode),
        nlink,
        uid: node.uid,
        gid: node.gid,
        mtime: node.mtime,
        inode: pseudoInode(abs)
    };
}

/** Tamano de un directorio: 4096 por entrada, como en el VFS. */
function countSize(ctx, abs, node) {
    return 4096 * node.list().length;
}

/** Formato por defecto de GNU. */
function renderDefault(info) {
    const nlink = String(info.nlink);
    return '  File: ' + info.name + '\n' +
        '  Size: ' + String(info.size).padEnd(10) +
        '\tBlocks: ' + String(info.blocks).padEnd(10) +
        ' IO Block: ' + String(BLKSIZE).padEnd(6) + ' ' + info.type + '\n' +
        'Device: ' + DEV_DECIMAL.toString(16) + 'h/' + DEV_DECIMAL + 'd' +
        '\tInode: ' + String(info.inode).padEnd(10) + '  Links: ' + nlink + '\n' +
        'Access: (' + (info.mode & 0o7777).toString(8).padStart(4, '0') + '/' + info.sym + ')' +
        '  Uid: (' + String(info.uid).padStart(5) + '/' + userOf(info, info.uid).padStart(8) + ')' +
        '   Gid: (' + String(info.gid).padStart(5) + '/' + groupOf(info, info.gid).padStart(8) + ')\n' +
        'Access: ' + formatTime(info.mtime) + '\n' +
        'Modify: ' + formatTime(info.mtime) + '\n' +
        'Change: ' + formatTime(info.mtime) + '\n' +
        ' Birth: ' + formatTime(info.mtime) + '\n';
}

/** Aplica ancho y relleno a un valor ya convertido a cadena. */
function pad(value, flags, width, precision) {
    let text = String(value);
    if (precision != null && precision < text.length) text = text.slice(0, precision);
    if (width == null || text.length >= width) return text;
    const fill = flags.includes('0') ? '0' : ' ';
    if (flags.includes('-')) return text + fill.repeat(width - text.length);
    return fill.repeat(width - text.length) + text;
}

/** Traduce un `%X` de formato al valor correspondiente. */
function directive(info, char) {
    switch (char) {
        case 'n': return info.name;
        case 'N': return info.node.isLink
            ? quote(info.name) + ' -> ' + quote(info.node.target)
            : quote(info.name);
        case 's': return info.size;
        case 'b': return info.blocks;
        case 'B': return 512;
        case 'f': return (FILE_MODE_TYPE | info.mode).toString(16);
        case 'F': return info.type;
        case 'u': return info.uid;
        case 'U': return userOf(info, info.uid);
        case 'g': return info.gid;
        case 'G': return groupOf(info, info.gid);
        case 'i': return info.inode;
        case 'h': return info.nlink;
        case 'd': return DEV_DECIMAL;
        case 'D': return DEV_DECIMAL.toString(16);
        case 'a': return (info.mode & 0o7777).toString(8);
        case 'A': return info.sym;
        case 'o': return BLKSIZE;
        case 'm': return '/';
        case 't': return '0';
        case 'T': return '0';
        case 'x': case 'X': return formatTime(info.mtime);
        case 'y': case 'Y': return formatTime(info.mtime);
        case 'z': case 'Z': return formatTime(info.mtime);
        case 'w': case 'W': return formatTime(info.mtime);
        case 'C': return '?';
        default: return '?';
    }
}

const FILE_MODE_TYPE = 0o100000;

/** Renderiza un formato `-c` de GNU, sin mas directivos que los conocidos. */
function renderFormat(info, format) {
    let out = '';
    for (let i = 0; i < format.length; i++) {
        const ch = format[i];
        if (ch !== '%') { out += ch; continue; }
        let j = i + 1;
        let flags = '';
        while (j < format.length && '-+ #0'.includes(format[j])) flags += format[j++];
        let widthText = '';
        while (j < format.length && format[j] >= '0' && format[j] <= '9') widthText += format[j++];
        let precision = null;
        if (format[j] === '.') {
            j++;
            let precText = '';
            while (j < format.length && format[j] >= '0' && format[j] <= '9') precText += format[j++];
            precision = precText === '' ? 0 : parseInt(precText, 10);
        }
        const code = format[j];
        if (code == null) { out += '%'; break; }
        if (code === '%') { out += '%'; i = j; continue; }
        out += pad(directive(info, code), flags, widthText ? parseInt(widthText, 10) : null, precision);
        i = j;
    }
    return out + '\n';
}

export default {
    name: 'stat',
    alias: [],
    synopsis: 'stat [-c FORMAT] FICHERO...',
    run(ctx, argv) {
        const opts = parseOptions(argv);
        if (!opts.operands.length) throw usageError('stat: missing operand');

        let code = 0;
        for (const operand of opts.operands) {
            const abs = normalizePath(ctx.cwd, operand);
            let info = null;
            try {
                info = collect(ctx, abs, operand, opts.dereference);
            } catch (e) {
                info = null;
            }
            if (info == null) {
                ctx.stderr.write("stat: cannot stat '" + operand + "': No such file or directory\n");
                code = 1;
                continue;
            }
            ctx.stdout.write(opts.format == null
                ? renderDefault(info)
                : renderFormat(info, opts.format));
        }
        return code;
    }
};

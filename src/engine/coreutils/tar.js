/**
 * tar — crea, lista y extrae ficheros `.tar` en formato ustar.
 *
 * Mensajes verificados contra GNU tar 1.35:
 *   tar: /x: Cannot open: No such file or directory
 *   tar: Error is not recoverable: exiting now
 *   tar: This does not look like a tar archive
 *   tar: Exiting with failure status due to previous errors
 *   tar: nope.txt: Cannot stat: No such file or directory
 *   tar: nada: Not found in archive
 *   tar: Cowardly refusing to create an empty archive
 *   tar: You must specify one of the '-Acdtrux', '--delete' or '--test-label' options
 *   tar: option requires an argument -- 'f'
 *   tar: unrecognized option '-z'
 *
 * Desvios conscientes:
 *  - Solo formato ustar y sin compresion: `-z` u otra opcion de compresion
 *    salen como opcion desconocida con codigo 1, mientras que GNU tar 1.35 las
 *    entiende y devuelve 64 o 2.
 *  - `tar -tvf` imprime solo los nombres, no el listado largo con permisos.
 *  - `yes` y `sleep` no esperan; aqui tampoco se comprueba el reloj.
 */

import { ShellError, EXIT_ERROR } from '../errors.js';
import { normalizePath, dirnameOf, formatSymbolic } from '../fs.js';

const BLOCK = 512;
const BLOCKING_FACTOR = 20;

/** Pista de ayuda que imprime GNU tar. */
const TRY_HELP = "Try 'tar --help' or 'tar --usage' for more information.";

/** Error de uso con la pista de ayuda. */
function usageError(message) {
    return new ShellError(message + '\n' + TRY_HELP, EXIT_ERROR);
}

/** Comilla simple al estilo de GNU. */
function quote(text) {
    return "'" + String(text).replace(/'/g, "'\\''") + "'";
}

/** Desempaqueta las letras cortas y las opciones largas de tar. */
function parseOptions(argv) {
    const opts = { create: false, list: false, extract: false, verbose: false, file: null, dir: null, operands: [] };
    const setFile = (value) => {
        if (value == null || value === '') throw usageError("tar: option requires an argument -- 'f'");
        opts.file = value;
    };
    const setDir = (value) => {
        if (value == null || value === '') throw usageError("tar: option requires an argument -- 'C'");
        opts.dir = value;
    };
    let i = 1;
    for (; i < argv.length; i++) {
        const op = argv[i];
        if (op === '--') { i++; break; }
        if (op === '--create') { opts.create = true; continue; }
        if (op === '--list') { opts.list = true; continue; }
        if (op === '--extract' || op === '--get') { opts.extract = true; continue; }
        if (op === '--verbose') { opts.verbose = true; continue; }
        if (op === '--file') { setFile(argv[++i]); continue; }
        if (op.startsWith('--file=')) { setFile(op.slice('--file='.length)); continue; }
        if (op === '--directory') { setDir(argv[++i]); continue; }
        if (op.startsWith('--directory=')) { setDir(op.slice('--directory='.length)); continue; }
        if (op.startsWith('--')) throw usageError('tar: unrecognized option ' + quote(op));
        if (op.length > 1 && op[0] === '-') {
            const flags = op.slice(1);
            for (let j = 0; j < flags.length; j++) {
                const flag = flags[j];
                if (flag === 'c') opts.create = true;
                else if (flag === 't') opts.list = true;
                else if (flag === 'x' || flag === 'r' || flag === 'u') opts.extract = true;
                else if (flag === 'v') opts.verbose = true;
                else if (flag === 'f') { setFile(flags.slice(j + 1) || argv[++i]); break; }
                else if (flag === 'C') { setDir(flags.slice(j + 1) || argv[++i]); break; }
                else throw usageError('tar: unrecognized option ' + quote('-' + flag));
            }
            continue;
        }
        break;
    }
    opts.operands = argv.slice(i);
    return opts;
}

// ---------- binario ----------

/** Escribe texto en un bloque, rellenando con NUL. */
function writeField(b, offset, length, text) {
    const value = String(text);
    for (let i = 0; i < length; i++) {
        b[offset + i] = i < value.length ? value.charCodeAt(i) & 0xff : 0;
    }
}

/** Escribe un numero octal con NUL final, como hace GNU tar. */
function writeOctal(b, offset, length, value) {
    const digits = Math.max(0, Number(value) || 0).toString(8);
    writeField(b, offset, length - 1, digits.padStart(length - 1, '0'));
    b[offset + length - 1] = 0;
}

/** Lee un campo terminado en NUL o espacio. */
function readField(chars, offset, length) {
    let out = '';
    for (let i = 0; i < length; i++) {
        const c = chars.charCodeAt(offset + i) & 0xff;
        if (c === 0) break;
        out += String.fromCharCode(c);
    }
    return out;
}

/** Reconstruye el buffer de512 bytes de una cabecera ustar. */
function makeHeader(member) {
    const b = new Array(BLOCK).fill(0);
    let name = member.name;
    let prefix = '';
    if (name.length > 100) {
        const cut = name.lastIndexOf('/', name.length - 100);
        if (cut > 0 && cut <= 155) {
            prefix = name.slice(0, cut);
            name = name.slice(cut + 1);
        }
    }
    writeField(b, 0, 100, name);
    writeOctal(b, 100, 8, member.mode);
    writeOctal(b, 108, 8, member.uid);
    writeOctal(b, 116, 8, member.gid);
    writeOctal(b, 124, 12, member.size);
    writeOctal(b, 136, 12, member.mtime);
    for (let i = 148; i < 156; i++) b[i] = 32;
    b[156] = member.type.charCodeAt(0);
    writeField(b, 157, 100, member.linkname || '');
    writeField(b, 257, 6, 'ustar');
    writeField(b, 263, 2, '00');
    writeField(b, 265, 32, member.uname || '');
    writeField(b, 297, 32, member.gname || '');
    writeOctal(b, 329, 8, 0);
    writeOctal(b, 337, 8, 0);
    writeField(b, 345, 155, prefix);
    let sum = 0;
    for (const byte of b) sum += byte;
    writeField(b, 148, 6, sum.toString(8).padStart(6, '0'));
    b[154] = 0;
    b[155] = 32;
    return b;
}

/** Suma de la cabecera tal y como la valida el lector de GNU. */
function checksumOf(b) {
    let sum = 0;
    for (let i = 0; i < BLOCK; i++) {
        sum += (i >= 148 && i < 156) ? 32 : b[i];
    }
    return sum;
}

/** true si el bloque esta lleno de ceros (fin de archivo o hueco). */
function isZeroBlock(chars, offset) {
    for (let i = 0; i < BLOCK; i++) {
        if ((chars.charCodeAt(offset + i) & 0xff) !== 0) return false;
    }
    return true;
}

/**
 * Lee las cabeceras de un archivo. Devuelve `null` si el contenido no es un
 * tar, o la lista de miembros con sus offsets de datos.
 */
function readArchive(chars) {
    if (chars.length < BLOCK) return null;
    const members = [];
    let offset = 0;
    while (offset + BLOCK <= chars.length) {
        if (isZeroBlock(chars, offset)) break;
        const b = [];
        for (let i = 0; i < BLOCK; i++) b.push(chars.charCodeAt(offset + i) & 0xff);
        const magic = readField(chars, offset + 257, 6);
        const stored = parseInt(readField(chars, offset + 148, 8).trim(), 8);
        if (magic.indexOf('ustar') !== 0 || !Number.isFinite(stored) || stored !== checksumOf(b)) return null;
        const name = readField(chars, offset, 100);
        const prefix = readField(chars, offset + 345, 155);
        const size = parseInt(readField(chars, offset + 124, 12).trim(), 8) || 0;
        const typeflag = readField(chars, offset + 156, 1) || '0';
        members.push({
            name: prefix ? prefix + '/' + name : name,
            size,
            type: typeflag,
            linkname: readField(chars, offset + 157, 100),
            mode: parseInt(readField(chars, offset + 100, 8).trim(), 8) || 0,
            uid: parseInt(readField(chars, offset + 108, 8).trim(), 8) || 0,
            gid: parseInt(readField(chars, offset + 116, 8).trim(), 8) || 0,
            mtime: parseInt(readField(chars, offset + 136, 12).trim(), 8) || 0,
            dataOffset: offset + BLOCK
        });
        offset += BLOCK + Math.ceil(size / BLOCK) * BLOCK;
    }
    return members;
}

/** Convierte bytes (caracteres 0-255) en cadena. */
function bytesToString(bytes) {
    let out = '';
    for (let i = 0; i < bytes.length; i += 4096) {
        out += String.fromCharCode.apply(null, bytes.slice(i, i + 4096));
    }
    return out;
}

/** Monta el archivo completo: cabeceras, datos y relleno a10240. */
function buildArchive(members) {
    const bytes = [];
    for (const member of members) {
        const header = makeHeader(member);
        for (const byte of header) bytes.push(byte);
        if (member.data) {
            for (let i = 0; i < member.data.length; i++) bytes.push(member.data.charCodeAt(i) & 0xff);
        }
        const padding = (BLOCK - (member.size % BLOCK)) % BLOCK;
        for (let i = 0; i < padding; i++) bytes.push(0);
    }
    bytes.push(0, 0, 0, 0, 0, 0, 0, 0);
    bytes.push(0, 0, 0, 0, 0, 0, 0, 0);
    const factor = BLOCK * BLOCKING_FACTOR;
    while (bytes.length % factor !== 0) bytes.push(0);
    return bytesToString(bytes);
}

// ---------- reglas de pertenencia ----------

/** Un miembro esta contenido en el patron de seleccion de `-t` y `-x`. */
function matches(name, pattern) {
    if (pattern.endsWith('/')) return name.indexOf(pattern) === 0;
    return name === pattern || name.indexOf(pattern + '/') === 0;
}

export default {
    name: 'tar',
    alias: [],
    synopsis: 'tar -c|-t|-x [-f FICHERO] [-C DIR] [NOMBRE]...',
    async run(ctx, argv) {
        const opts = parseOptions(argv);
        const operations = [opts.create, opts.list, opts.extract].filter(Boolean).length;
        if (operations === 0) {
            throw usageError("tar: You must specify one of the '-Acdtrux', '--delete' or '--test-label' options");
        }

        const fs = ctx.fs;
        const actor = { uid: ctx.owner.uid, gid: ctx.owner.gid, groups: [] };
        const baseDir = normalizePath(ctx.cwd, opts.dir == null ? '.' : opts.dir);

        if (opts.dir != null && operations < 3) {
            const dirNode = fs.node(baseDir);
            if (!dirNode) return failOpen(ctx, opts.dir, 'No such file or directory');
            if (!dirNode.isDir) return failOpen(ctx, opts.dir, 'Not a directory');
        }

        if (opts.create) return createArchive(ctx, opts, fs, actor, baseDir);
        return readWriteArchive(ctx, opts, fs, actor, baseDir);
    }
};

/** Mensaje doble de GNU para un fichero que no se puede abrir. */
function failOpen(ctx, path, reason) {
    ctx.stderr.write('tar: ' + path + ': Cannot open: ' + reason + '\n');
    ctx.stderr.write('tar: Error is not recoverable: exiting now\n');
    return 2;
}

/** Mensaje doble de GNU cuando algo ha ido mal pero se puede seguir. */
function failPartial(ctx) {
    ctx.stderr.write('tar: Exiting with failure status due to previous errors\n');
    return 2;
}

/** Recoge un arbol en miembros de archivo, en el orden en que los pide GNU. */
function collect(ctx, fs, baseDir, operand, members, failures) {
    const abs = normalizePath(baseDir, operand);
    let node = null;
    try {
        node = fs.node(abs, { follow: false });
    } catch (e) {
        node = null;
    }
    if (!node) {
        failures.push('tar: ' + operand + ': Cannot stat: No such file or directory');
        return;
    }
    const name = node.isDir ? (operand.endsWith('/') ? operand : operand + '/') : operand;
    const member = {
        name,
        mode: node.mode & 0o7777,
        uid: node.uid,
        gid: node.gid,
        mtime: node.mtime,
        type: node.isDir ? '5' : (node.isLink ? '2' : '0'),
        linkname: node.isLink ? node.target : '',
        size: node.isDir || node.isLink ? 0 : node.content.length,
        data: node.isDir || node.isLink ? '' : node.content,
        uname: node.uid === 0 ? 'root' : 'agente',
        gname: node.gid === 0 ? 'root' : 'agente'
    };
    members.push(member);
    if (!node.isDir) return;
    for (const child of node.list()) {
        const childName = name + child.name;
        collect(ctx, fs, baseDir, childName, members, failures);
    }
}

/** `tar -c`: escribe un archivo con los operandos pedidos. */
function createArchive(ctx, opts, fs, actor, baseDir) {
    if (!opts.operands.length) {
        ctx.stderr.write('tar: Cowardly refusing to create an empty archive\n');
        ctx.stderr.write(TRY_HELP + '\n');
        return 2;
    }
    const members = [];
    const failures = [];
    for (const operand of opts.operands) {
        collect(ctx, fs, baseDir, operand, members, failures);
    }
    for (const failure of failures) ctx.stderr.write(failure + '\n');
    const data = buildArchive(members);

    if (opts.file == null) {
        ctx.stdout.write(data);
    } else {
        const abs = normalizePath(ctx.cwd, opts.file);
        try {
            const node = fs.writeFile(abs, data, 0o644, actor);
            node.mtime = ctx.shell.now;
        } catch (e) {
            ctx.stderr.write('tar: ' + opts.file + ': Cannot open: ' + reasonFrom(e) + '\n');
            ctx.stderr.write('tar: Error is not recoverable: exiting now\n');
            return 2;
        }
    }
    if (opts.verbose) for (const member of members) ctx.stdout.write(member.name + '\n');
    return failures.length ? failPartial(ctx) : 0;
}

/** `tar -t` y `tar -x`: leen un archivo y listan o extraen. */
function readWriteArchive(ctx, opts, fs, actor, baseDir) {
    let chars;
    if (opts.file == null) {
        chars = String(ctx.stdin || '');
    } else {
        const abs = normalizePath(ctx.cwd, opts.file);
        try {
            chars = fs.readFile(abs);
        } catch (e) {
            return failOpen(ctx, opts.file, reasonFrom(e));
        }
    }
    const members = readArchive(chars);
    if (members == null) {
        ctx.stderr.write('tar: This does not look like a tar archive\n');
        return failPartial(ctx);
    }

    const selected = [];
    const failures = [];
    if (opts.operands.length) {
        for (const operand of opts.operands) {
            const found = members.filter((m) => matches(m.name, operand));
            if (!found.length) failures.push('tar: ' + operand + ': Not found in archive');
            else selected.push(...found);
        }
    } else {
        selected.push(...members);
    }

    let code = 0;
    if (opts.list) {
        for (const member of selected) ctx.stdout.write(member.name + '\n');
    } else {
        code = extractAll(ctx, opts, fs, actor, baseDir, selected);
    }
    for (const failure of failures) ctx.stderr.write(failure + '\n');
    if (failures.length) code = failPartial(ctx);
    return code;
}

/** Crea los directorios que falten por el camino, como hace GNU tar. */
function ensureParents(ctx, fs, actor, abs) {
    const segs = abs === '/' ? [] : abs.slice(1).split('/');
    let cur = '/';
    for (let i = 0; i < segs.length - 1; i++) {
        cur = cur === '/' ? '/' + segs[i] : cur + '/' + segs[i];
        const node = fs.node(cur);
        if (node) {
            if (!node.isDir) throw new Error(cur + ': Not a directory');
            continue;
        }
        fs.mkdir(cur, 0o777 & ~(ctx.shell.umask || 0), actor);
    }
}

/** Extrae los miembros seleccionados. */
function extractAll(ctx, opts, fs, actor, baseDir, members) {
    let code = 0;
    for (const member of members) {
        const abs = normalizePath(baseDir, member.name.replace(/\/$/, ''));
        try {
            ensureParents(ctx, fs, actor, abs);
            const existing = fs.node(abs, { follow: false });
            if (member.type === '5') {
                if (!existing) fs.mkdir(abs, member.mode || 0o755, actor);
                else if (!existing.isDir) throw new Error(member.name + ': Is a directory');
                else existing.mode = member.mode;
            } else if (member.type === '2') {
                if (existing && !existing.isDir) fs.unlink(abs);
                const parent = fs.node(dirnameOf(abs));
                if (!parent || !parent.isDir) throw new Error(member.name + ': Cannot open: No such file or directory');
                const link = fs.newLink(abs.slice(dirnameOf(abs).length + 1), member.linkname, member.mode || 0o777);
                link.uid = actor.uid;
                link.gid = actor.gid;
                link.mtime = member.mtime;
                parent.setChild(link.name, link);
            } else {
                if (existing && existing.isDir) throw new Error(member.name + ': Cannot open: Is a directory');
                const node = fs.writeFile(abs, member.data, member.mode || 0o644, actor);
                node.mode = member.mode || 0o644;
                node.mtime = member.mtime;
            }
            if (opts.verbose) ctx.stdout.write(member.name + '\n');
        } catch (e) {
            ctx.stderr.write('tar: ' + member.name + ': Cannot open: ' + reasonFrom(e) + '\n');
            code = failPartial(ctx);
        }
    }
    return code;
}

/** Extrae el errno de una excepcion del VFS. */
function reasonFrom(error) {
    const message = String(error.message);
    const sep = message.indexOf(': ');
    return sep >= 0 ? message.slice(sep + 2) : message;
}

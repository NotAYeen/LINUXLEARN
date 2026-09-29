/**
 * Sistema de ficheros virtual.
 *
 * Arbol de nodos con permisos rwx por usuario/grupo/otros, enlaces simbolicos y
 * marcas de tiempo. Es la unica fuente de verdad del estado del disco: el shell,
 * las utilidades y las aserciones de las misiones leen y escriben aqui.
 *
 * Sin DOM y sin dependencias: se importa igual desde el navegador y desde Node,
 * que es lo que permite validar las 32 misiones en el validador y en los tests.
 */

import { ShellError, EXIT_MISUSE } from './errors.js';

export const FILE = 'file';
export const DIR = 'dir';
export const LINK = 'link';

export const ROOT_UID = 0;
export const ROOT_GID = 0;

export class VNode {
    constructor(name, type, mode) {
        this.name = name;
        this.type = type;
        this.mode = mode;
        this.uid = 0;
        this.gid = 0;
        this.content = '';
        this.target = null;
        this.children = null;
        this.mtime = 0;
        this.links = 1;
    }

    get isDir() { return this.type === DIR; }
    get isFile() { return this.type === FILE; }
    get isLink() { return this.type === LINK; }

    child(name) {
        return this.children ? (this.children.get(name) || null) : null;
    }

    setChild(name, node) {
        if (!this.children) this.children = new Map();
        this.children.set(name, node);
        return node;
    }

    removeChild(name) {
        if (this.children) this.children.delete(name);
    }

    list() {
        if (!this.children) return [];
        return Array.from(this.children.values());
    }
}

/**
 * Convierte '755', 'rwxr-xr-x' o '+x' en un entero de 12 bits.
 * `current` es imprescindible para los modos simbolicos: sin el modo vigente
 * un `chmod +x` no tiene sobre que operar.
 */
export function parseMode(text, current) {
    if (text == null) throw new ShellError('invalid mode', EXIT_MISUSE);
    const s = String(text).trim();
    if (/^[0-7]{1,4}$/.test(s)) return parseInt(s, 8) & 0o7777;
    if (/^[rwxXstT-]{9}$/.test(s) || /^[-dlbcpsS][rwxXstT-]{9}$/.test(s)) {
        return symbolicToOctal(s, current);
    }
    if (/[+-=]/.test(s)) return applySymbolic(s, current);
    throw new ShellError(`invalid mode: '${s}'`, EXIT_MISUSE);
}

/** 'rwxr-xr-x' o '-rwxr-xr-x' -> 493 */
function symbolicToOctal(s, current) {
    const isDir = current != null && current.isDir;
    const offset = s.length === 10 ? 1 : 0;
    const triads = [6, 3, 0];
    let mode = 0;
    for (let t = 0; t < 3; t++) {
        const shift = offset + t * 3;
        const ch = [s[shift], s[shift + 1], s[shift + 2]];
        if (ch[0] === 'r') mode |= 1 << (triads[t] + 2);
        if (ch[1] === 'w') mode |= 1 << (triads[t] + 1);
        const exec = ch[2];
        if (exec === 'x' || exec === 's' || exec === 't' || (exec === 'X' && isDir)) {
            mode |= 1 << triads[t];
        }
        if ((exec === 's' || exec === 'S') && t < 2) mode |= 1 << (t === 0 ? 11 : 10);
        if ((exec === 't' || exec === 'T') && t === 2) mode |= 1 << 9;
    }
    return mode & 0o7777;
}

/** Clase de permisos -> desplazamiento de su tercia en el modo. */
const TRIAS = { u: 6, g: 3, o: 0 };

/** 'go', 'ug', 'a' o '' -> tercias que tocan, sin repetir. */
function terciasDe(who) {
    const letras = who === '' ? 'a' : who;
    if (letras.includes('a')) return [6, 3, 0];
    const tercias = [];
    for (const letra of letras) {
        const t = TRIAS[letra];
        if (t !== undefined && !tercias.includes(t)) tercias.push(t);
    }
    return tercias;
}

/** Bit de setuid, setgid o sticky de una tercia (null si no tiene). */
function bitEspecial(t) {
    if (t === 6) return 1 << 11;
    if (t === 3) return 1 << 10;
    return 1 << 9;
}

/** Aplica '+x', 'u+w', 'go-rwx', 'a=rw' sobre el modo vigente. */
function applySymbolic(s, current) {
    const mode = (current == null ? 0o644 : current.mode) & 0o7777;
    const clauses = String(s).split(',').filter((c) => c.length > 0);
    if (!clauses.length) throw new ShellError(`invalid mode: '${s}'`, EXIT_MISUSE);
    const isDir = current != null && current.isDir === true;
    let out = mode;
    for (const clause of clauses) {
        const m = clause.match(/^([ugoa]*)([-+=])([rwxXst]*)$/);
        if (!m) throw new ShellError(`invalid mode: '${clause}'`, EXIT_MISUSE);
        const who = m[1] === '' ? 'a' : m[1];
        const op = m[2];
        const perms = m[3];
        if (perms === '') throw new ShellError(`invalid mode: '${clause}'`, EXIT_MISUSE);
        const tercias = terciasDe(who);
        for (const p of perms) {
            for (const t of tercias) {
                let value = 0;
                if (p === 'r') value = 4;
                else if (p === 'w') value = 2;
                else if (p === 'x') value = 1;
                else if (p === 'X') value = isDir ? 1 : 0;
                else if (p === 's') {
                    if (t === 0) continue;
                    if (op === '-') out &= ~bitEspecial(t);
                    else out |= bitEspecial(t);
                    continue;
                } else if (p === 't') {
                    if (t !== 0) continue;
                    if (op === '-') out &= ~bitEspecial(0);
                    else out |= bitEspecial(0);
                    continue;
                }
                if (op === '+') out |= value << t;
                else if (op === '-') out &= ~(value << t);
                else {
                    out = (out & ~(7 << t)) | (value << t);
                    out &= ~bitEspecial(t);
                }
            }
        }
    }
    return out & 0o7777;
}

/** 493 -> '755' */
export function formatOctal(mode) {
    return (mode & 0o7777).toString(8).padStart(3, '0');
}

/** 493 -> 'rwxr-xr-x' */
export function formatSymbolic(mode) {
    const triadas = [
        { shift: 6, especial: 1 << 11, letra: 's' },
        { shift: 3, especial: 1 << 10, letra: 's' },
        { shift: 0, especial: 1 << 9, letra: 't' }
    ];
    let out = '';
    for (const { shift, especial, letra } of triadas) {
        const tria = (mode >> shift) & 7;
        out += tria & 4 ? 'r' : '-';
        out += tria & 2 ? 'w' : '-';
        const x = tria & 1;
        if (mode & especial) out += x ? letra : letra.toUpperCase();
        else out += x ? 'x' : '-';
    }
    return out;
}

/** Normaliza una ruta contra un directorio base. Devuelve absoluta y sin '.', '..' ni '//'. */
export function normalizePath(base, path) {
    if (path == null || path === '') return base;
    const raw = String(path);
    const parts = raw.startsWith('/') ? raw.split('/') : (base + '/' + raw).split('/');
    const out = [];
    for (const seg of parts) {
        if (seg === '' || seg === '.') continue;
        if (seg === '..') { out.pop(); continue; }
        out.push(seg);
    }
    return '/' + out.join('/');
}

export function dirnameOf(path) {
    const abs = path;
    if (abs === '/') return '/';
    const idx = abs.lastIndexOf('/');
    if (idx <= 0) return '/';
    return abs.slice(0, idx);
}

export function basenameOf(path) {
    if (path === '/') return '/';
    const idx = path.lastIndexOf('/');
    return idx < 0 ? path : path.slice(idx + 1);
}

export class VFS {
    constructor(options = {}) {
        this.root = new VNode('', DIR, 0o755);
        this.root.uid = ROOT_UID;
        this.root.gid = ROOT_GID;
        this.root.mtime = options.now || 0;
        this.now = options.now || 0;
    }

    // ---------- creacion de nodos ----------

    newDir(name, mode = 0o755) {
        const n = new VNode(name, DIR, mode);
        n.mtime = this.now;
        return n;
    }

    newFile(name, mode = 0o644, content = '') {
        const n = new VNode(name, FILE, mode);
        n.content = content;
        n.mtime = this.now;
        return n;
    }

    newLink(name, target, mode = 0o777) {
        const n = new VNode(name, LINK, mode);
        n.target = target;
        n.mtime = this.now;
        return n;
    }

    // ---------- resolucion ----------

    /** Busca un nodo sin seguir el enlace final. */
    rawNode(path) {
        const abs = normalizePath('/', path);
        if (abs === '/') return this.root;
        let cur = this.root;
        const segs = abs.slice(1).split('/');
        for (let i = 0; i < segs.length; i++) {
            if (cur.type !== DIR) return null;
            const child = cur.child(segs[i]);
            if (!child) return null;
            cur = child;
        }
        return cur;
    }

    /**
     * Resuelve una ruta absoluta a la lista final de segmentos, siguiendo
     * enlaces simbolicos. Devuelve null si algun componente no existe.
     *
     * Un enlace intermedio (`/a -> /x` y se pide `/a/b`) se resuelve como
     * `/x/b`, que es lo que hace el kernel. El algoritmo es el clasico: el
     * destino del enlace se reescribe delante de los segmentos que quedaban.
     */
    _resolveSegments(rawPath, followFinal = true) {
        const abs = normalizePath('/', rawPath);
        const pending = abs === '/' ? [] : abs.slice(1).split('/');
        const out = [];
        let hops = 0;
        while (pending.length) {
            const seg = pending.shift();
            if (seg === '' || seg === '.') continue;
            if (seg === '..') { out.pop(); continue; }
            const cur = this._fromSegments(out);
            if (!cur || cur.type !== DIR) return null;
            const child = cur.child(seg);
            if (!child) return null;
            const isLast = pending.length === 0;
            if (child.type === LINK && (followFinal || !isLast)) {
                hops++;
                if (hops > 40) {
                    throw new ShellError(`${abs}: too many levels of symbolic links`, EXIT_MISUSE);
                }
                if (child.target.startsWith('/')) out.length = 0;
                pending.splice(0, pending.length, ...child.target.split('/'), ...pending);
                continue;
            }
            out.push(seg);
        }
        return out;
    }

    _fromSegments(segs) {
        let cur = this.root;
        for (const seg of segs) {
            if (cur.type !== DIR) return null;
            cur = cur.child(seg);
            if (!cur) return null;
        }
        return cur;
    }

    /**
     * Busca un nodo. Con `follow: false` el enlace final NO se sigue, que es lo
     * que necesitan `ls -l`, `readlink` y `lstat`.
     */
    node(path, options = {}) {
        const follow = options.follow !== false;
        const segs = this._resolveSegments(path, follow);
        if (segs == null) return null;
        return segs.length === 0 ? this.root : this._fromSegments(segs);
    }

    /** Ruta absoluta ya resuelta, sin enlaces en el camino. */
    realpath(path) {
        const segs = this._resolveSegments(path, true);
        if (segs == null) return null;
        return '/' + segs.join('/');
    }

    /** Nodo + directorio que lo contiene, para crear y borrar. */
    parentOf(path) {
        const abs = normalizePath('/', path);
        if (abs === '/') return { parent: null, name: '', abs };
        const dirAbs = dirnameOf(abs);
        const parent = this.node(dirAbs);
        if (!parent) throw new ShellError(`${dirAbs}: No such file or directory`, EXIT_MISUSE);
        if (parent.type !== DIR) throw new ShellError(`${dirAbs}: Not a directory`, EXIT_MISUSE);
        return { parent, name: basenameOf(abs), abs };
    }

    exists(path) {
        return this.node(path) != null;
    }

    isDir(path) {
        const n = this.node(path);
        return n != null && n.type === DIR;
    }

    isFile(path) {
        const n = this.node(path);
        return n != null && n.type === FILE;
    }

    // ---------- permisos ----------

    /** bits en 0o7: 4 lectura, 2 escritura, 1 ejecucion. */
    accessBits(node, ctx) {
        if (node.uid === ctx.uid) return (node.mode >> 6) & 7;
        if (node.gid === ctx.gid || (ctx.groups || []).includes(node.gid)) return (node.mode >> 3) & 7;
        return node.mode & 7;
    }

    canRead(node, ctx) { return (this.accessBits(node, ctx) & 4) !== 0; }
    canWrite(node, ctx) { return (this.accessBits(node, ctx) & 2) !== 0; }
    canExec(node, ctx) { return (this.accessBits(node, ctx) & 1) !== 0; }

    requireRead(node, path, ctx, prog) {
        if (!this.canRead(node, ctx)) {
            throw new ShellError(`${prog}: cannot open '${path}' for reading: Permission denied`, 1);
        }
    }

    requireWrite(node, path, ctx, prog) {
        if (!this.canWrite(node, ctx)) {
            throw new ShellError(`${prog}: cannot open '${path}' for writing: Permission denied`, 1);
        }
    }

    // ---------- escritura ----------

    mkdir(abs, mode = 0o755, ctx = null) {
        const { parent, name } = this.parentOf(abs);
        const existing = parent.child(name);
        if (existing) {
            if (existing.type === DIR) return existing;
            throw new ShellError(`mkdir: cannot create directory '${abs}': File exists`, 1);
        }
        this.requireWrite(parent, dirnameOf(abs), ctx || { uid: 0, gid: 0 }, 'mkdir');
        const node = this.newDir(name, mode);
        node.uid = ctx ? ctx.uid : 0;
        node.gid = ctx ? ctx.gid : 0;
        parent.setChild(name, node);
        parent.mtime = this.now;
        return node;
    }

    mkdirp(abs, mode = 0o755, ctx = null) {
        const segs = abs === '/' ? [] : abs.slice(1).split('/');
        let cur = '/';
        for (const seg of segs) {
            cur = cur === '/' ? '/' + seg : cur + '/' + seg;
            if (!this.isDir(cur)) this.mkdir(cur, mode, ctx);
        }
        return this.node(abs);
    }

    writeFile(abs, content, mode = 0o644, ctx = null) {
        const { parent, name } = this.parentOf(abs);
        let node = parent.child(name);
        if (node && node.type === LINK) {
            const target = normalizePath(dirnameOf(abs), node.target);
            return this.writeFile(target, content, mode, ctx);
        }
        if (node && node.type === DIR) {
            throw new ShellError(`${abs}: Is a directory`, 1);
        }
        if (node) {
            this.requireWrite(node, abs, ctx || { uid: 0, gid: 0 }, 'write');
        } else {
            this.requireWrite(parent, dirnameOf(abs), ctx || { uid: 0, gid: 0 }, 'write');
            node = this.newFile(name, mode);
            node.uid = ctx ? ctx.uid : 0;
            node.gid = ctx ? ctx.gid : 0;
            parent.setChild(name, node);
        }
        node.content = content;
        node.mtime = this.now;
        return node;
    }

    appendFile(abs, content, ctx = null) {
        const node = this.node(abs);
        if (!node) return this.writeFile(abs, content, 0o644, ctx);
        this.requireWrite(node, abs, ctx, 'write');
        node.content += content;
        node.mtime = this.now;
        return node;
    }

    readFile(abs) {
        const node = this.node(abs);
        if (!node) throw new ShellError(`${abs}: No such file or directory`, 1);
        if (node.type === DIR) throw new ShellError(`${abs}: Is a directory`, 1);
        return node.content;
    }

    unlink(abs, options = {}) {
        const { parent, name } = this.parentOf(abs);
        const node = parent.child(name);
        if (!node) throw new ShellError(`cannot remove '${abs}': No such file or directory`, 1);
        if (node.type === DIR && node.list().length && !options.recursive) {
            throw new ShellError(`cannot remove '${abs}': Is a directory`, 1);
        }
        parent.removeChild(name);
        parent.mtime = this.now;
        return node;
    }

    rename(from, to) {
        const src = this.node(from);
        if (!src) throw new ShellError(`cannot rename '${from}': No such file or directory`, 1);
        if (from === to) return;
        if (to.startsWith(from + '/')) {
            throw new ShellError(`cannot move '${from}' to a subdirectory of itself, '${to}'`, 1);
        }
        const dstNode = this.node(to);
        if (dstNode && dstNode.type === DIR) {
            const finalPath = to === '/' ? '/' + src.name : to + '/' + src.name;
            this._detach(finalPath);
            const parent = this.node(dirnameOf(finalPath));
            parent.setChild(basenameOf(finalPath), src);
            return;
        }
        this._detach(from);
        const parent = this.node(dirnameOf(to));
        if (!parent || parent.type !== DIR) throw new ShellError(`cannot rename '${from}' to '${to}'`, 1);
        src.name = basenameOf(to);
        parent.setChild(src.name, src);
    }

    _detach(abs) {
        const parent = this.node(dirnameOf(abs));
        if (parent) parent.removeChild(basenameOf(abs));
    }

    copyFile(fromAbs, toAbs, ctx = null) {
        const src = this.node(fromAbs);
        if (!src) throw new ShellError(`cannot stat '${fromAbs}': No such file or directory`, 1);
        const dstParent = this.node(dirnameOf(toAbs));
        if (!dstParent || dstParent.type !== DIR) {
            throw new ShellError(`cannot create '${toAbs}': No such file or directory`, 1);
        }
        const copy = this.newFile(basenameOf(toAbs), src.mode, src.content);
        copy.uid = ctx ? ctx.uid : src.uid;
        copy.gid = ctx ? ctx.gid : src.gid;
        dstParent.setChild(copy.name, copy);
        return copy;
    }

    copyTree(fromAbs, toAbs, ctx = null) {
        const src = this.node(fromAbs);
        if (!src) throw new ShellError(`cannot stat '${fromAbs}': No such file or directory`, 1);
        if (src.type === LINK) {
            return this.writeFile(toAbs, src.target, 0o777, ctx);
        }
        if (src.type === FILE) return this.copyFile(fromAbs, toAbs, ctx);
        const name = basenameOf(fromAbs);
        const target = toAbs === '/' ? '/' + name : toAbs;
        if (!this.isDir(target)) {
            this.mkdir(target, src.mode, ctx);
        }
        for (const child of src.list()) {
            this.copyTree(fromAbs === '/' ? '/' + child.name : fromAbs + '/' + child.name,
                target + '/' + child.name, ctx);
        }
        return this.node(target);
    }

    chmod(abs, mode) {
        const node = this.node(abs, { follow: false });
        if (!node) throw new ShellError(`cannot access '${abs}': No such file or directory`, 1);
        node.mode = mode & 0o7777;
        return node;
    }

    chown(abs, uid, gid) {
        const node = this.node(abs, { follow: false });
        if (!node) throw new ShellError(`cannot access '${abs}': No such file or directory`, 1);
        if (uid != null) node.uid = uid;
        if (gid != null) node.gid = gid;
        return node;
    }

    stat(abs) {
        const node = this.node(abs);
        if (!node) throw new ShellError(`cannot stat '${abs}': No such file or directory`, 1);
        if (node.type === DIR) {
            let size = 0;
            for (const c of node.list()) size += 4096;
            return { type: DIR, size, mode: node.mode, uid: node.uid, gid: node.gid, mtime: node.mtime, nlink: 2 + node.list().length };
        }
        return {
            type: node.type,
            size: node.type === LINK ? node.target.length : node.content.length,
            mode: node.mode,
            uid: node.uid,
            gid: node.gid,
            mtime: node.mtime,
            nlink: 1
        };
    }

    sizeOf(node) {
        return node.type === FILE ? node.content.length : 0;
    }

    /**
     * Recorre el arbol en profundidad y devuelve `[{ node, path, depth }]`.
     * No sigue enlaces simbolicos salvo que se pida: es el comportamiento de
     * `find`, que evita los bucles que un enlace a un ancestro provocaria.
     */
    walk(startAbs, options = {}) {
        const maxDepth = options.maxDepth == null ? Infinity : options.maxDepth;
        const follow = options.follow === true;
        const results = [];
        const stack = [{ path: startAbs, depth: 0 }];
        while (stack.length) {
            const { path, depth } = stack.pop();
            let node;
            try {
                node = this.node(path, { follow: follow || depth === 0 });
            } catch (e) {
                continue;
            }
            if (!node) continue;
            results.push({ node, path, depth });
            if (node.type !== DIR || depth >= maxDepth) continue;
            if (node.isLink) continue;
            const kids = node.list().sort(cmpNodes);
            for (let i = kids.length - 1; i >= 0; i--) {
                const name = kids[i].name;
                stack.push({ path: path === '/' ? '/' + name : path + '/' + name, depth: depth + 1 });
            }
        }
        return results;
    }
}

/** Orden de GNU: primero los que empiezan por punto, si se piden. Comparacion por bytes. */
export function cmpNodes(a, b) {
    const da = a.name.startsWith('.') ? 0 : 1;
    const db = b.name.startsWith('.') ? 0 : 1;
    if (da !== db) return da - db;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

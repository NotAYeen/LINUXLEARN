import { describe, it, expect } from 'vitest';
import {
    VFS, parseMode, formatOctal, formatSymbolic, normalizePath, dirnameOf, basenameOf, cmpNodes
} from '../src/engine/fs.js';
import { buildSeed, AGENT_HOME, SHELL_NOW, BASE_LINKS } from '../src/engine/seed.js';

const raiz = { uid: 0, gid: 0 };
const agente = { uid: 1000, gid: 1000 };

describe('permisos', () => {
    it('parsea octal y simbolico', () => {
        expect(parseMode('755')).toBe(0o755);
        expect(parseMode('000')).toBe(0);
        expect(formatOctal(0o755)).toBe('755');
        expect(formatSymbolic(0o755)).toBe('rwxr-xr-x');
        expect(formatSymbolic(0o644)).toBe('rw-r--r--');
        expect(formatSymbolic(0o4755)).toBe('rwsr-xr-x');
        expect(formatSymbolic(0o1777)).toBe('rwxrwxrwt');
        expect(formatSymbolic(0o4644)).toBe('rwSr--r--');
        expect(formatSymbolic(0o0700)).toBe('rwx------');
    });

    it('la forma simbolica y el octal se van y vienen', () => {
        for (const modo of [0o755, 0o644, 0o000, 0o777, 0o4755, 0o2755, 0o1777, 0o700, 0o640]) {
            expect(parseMode(formatSymbolic(modo)), `modo ${modo.toString(8)}`).toBe(modo);
            expect(parseMode(formatOctal(modo)), `octal ${modo.toString(8)}`).toBe(modo);
        }
    });

    it('aplica el modo simbolico sobre el vigente', () => {
        const dir = { isDir: true, mode: 0o755 };
        expect(parseMode('+x', dir)).toBe(0o755);
        expect(parseMode('a=r', dir)).toBe(0o444);
        expect(parseMode('go-w', { isDir: false, mode: 0o664 })).toBe(0o644);
        expect(parseMode('go-wx', { isDir: false, mode: 0o666 })).toBe(0o644);
        expect(parseMode('go-r', { isDir: false, mode: 0o664 })).toBe(0o620);
        expect(parseMode('u-x', { isDir: false, mode: 0o744 })).toBe(0o644);
        expect(parseMode('u-s', { isDir: false, mode: 0o4755 })).toBe(0o755);
        expect(parseMode('a-t', { isDir: false, mode: 0o1777 })).toBe(0o777);
        expect(() => parseMode('a=', dir)).toThrow(/invalid mode/);
    });

    it('lee y escribe la forma simbolica larga', () => {
        expect(parseMode('rwxr-xr-x')).toBe(0o755);
        expect(parseMode('rw-r--r--')).toBe(0o644);
        expect(parseMode('-rwsr-xr-x')).toBe(0o4755);
        expect(parseMode('rwsrwsrwt')).toBe(0o7777);
        expect(parseMode('drwxr-xr-x', { isDir: true })).toBe(0o755);
    });

    it('respeta usuario, grupo y otros', () => {
        const vfs = new VFS({ now: SHELL_NOW });
        vfs.mkdir('/d', 0o700, raiz);
        const nodo = vfs.node('/d');
        expect(vfs.canRead(nodo, agente)).toBe(false);
        expect(vfs.canWrite(nodo, agente)).toBe(false);
        expect(vfs.canRead(nodo, raiz)).toBe(true);
        vfs.mkdir('/g', 0o750, { uid: 0, gid: 1000 });
        expect(vfs.canRead(vfs.node('/g'), { uid: 1, gid: 1000 })).toBe(true);
        expect(vfs.canRead(vfs.node('/g'), { uid: 1, gid: 1 })).toBe(false);
    });
});

describe('rutas', () => {
    it('normaliza contra el directorio base', () => {
        expect(normalizePath('/a/b', 'c')).toBe('/a/b/c');
        expect(normalizePath('/a/b', '/x')).toBe('/x');
        expect(normalizePath('/a/b', '../..')).toBe('/');
        expect(normalizePath('/a', './b//c')).toBe('/a/b/c');
        expect(normalizePath('/a', '')).toBe('/a');
    });

    it('parte directorio y nombre', () => {
        expect(dirnameOf('/a/b/c')).toBe('/a/b');
        expect(dirnameOf('/a')).toBe('/');
        expect(basenameOf('/a/b/c')).toBe('c');
        expect(basenameOf('/')).toBe('/');
    });
});

describe('sistema de ficheros', () => {
    it('escribe, lee, mueve y borra', () => {
        const vfs = new VFS({ now: SHELL_NOW });
        vfs.mkdirp('/a/b', 0o755, raiz);
        vfs.writeFile('/a/b/f.txt', 'hola\n', 0o644, raiz);
        expect(vfs.readFile('/a/b/f.txt')).toBe('hola\n');
        vfs.rename('/a/b/f.txt', '/a/g.txt');
        expect(vfs.exists('/a/b/f.txt')).toBe(false);
        expect(vfs.readFile('/a/g.txt')).toBe('hola\n');
        vfs.unlink('/a/g.txt');
        expect(vfs.exists('/a/g.txt')).toBe(false);
    });

    it('rechaza escribir donde no hay permisos', () => {
        const vfs = new VFS({ now: SHELL_NOW });
        vfs.mkdirp('/d', 0o555, raiz);
        expect(() => vfs.writeFile('/d/f.txt', 'x', 0o644, agente)).toThrow(/Permission denied/);
        expect(() => vfs.mkdir('/d/hijo', 0o755, agente)).toThrow(/Permission denied/);
    });

    it('resuelve enlaces simbolicos, incluidos intermedios', () => {
        const vfs = new VFS({ now: SHELL_NOW });
        vfs.mkdirp('/real', 0o755, raiz);
        vfs.writeFile('/real/f.txt', 'x', 0o644, raiz);
        const padre = vfs.node('/');
        padre.setChild('enlace', vfs.newLink('enlace', '/real'));
        expect(vfs.realpath('/enlace/f.txt')).toBe('/real/f.txt');
        expect(vfs.readFile('/enlace/f.txt')).toBe('x');
        expect(vfs.node('/enlace', { follow: false }).type).toBe('link');
        expect(vfs.realpath('/enlace')).toBe('/real');
    });

    it('detecta bucles de enlaces', () => {
        const vfs = new VFS({ now: SHELL_NOW });
        const padre = vfs.node('/');
        padre.setChild('a', vfs.newLink('a', '/b'));
        padre.setChild('b', vfs.newLink('b', '/a'));
        expect(() => vfs.realpath('/a')).toThrow(/too many levels/);
    });

    it('recorre en profundidad con los hijos ordenados', () => {
        const vfs = new VFS({ now: SHELL_NOW });
        vfs.mkdirp('/a/c', 0o755, raiz);
        vfs.mkdirp('/a/b', 0o755, raiz);
        vfs.writeFile('/a/z.txt', '', 0o644, raiz);
        vfs.writeFile('/a/b/1.txt', '', 0o644, raiz);
        const rutas = vfs.walk('/').map((x) => x.path);
        expect(rutas).toEqual(['/', '/a', '/a/b', '/a/b/1.txt', '/a/c', '/a/z.txt']);
    });

    it('ordena como GNU: los que empiezan por punto primero', () => {
        const nombres = [{ name: 'b' }, { name: '.a' }, { name: 'A' }].sort(cmpNodes).map((n) => n.name);
        expect(nombres).toEqual(['.a', 'A', 'b']);
    });
});

describe('la semilla', () => {
    it('arranca determinista con el reloj congelado', () => {
        const a = buildSeed({ now: SHELL_NOW });
        const b = buildSeed({ now: SHELL_NOW });
        expect(a.vfs.readFile('/etc/hostname')).toBe(b.vfs.readFile('/etc/hostname'));
        expect(a.ctx.home).toBe(AGENT_HOME);
        expect(a.ctx.user).toBe('agente');
        expect(a.vfs.node('/').mtime).toBe(SHELL_NOW);
    });

    it('monta el arbol con permisos y enlaces declarados', () => {
        const { vfs } = buildSeed({ now: SHELL_NOW });
        expect(vfs.isDir(AGENT_HOME)).toBe(true);
        expect(vfs.readFile('/var/log/app.log').split('\n').filter(Boolean)).toHaveLength(9);
        expect(formatOctal(vfs.node('/home/agente/proyecto/datos/bloqueado.txt').mode)).toBe('000');
        expect(formatOctal(vfs.node('/etc/shadow').mode)).toBe('640');
        expect(vfs.node('/home/agente/proyecto/scripts/despliegue.sh')).toBeTruthy();
        expect(vfs.node('/home/agente/proyecto/scripts/despliegue.sh').mode & 0o111).toBeTruthy();
        for (const [ruta, , , , destino] of BASE_LINKS) {
            expect(vfs.node(ruta, { follow: false }).type).toBe('link');
            expect(vfs.node(ruta, { follow: false }).target).toBe(destino);
        }
        expect(vfs.rawNode('/home/agente').uid).toBe(1000);
        expect(vfs.rawNode('/etc/passwd').uid).toBe(0);
    });
});

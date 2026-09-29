import { describe, it, expect } from 'vitest';
import { tokenize } from '../src/engine/lexer.js';
import { parseScript } from '../src/engine/parser.js';
import { buildSeed, AGENT_HOME, SHELL_NOW } from '../src/engine/seed.js';
import {
    expandWords, expandirTramos, expandBraces, dividirCampos, globAPatron
} from '../src/engine/expansion.js';

const vars = {
    HOME: AGENT_HOME,
    VACIO: '',
    NOMBRE: 'linuxlearn',
    RUTA: '/var/log/app.log',
    R: '/var/log/app.log'
};
const { vfs } = buildSeed({ now: SHELL_NOW });

const ctx = {
    fs: vfs,
    cwd: AGENT_HOME,
    env: { HOME: AGENT_HOME, USER: 'agente', PATH: '/usr/bin:/bin', HOSTNAME: 'linuxlearn' },
    ifs: ' \t\n',
    lastStatus: 0,
    pid: 4242,
    argumentos: [],
    passwd: { agente: { home: AGENT_HOME }, root: { home: '/root' } },
    globState: { cache: new Map() },
    getVar: (n) => (n in vars ? vars[n] : undefined),
    setVar: (n, v) => { vars[n] = v; },
    runSub: (src) => ({ stdout: src === 'pwd' ? AGENT_HOME + '\n' : '', code: 0 }),
    evalArith: (src) => {
        const m = /^(\d+)\s*([-+*])\s*(\d+)$/.exec(src.replace(/[()]/g, '').trim());
        if (!m) return Number(src.replace(/[^\d]/g, '')) || 0;
        const a = Number(m[1]);
        const b = Number(m[3]);
        return m[2] === '+' ? a + b : m[2] === '-' ? a - b : a * b;
    },
    expand: (texto) => {
        let out = '';
        const mascara = [];
        for (const t of tokenize(texto)) {
            if (t.type !== 'word') continue;
            const r = expandirTramos(ctx, t.parts);
            if (out !== '') { out += ' '; mascara.push(false); }
            out += r.texto;
            mascara.push(...r.mascara);
        }
        return { texto: out, mascara };
    }
};

const palabrasDe = (src) => parseScript(src).body[0].items[0].pipeline.commands[0].words;
const cmd = (src) => expandWords(ctx, palabrasDe(src), { tilde: false });

describe('expansion: variables y comillas', () => {
    it('parte palabras y respeta comillas', () => {
        expect(cmd('echo hola mundo')).toEqual(['echo', 'hola', 'mundo']);
        expect(cmd('echo "a b"')).toEqual(['echo', 'a b']);
        expect(cmd("echo 'a  b'")).toEqual(['echo', 'a  b']);
        expect(cmd('echo a "b c" d')).toEqual(['echo', 'a', 'b c', 'd']);
        expect(cmd('echo a\\ b')).toEqual(['echo', 'a b']);
        expect(cmd('echo pre"$NOMBRE"post')).toEqual(['echo', 'prelinuxlearnpost']);
    });

    it('sustituye variables y parametros', () => {
        expect(cmd('echo $NOMBRE')).toEqual(['echo', 'linuxlearn']);
        expect(cmd('echo "$NOMBRE/x"')).toEqual(['echo', 'linuxlearn/x']);
        expect(cmd('echo ${#NOMBRE}')).toEqual(['echo', '10']);
        expect(cmd('echo ${VACIO:-pordefecto}')).toEqual(['echo', 'pordefecto']);
        expect(cmd('echo ${NOMBRE:-nada}')).toEqual(['echo', 'linuxlearn']);
        expect(cmd('echo ${NOMBRE:0:4}')).toEqual(['echo', 'linu']);
        expect(cmd('echo ${NOMBRE^^} ${NOMBRE^}')).toEqual(['echo', 'LINUXLEARN', 'Linuxlearn']);
        expect(() => cmd('echo ${#VACIO:-7}')).toThrow(/bad substitution/);
    });

    it('recorta prefijos y sufijos', () => {
        expect(cmd('echo ${RUTA##*/}')).toEqual(['echo', 'app.log']);
        expect(cmd('echo ${RUTA%/*}')).toEqual(['echo', '/var/log']);
        expect(cmd('echo ${RUTA#*/}')).toEqual(['echo', 'var/log/app.log']);
        expect(cmd('echo ${RUTA%%.*}')).toEqual(['echo', '/var/log/app']);
        expect(cmd('echo ${RUTA%%/*}')).toEqual(['echo', '']);
    });

    it('sustituye dentro de cadenas', () => {
        expect(cmd('echo ${R/%log/LOGS} ${R#li} ${R//log/LOGS}')).toEqual([
            'echo', '/var/log/app.LOGS', '/var/log/app.log', '/var/LOGS/app.LOGS'
        ]);
        expect(cmd('echo ${NOMBRE//l/L} ${NOMBRE:2}')).toEqual(['echo', 'LinuxLearn', 'nuxlearn']);
        expect(cmd('echo ${VACIO:-"a b"}')).toEqual(['echo', 'a b']);
        expect(cmd('echo ${VACIO:-$NOMBRE}')).toEqual(['echo', 'linuxlearn']);
    });

    it('valores especiales, aritmetica y sustituciones', () => {
        expect(cmd('echo $?')).toEqual(['echo', '0']);
        expect(cmd('echo $1')).toEqual(['echo', '']);
        expect(cmd('echo $((2+3))')).toEqual(['echo', '5']);
        expect(cmd('echo $(pwd)')).toEqual(['echo', AGENT_HOME]);
        expect(cmd('echo `pwd`')).toEqual(['echo', AGENT_HOME]);
    });

    it('posicionales con comillas', () => {
        ctx.argumentos = ['uno', 'dos tres', 'cuatro'];
        expect(cmd('echo $@')).toEqual(['echo', 'uno', 'dos', 'tres', 'cuatro']);
        expect(cmd('echo "$@"')).toEqual(['echo', 'uno', 'dos tres', 'cuatro']);
        expect(cmd('echo "$*"')).toEqual(['echo', 'uno dos tres cuatro']);
        expect(cmd('echo pre"$@"post')).toEqual(['echo', 'preuno', 'dos tres', 'cuatropost']);
        expect(cmd('echo $#')).toEqual(['echo', '3']);
        ctx.argumentos = [];
    });
});

describe('expansion: llaves, campos y comodines', () => {
    it('expande listas y rangos', () => {
        expect(expandBraces('a{b,c}d')).toEqual(['abd', 'acd']);
        expect(expandBraces('f{1..3}.txt')).toEqual(['f1.txt', 'f2.txt', 'f3.txt']);
        expect(expandBraces('f{01..03}')).toEqual(['f01', 'f02', 'f03']);
        expect(expandBraces('f{3..1..2}')).toEqual(['f3', 'f1']);
        expect(expandBraces('{a,b}{1,2}')).toEqual(['a1', 'a2', 'b1', 'b2']);
        expect(expandBraces('{unico}')).toEqual(['{unico}']);
    });

    it('divide campos por IFS y respeta limites de $@', () => {
        const campos = dividirCampos('a b  c', [0, 0, 0, 0, 0], ' \t\n').map((c) => c.texto);
        expect(campos).toEqual(['a', 'b', 'c']);
        const conLimites = dividirCampos('uno dos tres', new Array(13).fill(1), ' \t\n', new Set([4, 8]));
        expect(conLimites.map((c) => c.texto)).toEqual(['uno', 'dos', 'tres']);
    });

    it('traduce patrones de shell a regex', () => {
        expect(globAPatron('*.log', { ruta: true })).toBe('[^/]*\\.log');
        expect(globAPatron('a?c', { ruta: true })).toBe('a[^/]c');
        expect(globAPatron('*.log')).toBe('.*\\.log');
        expect(globAPatron('[ab]x')).toBe('[ab]x');
        expect(globAPatron('[!ab]x')).toBe('[^ab]x');
    });

    it('expande comodines contra el sistema de ficheros', () => {
        ctx.cwd = '/var/log';
        expect(cmd('echo *.log')).toEqual(['echo', 'acceso.log', 'app.log']);
        expect(cmd('echo app.*')).toEqual(['echo', 'app.log']);
        expect(cmd('echo noexiste*')).toEqual(['echo', 'noexiste*']);
        expect(cmd('echo "*.log"')).toEqual(['echo', '*.log']);
        expect(cmd('echo "*".log')).toEqual(['echo', '*.log']);
        expect(cmd('echo "a"*')).toEqual(['echo', 'acceso.log', 'app.log']);
        expect(cmd('echo /*')).toEqual(['echo', '/bin', '/etc', '/home', '/tmp', '/var']);
        expect(cmd('echo /et?')).toEqual(['echo', '/etc']);
        expect(cmd('echo /var/../etc')).toEqual(['echo', '/var/../etc']);
        ctx.cwd = AGENT_HOME;
    });

    it('expande ~ en la primera posicion', () => {
        const contexto = { ...ctx, cwd: AGENT_HOME };
        const salida = expandWords(contexto, palabrasDe('echo ~ ~/notas').slice(1),
            { glob: false, brace: false, split: false });
        expect(salida).toEqual([AGENT_HOME, AGENT_HOME + '/notas']);
    });
});

import { describe, it, expect } from 'vitest';
import { parseScript } from '../src/engine/parser.js';

const one = (src) => parseScript(src).body[0];
const firstCmd = (list) => list.items[0].pipeline.commands[0];
const words = (node) => node.words.map((w) => w.parts.map((p) => p.v ?? p.name).join(''));

describe('parser: construccion del AST', () => {
    it('lee asignaciones previas al comando', () => {
        const assigns = firstCmd(one('a=1 b=2 env'));
        expect(assigns.assigns.map((a) => a.name)).toEqual(['a', 'b']);
        expect(assigns.assigns[0].word.parts).toEqual([{ k: 'lit', v: '1', q: false }]);
        expect(assigns.assigns[1].word.parts).toEqual([{ k: 'lit', v: '2', q: false }]);
        expect(assigns.words).toHaveLength(1);
        expect(assigns.words[0].parts).toEqual([{ k: 'lit', v: 'env', q: false }]);
    });

    it('una asignacion con sustitucion no lleva palabras', () => {
        const cmd = firstCmd(one('x=$(ls -d /e*)'));
        expect(cmd.assigns).toHaveLength(1);
        expect(cmd.assigns[0].name).toBe('x');
        expect(cmd.assigns[0].word.parts[0].k).toBe('sub');
        expect(cmd.words).toHaveLength(0);
    });

    it('while con redireccion de entrada', () => {
        const cmd = firstCmd(one('while read -r l; do echo "$l"; done < /etc/passwd'));
        expect(cmd.type).toBe('while');
        expect(cmd.redirects).toHaveLength(1);
        expect(cmd.redirects[0].op).toBe('<');
        expect(cmd.redirects[0].target.parts[0].v).toBe('/etc/passwd');
    });

    it('funciones en forma corta y con la palabra function', () => {
        const corta = one('greet() {\n  echo hola\n}\ngreet mundo');
        expect(corta.items).toHaveLength(2);
        expect(corta.items[0].pipeline.commands[0].type).toBe('function');
        expect(corta.items[0].pipeline.commands[0].name).toBe('greet');
        expect(corta.items[1].pipeline.commands[0].words[0].parts[0].v).toBe('greet');

        const larga = one('function suma {\n  echo ok\n}\nsuma 2 3');
        expect(larga.items[0].pipeline.commands[0].type).toBe('function');
        expect(larga.items[0].pipeline.commands[0].name).toBe('suma');
    });

    it('grupos y subprocesos', () => {
        expect(firstCmd(one('{ cd /tmp; pwd; }')).type).toBe('group');
        expect(firstCmd(one('{ cd /tmp; pwd; }')).body).toHaveLength(2);
        const sub = firstCmd(one('( cd /tmp; pwd )'));
        expect(sub.type).toBe('subshell');
        expect(sub.body).toHaveLength(2);
    });

    it('here-doc con sangrado con tabuladores', () => {
        const guion = one('cat > salida.txt <<-FIN\n\tsangrado\n\tFIN\necho listo');
        expect(guion.items[0].pipeline.commands[0].redirects).toHaveLength(2);
        expect(guion.items[0].pipeline.commands[0].redirects[1].heredoc.body).toBe('sangrado\n');
        expect(guion.items[1].pipeline.commands[0].words[0].parts[0].v).toBe('echo');
    });

    it('el ; de find -exec no separa ordenes', () => {
        const cmd = firstCmd(one('find . -exec wc -l {} \\;'));
        expect(words(cmd)).toEqual(['find', '.', '-exec', 'wc', '-l', '{}', ';']);
    });

    it('las llaves de expansion no se parten como palabras', () => {
        expect(words(firstCmd(one('echo {a,b}c')))).toEqual(['echo', '{a,b}c']);
        expect(words(firstCmd(one('echo {a,b} ${c}')))).toEqual(['echo', '{a,b}', 'c']);
    });

    it('respeta comillas simples dentro de un programa awk', () => {
        expect(words(firstCmd(one("awk '{print $1}' /etc/passwd"))))
            .toEqual(['awk', '{print $1}', '/etc/passwd']);
    });

    it('parametros entre llaves', () => {
        expect(firstCmd(one('echo ${HOME}/x "${n:-0}" ${#HOME}')).words.map((w) => w.parts)).toEqual([
            [{ k: 'lit', v: 'echo', q: false }],
            [{ k: 'param', name: 'HOME' }, { k: 'lit', v: '/x', q: false }],
            [{ k: 'param', name: 'n', offset: null, op: ':-', arg: '0', q: true }],
            [{ k: 'param', name: 'HOME', op: '#len' }]
        ]);
    });

    it('listas con &&, ||, ; y comentarios', () => {
        const lista = one('echo a && echo b || echo c; echo d # nada').items;
        expect(lista).toHaveLength(4);
        expect(lista[0].op).toBe(null);
        expect(lista[1].op).toBe('&&');
        expect(lista[2].op).toBe('||');
        expect(lista[3].op).toBe(null);
        expect(words(lista[3].pipeline.commands[0])).toEqual(['echo', 'd']);
    });

    it('case, if con elif y continue de linea', () => {
        const cas = one('case $1 in\n  a) echo A ;;\n  b|c) echo BC ;;\n  *) echo otro ;;\nesac');
        const nodo = firstCmd(cas);
        expect(nodo.type).toBe('case');
        expect(nodo.clauses).toHaveLength(3);
        expect(nodo.clauses.map((c) => c.patterns.map((p) => p.raw))).toEqual([['a'], ['b', 'c'], ['*']]);
        expect(words(nodo.clauses[0].body[0].pipeline.commands[0])).toEqual(['echo', 'A']);

        const cond = one('if [ -f /etc/passwd ]; then\n  echo existe\nelse\n  echo falta\nfi');
        expect(firstCmd(cond).type).toBe('if');
        expect(firstCmd(cond).branches).toHaveLength(1);
        expect(firstCmd(cond).else).toHaveLength(1);

        const multilinea = one('for f in *.txt\ndo\n  echo "$f"\ndone');
        expect(firstCmd(multilinea).type).toBe('for');
        expect(firstCmd(multilinea).body).toHaveLength(1);
    });

    it('tuberias, negacion y redirecciones de descriptor', () => {
        const tuberia = one('ls -l 2>&1 | grep total').items[0].pipeline;
        expect(tuberia.type).toBe('pipeline');
        expect(tuberia.commands).toHaveLength(2);
        expect(tuberia.commands[0].redirects[0].op).toBe('>&');
        expect(tuberia.commands[0].redirects[0].fd).toBe(2);
        expect(one('! grep -q x f').items[0].pipeline.negated).toBe(true);
    });

    it('contiene errores de sintaxis reales', () => {
        expect(() => parseScript('if [ -f x ]; then')).toThrow(/expected 'fi'/);
        expect(() => parseScript('case x in')).toThrow();
        expect(() => parseScript('for x')).toThrow();
    });
});

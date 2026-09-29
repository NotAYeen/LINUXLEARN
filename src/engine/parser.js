/**
 * Sintaxis de las ordenes de shell.
 *
 * Parser descendente recursivo sobre las lineas fisicas del guion. El AST es:
 *
 *   script  -> list*
 *   list    -> pipeline (('&&' | '||' | ';' | '&') pipeline)*
 *   pipeline-> ['!'] simple ('|' simple)*
 *   simple  -> asignaciones palabras redirecciones | if | for | while | case
 *            | { ... } | ( ... ) | definicion de funcion
 *
 * Aqui no se ejecuta nada: solo se construye el arbol. La ejecucion vive en
 * `shell.js`.
 */

import { tokenize, ShellSyntax } from './lexer.js';

const NO_OPS = new Set();
const NAME_RE = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const ASSIGN_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

const REDIRECT_RE = /^(\d*)(>>|>|<<-|<|<<|>&|<&|&>>|&>)$/;

/** El operador `v` de este token abre una redireccion. */
function isRedirectOp(v) {
    return typeof v === 'string' && REDIRECT_RE.test(v);
}

export function parseScript(text) {
    const p = new Parser(text);
    return p.parse();
}

class Parser {
    constructor(text) {
        this.lines = joinContinuations(String(text).replace(/\r\n/g, '\n').split('\n'));
        this.li = 0;
        this.tokens = [];
        this.ti = 0;
        this.afterLine = -1;
        this.heredocCursor = -1;
    }

    // ---------- acceso a tokens ----------

    loadLine(i) {
        this.li = i;
        this.tokens = tokenize(this.lines[i] == null ? '' : this.lines[i]);
        this.ti = 0;
    }

    /** Salta a la siguiente linea con contenido,Saltando los cuerpos de here-doc. */
    nextLine() {
        let i = this.li + 1;
        if (i <= this.afterLine) i = this.afterLine + 1;
        this.loadLine(i);
    }

    atEndOfLine() { return this.ti >= this.tokens.length; }
    atEndOfInput() { return this.li >= this.lines.length; }

    peek(offset = 0) { return this.tokens[this.ti + offset] || null; }
    peekOp(offset = 0) {
        const t = this.peek(offset);
        return t && t.type === 'op' ? t.v : null;
    }
    peekWord(offset = 0) {
        const t = this.peek(offset);
        return t && t.type === 'word' ? t : null;
    }
    /** Texto literal de la palabra actual, sin expandir. */
    peekLiteral(offset = 0) {
        const w = this.peekWord(offset);
        if (!w) return null;
        return w.parts.every((p) => p.k === 'lit') ? w.parts.map((p) => p.v).join('') : null;
    }
    next() { return this.tokens[this.ti++] || null; }
    eatOp(v) { if (this.peekOp() === v) { this.ti++; return true; } return false; }
    eatWord() { const t = this.peek(); if (t && t.type === 'word') { this.ti++; return t; } return null; }
    expectOp(v) {
        if (!this.eatOp(v)) throw new ShellSyntax(`syntax error near unexpected token (expected '${v}')`);
    }
    expectWord() {
        const w = this.eatWord();
        if (!w) throw new ShellSyntax(`syntax error near unexpected token '${this.peekOp() || this.peekLiteral() || ''}'`);
        return w;
    }

    skipSeparators() {
        while (this.peekOp() === ';' || this.peekOp() === '&') this.ti++;
    }

    lineIsBlank(i) {
        const line = this.lines[i];
        if (line == null) return true;
        return tokenize(line).length === 0;
    }

    /** Busca la siguiente linea con contenido a partir de `from`. */
    findContentLine(from) {
        let i = from;
        while (i < this.lines.length && tokenize(this.lines[i]).length === 0) i++;
        return i;
    }

    // ----------Gramatica ----------

    parse() {
        const body = [];
        this.loadLine(0);
        let guard = 0;
        while (this.li < this.lines.length) {
            if (++guard > 100000) throw new ShellSyntax('script demasiado largo');
            this.skipSeparators();
            if (this.atEndOfLine()) { this.nextLine(); continue; }
            const list = this.parseList(new Set());
            if (list) body.push(list);
            if (this.atEndOfInput()) break;
            this.nextLine();
        }
        return { type: 'script', body };
    }

    /**
     * Lista de tuberias unidas por `&&`, `||`, `;` o `&`. Se detiene cuando
     * aparece una palabra de `stops` (then, do, done, fi, esac, }) o cuando
     * se acaba el guion.
     */
    parseList(stops, stopOps = NO_OPS) {
        const items = [];
        let op = null;
        let guard = 0;
        for (;;) {
            if (++guard > 100000) throw new ShellSyntax('bucle de sintaxis');
            this.skipSeparators();
            if (this.atEndOfLine()) {
                if (this.atEndOfInput()) break;
                const target = this.findContentLine(this.li + 1 > this.afterLine ? this.li + 1 : this.afterLine + 1);
                if (target >= this.lines.length) { this.loadLine(this.lines.length - 1); break; }
                const head = this.stopAtHead(target, stops, stopOps);
                if (head) { this.loadLine(target); return { items, stop: head, op }; }
                this.nextLine();
                if (op === '&&' || op === '||') op = ';';
                continue;
            }
            const stop = this.stopHere(stops, stopOps);
            if (stop) return { items, stop, op };
            const pipe = this.parsePipeline(stops, stopOps);
            if (!pipe) break;
            items.push({ op, pipeline: pipe });
            const nxt = this.peekOp();
            if (nxt === '&&' || nxt === '||' || nxt === ';' || nxt === '&') {
                this.ti++;
                op = nxt;
                if (op === ';') op = null;
                continue;
            }
            op = null;
            if (this.atEndOfLine()) continue;
            const trailing = this.stopHere(stops, stopOps);
            if (trailing) return { items, stop: trailing, op: null };
            if (this.peekOp()) {
                throw new ShellSyntax(`syntax error near unexpected token '${this.peekOp()}'`);
            }
        }
        return { items, stop: null, op: null };
    }

    /** Palabra u operador de cierre que hay justo aqui. */
    stopHere(stops, stopOps) {
        const o = this.peekOp();
        if (o && stopOps.has(o)) return o;
        const lit = this.peekLiteral();
        if (lit && stops.has(lit)) return lit;
        return null;
    }

    /** Lo mismo, pero mirando el primer token de la linea `index`. */
    stopAtHead(index, stops, stopOps) {
        const head = tokenize(this.lines[index]);
        if (!head.length) return null;
        if (head[0].type === 'op') return stopOps.has(head[0].v) ? head[0].v : null;
        const lit = head[0].type === 'word' ? wordLiteral(head[0]) : null;
        return lit && stops.has(lit) ? lit : null;
    }

    parsePipeline(stops, stopOps) {
        const commands = [];
        let negated = false;
        for (;;) {
            const cabeza = this.peekWord();
            if (cabeza && wordLiteral(cabeza) === '!' && cabeza.parts.every((p) => p.k === 'lit' && !p.q)) {
                this.ti++;
                negated = !negated;
                continue;
            }
            break;
        }
        for (;;) {
            const simple = this.parseSimple(stops, stopOps);
            if (!simple) return commands.length ? { type: 'pipeline', commands, negated } : null;
            if (simple.type !== 'simple') this.attachRedirects(simple);
            commands.push(simple);
            if (this.peekOp() === '|') { this.ti++; continue; }
            break;
        }
        return { type: 'pipeline', commands, negated };
    }

    /** `if ...; fi < fichero` aplica la redireccion al grupo completo. */
    attachRedirects(node) {
        while (isRedirectOp(this.peekOp())) node.redirects = [...(node.redirects || []), this.parseRedirect()];
        return node;
    }

    parseSimple(stops, stopOps) {
        if (this.atEndOfLine()) return null;
        const op = this.peekOp();
        if (op === ')' || op === ';;') return null;
        if (op === '(') return this.parseSubshell(stops);
        if (op === '{') return this.parseGroup(stops);

        const head = this.peekWord();
        if (head) {
            const lit = wordLiteral(head);
            if (lit === 'if') return this.parseIf(stops);
            if (lit === 'for') return this.parseFor(stops);
            if (lit === 'while' || lit === 'until') return this.parseWhile(lit, stops);
            if (lit === 'case') return this.parseCase(stops);
            if (lit === 'function') return this.parseFunctionKeyword(stops);
            if (NAME_RE.test(lit) && this.peekOp(1) === '(' && this.peekOp(2) === ')') {
                return this.parseFunctionShort(stops);
            }
        }
        return this.parseCommandWords(stops);
    }

    parseCommandWords(stops) {
        const assigns = [];
        const words = [];
        const redirects = [];
        for (;;) {
            const t = this.peek();
            if (!t) break;
            if (t.type === 'op') {
                if (isRedirectOp(t.v)) { redirects.push(this.parseRedirect()); continue; }
                break;
            }
            if (!words.length) {
                const assign = asAssignment(t);
                if (assign) { assigns.push(assign); this.ti++; continue; }
            }
            words.push(t);
            this.ti++;
        }
        if (!words.length && !assigns.length) return null;
        this.expandRedirectWords(redirects, words);
        return { type: 'simple', assigns, words, redirects };
    }

    /**
     * `find -exec sh -c ... \;`: el `;` (o `+`) que cierra el `-exec` no es un
     * separador de ordenes, asi que se esconde antes de analizar redirecciones.
     */
    expandRedirectWords(redirects, words) {
        const execIdx = words.findIndex((w) => wordLiteral(w) === '-exec' || wordLiteral(w) === '-execdir');
        if (execIdx < 0) return;
        for (let i = execIdx + 1; i < words.length; i++) {
            const lit = wordLiteral(words[i]);
            if (lit === ';' || lit === '+') {
                words[i] = { type: 'word', parts: [{ k: 'lit', v: lit, q: true }], raw: lit, hidden: true };
            }
        }
    }

    parseRedirect() {
        const op = this.next().v;
        const m = /^(\d*)(.*)$/.exec(op);
        const fd = m[1] === '' ? null : Number(m[1]);
        const base = m[2];
        const kind = base === '>>' ? '>>' : base;
        if (base === '>&' || base === '<&') {
            const target = this.eatWord();
            return { fd: fd == null ? 1 : fd, op: base, target, dup: true };
        }
        if (base === '<<' || base === '<<-') {
            const delim = this.expectWord();
            const delimLit = wordLiteral(delim);
            const strip = base === '<<-';
            const start = Math.max(this.li + 1, this.heredocCursor < 0 ? 0 : this.heredocCursor);
            const body = [];
            let j = start;
            for (; j < this.lines.length; j++) {
                const candidate = strip ? this.lines[j].replace(/^\t+/, '') : this.lines[j];
                if (candidate === delimLit) break;
                body.push(strip ? candidate : this.lines[j]);
            }
            if (j >= this.lines.length) throw new ShellSyntax(`warning: here-document delimited by end-of-file (wanted \`${delimLit}')`);
            this.heredocCursor = j + 1;
            this.afterLine = Math.max(this.afterLine, j);
            return { fd: 0, op: base, heredoc: { delim: delimLit, body: body.join('\n') + '\n' } };
        }
        const target = this.expectWord();
        if (base === '&>' || base === '&>>') {
            return { fd: '&', op: base === '&>' ? '>' : '>>', target };
        }
        return { fd: fd == null ? (kind === '<' ? 0 : 1) : fd, op: kind, target };
    }

    // ---------- construcciones compuestas ----------

    parseIf(stops) {
        this.ti++;
        const branches = [];
        const cond = this.parseList(new Set(['then']));
        if (cond.stop !== 'then') throw new ShellSyntax("syntax error: expected 'then'");
        this.ti++;
        const thenBody = this.parseList(new Set(['elif', 'else', 'fi']));
        branches.push({ cond: cond.items, body: thenBody.items });
        let elseBody = null;
        for (;;) {
            const lit = this.peekLiteral();
            if (lit === 'elif') {
                this.ti++;
                const c = this.parseList(new Set(['then']));
                if (c.stop !== 'then') throw new ShellSyntax("syntax error: expected 'then'");
                this.ti++;
                const b = this.parseList(new Set(['elif', 'else', 'fi']));
                branches.push({ cond: c.items, body: b.items });
                continue;
            }
            if (lit === 'else') {
                this.ti++;
                const b = this.parseList(new Set(['fi']));
                elseBody = b.items;
                continue;
            }
            if (lit === 'fi') { this.ti++; break; }
            if (this.atEndOfInput()) throw new ShellSyntax("syntax error: unexpected end of file, expected 'fi'");
            this.nextLine();
        }
        return { type: 'if', branches, else: elseBody };
    }

    parseFor(stops) {
        this.ti++;
        const name = wordLiteral(this.expectWord());
        if (!NAME_RE.test(name)) throw new ShellSyntax(`syntax error near unexpected token in for`);
        let words = [];
        if (this.peekLiteral() === 'in') {
            this.ti++;
            words = this.readWordRun(new Set(['do', ';', '&&', '||']));
        }
        this.eatOp(';');
        if (this.peekLiteral() !== 'do') {
            if (this.atEndOfLine() || this.atEndOfInput()) this.nextLine();
        }
        if (this.peekLiteral() !== 'do') throw new ShellSyntax("syntax error: expected 'do'");
        this.ti++;
        const body = this.parseList(new Set(['done']));
        if (body.stop !== 'done') throw new ShellSyntax("syntax error: expected 'done'");
        this.ti++;
        return { type: 'for', name, words, body: body.items };
    }

    parseWhile(keyword, stops) {
        this.ti++;
        const cond = this.parseList(new Set(['do']));
        if (cond.stop !== 'do') throw new ShellSyntax("syntax error: expected 'do'");
        this.ti++;
        const body = this.parseList(new Set(['done']));
        if (body.stop !== 'done') throw new ShellSyntax("syntax error: expected 'done'");
        this.ti++;
        return { type: keyword === 'until' ? 'until' : 'while', cond: cond.items, body: body.items };
    }

    parseCase(stops) {
        this.ti++;
        const subject = this.expectWord();
        this.eatOp(';');
        if (this.peekLiteral() !== 'in') {
            if (this.atEndOfLine()) this.nextLine();
        }
        if (this.peekLiteral() !== 'in') throw new ShellSyntax("syntax error: expected 'in'");
        this.ti++;
        const clauses = [];
        let guard = 0;
        let cerrado = false;
        for (;;) {
            if (++guard > 10000) throw new ShellSyntax('case demasiado largo');
            this.skipSeparators();
            if (this.atEndOfLine()) {
                if (this.atEndOfInput()) break;
                const target = this.findContentLine(this.li + 1);
                if (target >= this.lines.length) break;
                this.loadLine(target);
                continue;
            }
            const lit = this.peekLiteral();
            if (lit === 'esac') { this.ti++; cerrado = true; break; }
            if (this.peekOp() === ';;') { this.ti++; continue; }
            const patterns = [];
            for (;;) {
                const w = this.eatWord();
                if (!w) break;
                patterns.push(w);
                if (this.peekOp() === '|') { this.ti++; continue; }
                break;
            }
            this.expectOp(')');
            const body = this.parseList(new Set(['esac']), new Set([';;']));
            clauses.push({ patterns, body: body.items });
            if (body.stop === 'esac') { this.ti++; cerrado = true; break; }
            if (body.stop === ';;') { this.ti++; continue; }
            if (this.atEndOfInput()) break;
        }
        if (!cerrado) throw new ShellSyntax("syntax error: unexpected end of file, expected 'esac'");
        return { type: 'case', subject, clauses };
    }

    parseGroup(stops) {
        this.ti++;
        const body = this.parseList(new Set(), new Set(['}']));
        if (body.stop !== '}') throw new ShellSyntax("syntax error: expected '}'");
        this.ti++;
        this.eatOp(';');
        return { type: 'group', body: body.items };
    }

    parseSubshell(stops) {
        this.ti++;
        const body = this.parseList(new Set(), new Set([')']));
        if (body.stop !== ')') throw new ShellSyntax("syntax error: expected ')'");
        this.ti++;
        return { type: 'subshell', body: body.items };
    }

    parseFunctionShort(stops) {
        const name = wordLiteral(this.eatWord());
        this.ti += 2;
        const fn = this.parseCompoundBody();
        return { type: 'function', name, body: fn };
    }

    parseFunctionKeyword(stops) {
        this.ti++;
        const name = wordLiteral(this.expectWord());
        if (this.peekOp() === '(') { this.ti += 2; }
        const fn = this.parseCompoundBody();
        return { type: 'function', name, body: fn };
    }

    parseCompoundBody() {
        this.eatOp(';');
        if (this.atEndOfLine()) this.nextLine();
        if (this.peekOp() === '{') {
            this.ti++;
            const body = this.parseList(new Set(), new Set(['}']));
            if (body.stop !== '}') throw new ShellSyntax("syntax error: expected '}'");
            this.ti++;
            return body.items;
        }
        throw new ShellSyntax("syntax error near unexpected token (expected '{')");
    }

    readWordRun(stops) {
        const out = [];
        for (;;) {
            const t = this.peek();
            if (!t) break;
            if (t.type === 'op') {
                if (stops.has(t.v)) break;
                break;
            }
            const lit = wordLiteral(t);
            if (lit && stops.has(lit)) break;
            out.push(t);
            this.ti++;
        }
        return out;
    }
}

function wordLiteral(word) {
    if (!word || !word.parts) return null;
    if (!word.parts.every((p) => p.k === 'lit')) return null;
    return word.parts.map((p) => p.v).join('');
}

/**
 * `X=valor` es una asignacion si el nombre es valido. El valor conserva el
 * resto de tramos, de modo que `x=$(ls)` y `x=$HOME/notes` se guardan tal cual.
 */
function asAssignment(word) {
    const first = word.parts[0];
    if (!first || first.k !== 'lit') return null;
    const eq = first.v.indexOf('=');
    if (eq <= 0) return null;
    const name = first.v.slice(0, eq);
    if (!ASSIGN_NAME_RE.test(name)) return null;
    const value = { type: 'word', parts: [] };
    const tail = first.v.slice(eq + 1);
    if (tail !== '') value.parts.push({ k: 'lit', v: tail, q: first.q });
    for (const p of word.parts.slice(1)) value.parts.push(p);
    return { name, word: value };
}

/** Une lineas terminadas en `\` con la siguiente. */
function joinContinuations(lines) {
    const out = [];
    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        while (hasOddTrailingBackslash(line) && i + 1 < lines.length) {
            line = line.replace(/\\$/, '') + lines[++i];
        }
        out.push(line);
    }
    return out;
}

function hasOddTrailingBackslash(line) {
    let n = 0;
    for (let i = line.length - 1; i >= 0 && line[i] === '\\'; i--) n++;
    return n % 2 === 1;
}

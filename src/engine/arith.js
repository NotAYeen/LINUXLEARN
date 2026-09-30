/**
 * Evaluador de la aritmetica de bash: `$(( ))`, y tambien `let`, `(( ))` y los
 * operandos numericos de `test`.
 *
 * No es una calculadora: reproduce los operadores, la precedencia y el
 * cortocircuito de bash, porque el alumno compara la salida con su terminal de
 * verdad.
 *
 * Mensajes de bash 5.2:
 *   bash: 1 +  : arithmetic syntax error: operand expected (error token is "+ ")
 *   bash: 1 / 0: division by 0 (error token is "0")
 */

import { ShellError, EXIT_ERROR } from './errors.js';

/** Precedencia de mas a menos: `||` es el mas flojo, `**` el mas fuerte. */
const PRECEDENCIA = {
    '||': 1, '&&': 2,
    '|': 3, '^': 4, '&': 5,
    '==': 6, '!=': 6,
    '<': 7, '<=': 7, '>': 7, '>=': 7,
    '<<': 8, '>>': 8,
    '+': 9, '-': 9,
    '*': 10, '/': 10, '%': 10,
    '**': 11
};

/** Convierte un operando de bash en entero de 32 bits con signo. */
function valor(token) {
    const texto = token === null || token === undefined ? '' : String(token).trim();
    if (texto === '') {
        throw new ShellError('operand expected (error token is "")', EXIT_ERROR);
    }
    if (/^[+-]?0[xX][0-9a-fA-F]+$/.test(texto)) return parseInt(texto, 16) | 0;
    if (/^[+-]?0[0-7]+$/.test(texto)) return parseInt(texto.replace('+', ''), 8) | 0;
    if (/^[+-]?\d+$/.test(texto)) return parseInt(texto, 10) | 0;
    // En aritmetica no hay expansion previa: un nombre llega aqui como texto y
    // se resuelve con su valor actual. Un nombre vacio vale 0.
    if (/^[A-Za-z_][A-Za-z_0-9]*(\[[^\]]+\])?$/.test(texto) || /^\$(?:[A-Za-z_][A-Za-z_0-9]*|[0-9]+)$/.test(texto)) {
        // `$(( $1 * 2 ))` es legal: el nombre se lee sin el dolar.
        const nombre = texto.startsWith('$') ? texto.slice(1) : texto;
        const bruto = this.getVar ? this.getVar(nombre) : undefined;
        if (bruto === undefined || bruto === '') return 0;
        if (/^[+-]?\d+$/.test(String(bruto).trim())) return valor.call(this, bruto);
        throw new ShellError(`value too great for base (error token is "${bruto}")`, EXIT_ERROR);
    }
    throw new ShellError(`invalid arithmetic operator (error token is "${texto}")`, EXIT_ERROR);
}

/** Tokeniza: numeros en base 2..64, nombres, `$nombre` y operadores. */
function tokenizar(src) {
    const s = String(src);
    const tokens = [];
    let i = 0;
    while (i < s.length) {
        const c = s[i];
        if (/\s/.test(c)) { i++; continue; }
        const dos = s.slice(i, i + 2);
        if (PRECEDENCIA[dos] !== undefined) { tokens.push(dos); i += 2; continue; }
        if (c === '++' || c === '--') { tokens.push(c); i += 2; continue; }
        if ('()!,~'.includes(c)) { tokens.push(c); i++; continue; }
        if ('+-*/%<>=&^|'.includes(c)) { tokens.push(c); i++; continue; }
        const resto = s.slice(i);
        const m = /^(\d+#[0-9a-zA-Z@_]+|0[xX][0-9a-fA-F]+|\$[({]?[A-Za-z_0-9]*[)}]?|\d+|[A-Za-z_][A-Za-z_0-9]*)/.exec(resto);
        if (!m) throw new ShellError(`syntax error in expression (error token is "${c}")`, EXIT_ERROR);
        tokens.push(m[0]);
        i += m[0].length;
    }
    return tokens;
}

function aplicar(op, a, b) {
    switch (op) {
        case '+': return (a + b) | 0;
        case '-': return (a - b) | 0;
        case '*': return Math.imul(a, b);
        case '/': if (b === 0) throw new ShellError('division by 0 (error token is "0")', EXIT_ERROR); return (a / b) | 0;
        case '%': if (b === 0) throw new ShellError('division by 0 (error token is "0")', EXIT_ERROR); return a % b | 0;
        case '**': return (a ** b) | 0;
        case '<<': return (a << b) | 0;
        case '>>': return (a >> b) | 0;
        case '&': return a & b;
        case '|': return a | b;
        case '^': return a ^ b;
        default: throw new ShellError(`invalid arithmetic operator (error token is "${op}")`, EXIT_ERROR);
    }
}

/** `==`, `!=`, `<`...: numerico si ambos lo son, si no como cadena. */
function comparar(op, aTexto, bTexto, bNum) {
    const aEsNum = /^[+-]?\d+$/.test(String(aTexto).trim());
    if (op === '==' || op === '!=') {
        const iguales = aEsNum ? aNum(aTexto) === bNum : String(aTexto) === String(bTexto);
        return op === '==' ? (iguales ? 1 : 0) : (iguales ? 0 : 1);
    }
    const a = aEsNum ? aNum(aTexto) : String(aTexto);
    const b = aEsNum ? bNum : String(bTexto);
    switch (op) {
        case '<': return a < b ? 1 : 0;
        case '<=': return a <= b ? 1 : 0;
        case '>': return a > b ? 1 : 0;
        default: return a >= b ? 1 : 0;
    }
}

function aNum(texto) {
    return Number(String(texto).trim());
}

/** Parser descendente recursivo: un metodo por nivel de precedencia. */
class Evaluador {
    constructor(tokens, getVar) {
        this.t = tokens;
        this.i = 0;
        this.getVar = getVar;
    }

    peek() { return this.t[this.i] ?? null; }
    next() { return this.t[this.i++] ?? null; }

    /** `a, b` devuelve el valor de la ultima expresion. */
    coma() {
        let v = this.condicion();
        while (this.peek() === ',') { this.next(); v = this.condicion(); }
        return v;
    }

    /**
     * `&&` y `||`. Bash cortocircuita al EVALUAR, no al leer: el operando
     * derecho siempre se lee del flujo, solo se omite su calculo. Asi que
     * consumimos el derecho y decidimos con el valor del izquierdo.
     */
    condicion() {
        const izq = this.bitwise();
        const op = this.peek();
        if (op !== '&&' && op !== '||') return izq;
        this.next();
        const a = valor.call(this, izq) !== 0;
        const derecha = this.condicion();
        if (op === '&&') return a && valor.call(this, derecha) !== 0 ? 1 : 0;
        return a || valor.call(this, derecha) !== 0 ? 1 : 0;
    }

    bitwise() {
        let izq = this.igualdad();
        for (;;) {
            const op = this.peek();
            if (op === '|' || op === '^' || op === '&') {
                this.next();
                const der = this.igualdad();
                izq = String(aplicar(op, valor.call(this, izq), valor.call(this, der)));
            } else return izq;
        }
    }

    igualdad() {
        let izq = this.relacional();
        for (;;) {
            const op = this.peek();
            if (op === '==') {
                this.next();
                const der = this.relacional();
                izq = String(this.comparar(op, izq, der));
            } else if (op === '!=') {
                this.next();
                const der = this.relacional();
                izq = String(this.comparar('==', izq, der) ? 0 : 1);
            } else return izq;
        }
    }

    relacional() {
        let izq = this.desplazamiento();
        for (;;) {
            const op = this.peek();
            if (op === '<' || op === '<=' || op === '>' || op === '>=') {
                this.next();
                const der = this.desplazamiento();
                izq = String(this.comparar(op, izq, der));
            } else return izq;
        }
    }

    /** Compara usando el valor ya resuelto del operando derecho. */
    comparar(op, izq, der) {
        return comparar(op, izq, der, valor.call(this, der));
    }

    desplazamiento() {
        let izq = this.suma();
        for (;;) {
            const op = this.peek();
            if (op === '<<' || op === '>>') {
                this.next();
                const der = this.suma();
                izq = String(aplicar(op, valor.call(this, izq), valor.call(this, der)));
            } else return izq;
        }
    }

    suma() {
        let izq = this.producto();
        for (;;) {
            const op = this.peek();
            if (op === '+' || op === '-') {
                this.next();
                const der = this.producto();
                izq = String(aplicar(op, valor.call(this, izq), valor.call(this, der)));
            } else return izq;
        }
    }

    producto() {
        let izq = this.potencia();
        for (;;) {
            const op = this.peek();
            if (op === '*' || op === '/' || op === '%') {
                this.next();
                const der = this.potencia();
                izq = String(aplicar(op, valor.call(this, izq), valor.call(this, der)));
            } else return izq;
        }
    }

    potencia() {
        const base = this.unario();
        if (this.peek() === '**') {
            this.next();
            const exp = this.potencia();
            return String(aplicar('**', valor.call(this, base), valor.call(this, exp)));
        }
        return base;
    }

    unario() {
        const op = this.peek();
        if (op === '!') { this.next(); return String(valor.call(this, this.unario()) ? 0 : 1); }
        if (op === '~') { this.next(); return String(~valor.call(this, this.unario())); }
        if (op === '-') { this.next(); return String(-valor.call(this, this.unario())); }
        if (op === '+') { this.next(); return this.unario(); }
        if (op === '++' || op === '--') { this.next(); return this.primario(); }
        return this.primario();
    }

    primario() {
        const t = this.next();
        if (t === null) throw new ShellError('operand expected (error token is "")', EXIT_ERROR);
        if (t === '(') {
            const v = this.coma();
            if (this.next() !== ')') throw new ShellError("expected `)'", EXIT_ERROR);
            return String(v);
        }
        if (t === '++' || t === '--') return String(valor.call(this, this.next()));
        return String(valor.call(this, t));
    }
}

/** Evalua `src`. `getVar` resuelve nombres: el shell se lo pasa para que veas el valor actual. */
export function evaluar(src, getVar) {
    const tokens = tokenizar(src);
    if (!tokens.length) throw new ShellError('operand expected (error token is "")', EXIT_ERROR);
    const ev = new Evaluador(tokens, getVar);
    const v = ev.coma();
    if (ev.peek() !== null) {
        throw new ShellError(`syntax error in expression (error token is "${ev.peek()}")`, EXIT_ERROR);
    }
    return valor.call(ev, v);
}

/** Atajo para `$(( ))` desde el lexer: el numero ya casteado a entero. */
export function evaluarEntero(src, getVar) {
    return Number(evaluar(src, getVar)) | 0;
}

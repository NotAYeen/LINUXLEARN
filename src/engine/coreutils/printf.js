/**
 * printf — imprime con formato estilo C.
 *
 * Mensajes verificados con GNU coreutils 8.32:
 *   bash: printf: usage: printf [-v var] format [arguments]
 *   bash: printf: `x': missing format character
 *
 * Se difference el formato (una vez, como en C) y se reutiliza si sobran
 * argumentos. Es el builtin de bash: `printf '%s\n' a b c` imprime tres lineas.
 */

import { ShellError, EXIT_MISUSE } from '../errors.js';

function error(mensaje) {
    return new ShellError('printf: ' + mensaje, EXIT_MISUSE);
}

export default {
    name: 'printf',
    alias: [],
    synopsis: 'printf FORMAT [ARGUMENT]...',
    run(ctx, argv) {
        const args = argv.slice(1);
        let destino = null;
        let i = 0;
        if (args[0] === '-v') {
            destino = args[1];
            i = 2;
        }
        const formato = args[i];
        if (formato === undefined) {
            throw new ShellError("printf: usage: printf [-v var] format [arguments]", EXIT_MISUSE);
        }
        const valores = args.slice(i + 1);
        const texto = formatear(formato, valores);

        if (destino) {
            ctx.shell.setVar(destino, texto);
            return 0;
        }
        ctx.stdout.write(texto);
        return 0;
    }
};

function formatear(formato, valores) {
    // El builtin de bash repite el formato mientras queden argumentos, como C,
    // pero con la precaucion de parar si una pasada no consume ninguno.
    const estado = { i: 0 };
    if (!valores.length) return aplicar(formato, valores, estado);
    let salida = '';
    for (let vueltas = 0; vueltas < 10000 && estado.i < valores.length; vueltas++) {
        const antes = estado.i;
        salida += aplicar(formato, valores, estado);
        if (estado.i === antes) break;
    }
    return salida;
}

/**
 * Una pasada del formato. `f` recorre el formato y `estado.i` los valores: son
 * dos indices distintos, porque `%s` del formato no avanza la lista de valores
 * (solo lo hace el conversor).
 */
function aplicar(formato, valores, estado) {
    const tomar = () => valores[estado.i++];
    let salida = '';
    let f = 0;
    while (f < formato.length) {
        const c = formato[f];
        if (c === '\\') {
            const sig = formato[f + 1];
            salida += sig === undefined ? '' : (ESCAPES[sig] ?? sig);
            f += 2;
            continue;
        }
        if (c !== '%') { salida += c; f++; continue; }

        const m = /^%([-+ #0']*)(\d+|\*)?(?:\.(\d+|\*))?([diouxXeEfFgGaAcs%b])/.exec(formato.slice(f));
        if (!m) throw error("`" + c + "': missing format character");
        f += m[0].length;
        if (m[4] === '%') { salida += '%'; continue; }

        const [, banderasRaw, anchoRaw, precRaw, conv] = m;
        const ancho = anchoRaw === '*' ? Math.trunc(Number(tomar() ?? 0)) : (anchoRaw ? Number(anchoRaw) : 0);
        const precision = precRaw === '*' ? Math.trunc(Number(tomar() ?? 0)) : (precRaw !== undefined ? Number(precRaw) : undefined);
        const menos = banderasRaw.includes('-');
        const cero = banderasRaw.includes('0') && !menos;

        if (conv === 'b') {
            const s = textoDe(tomar());
            salida += formatear(s.replace(/\\(.)/g, (todo, ch) => ESCAPES[ch] ?? ch), []);
            continue;
        }
        const bruto = tomar();
        let cuerpo;
        switch (conv) {
            case 'd': case 'i': cuerpo = String(Math.trunc(Number(bruto ?? 0))); break;
            case 'u': cuerpo = String(Math.abs(Math.trunc(Number(bruto ?? 0)))); break;
            case 'o': cuerpo = Math.trunc(Number(bruto ?? 0)).toString(8); break;
            case 'x': cuerpo = Math.trunc(Number(bruto ?? 0)).toString(16); break;
            case 'X': cuerpo = Math.trunc(Number(bruto ?? 0)).toString(16).toUpperCase(); break;
            case 'f': case 'F': cuerpo = Number(bruto ?? 0).toFixed(precision ?? 6); break;
            case 'e': cuerpo = Number(bruto ?? 0).toExponential(precision ?? 6); break;
            case 'E': cuerpo = Number(bruto ?? 0).toExponential(precision ?? 6).toUpperCase(); break;
            case 'g': cuerpo = corto(Number(bruto ?? 0), precision ?? 6); break;
            case 'G': cuerpo = corto(Number(bruto ?? 0), precision ?? 6).toUpperCase(); break;
            case 'c': cuerpo = String.fromCharCode(Math.trunc(Number(bruto ?? 0))); break;
            case 's': cuerpo = bruto === undefined ? '' : textoDe(bruto); break;
            case 'a': cuerpo = hexFloats(Number(bruto ?? 0)); break;
            case 'A': cuerpo = hexFloats(Number(bruto ?? 0)).toUpperCase(); break;
            default: cuerpo = textoDe(bruto);
        }
        if (precision !== undefined && (conv === 's' || conv === 'd' || conv === 'i')) {
            cuerpo = cuerpo.slice(0, precision);
        }
        if (banderasRaw.includes('+') && /^[\d.]/.test(cuerpo)) cuerpo = '+' + cuerpo;
        if (cuerpo.length < ancho) {
            const relleno = (cero && !menos) ? '0' : ' ';
            cuerpo = menos ? cuerpo + relleno.repeat(ancho - cuerpo.length) : relleno.repeat(ancho - cuerpo.length) + cuerpo;
        }
        salida += cuerpo;
    }
    return salida;
}

const ESCAPES = { n: '\n', t: '\t', r: '\r', a: '\x07', b: '\b', f: '\f', v: '\v', '\\': '\\', '"': '"', "'": "'" };

function textoDe(v) {
    if (typeof v === 'string') return v;
    if (typeof v === 'number') return String(v);
    if (v === null || v === undefined) return '';
    return String(v);
}

/** `%g`: seis cifras significativas, notacion exponencial si hace falta. */
function corto(n, precision) {
    if (n === 0) return '0';
    const exponente = Math.floor(Math.log10(Math.abs(n)));
    if (exponente < -4 || exponente >= precision) {
        return n.toExponential(precision - 1).replace(/\.?0+e/, 'e');
    }
    return String(Number(n.toPrecision(precision)));
}

/** `%a`: notacion hexadecimal de coma flotante, como en C99. */
function hexFloats(n) {
    if (Number.isInteger(n)) return '0x1.' + '0'.repeat(11) + 'p+0';
    const buffer = new DataView(new ArrayBuffer(8));
    buffer.setFloat64(0, n);
    let bits = buffer.getBigUint64(0).toString(16).padStart(16, '0');
    const signo = bits[0] === '1' ? '-' : '';
    const exponente = parseInt(bits.slice(1, 4), 16) - 1023;
    const mantisa = bits.slice(4);
    return signo + '0x' + mantisa[0] + '.' + (mantisa.slice(1).replace(/0+$/, '') || '0') + 'p' + (exponente < 0 ? '-' : '+') + Math.abs(exponente);
}

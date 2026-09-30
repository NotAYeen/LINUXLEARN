/**
 * sed — editor de flujo (substitucion, borrado, impresion).
 *
 * Mensajes verificados con GNU sed 4.8:
 *   sed: can't read nope: No such file or directory
 *   sed: -e expression #1, char 3: unterminated `s' command
 *   sed: unknown command: `z'
 *
 * Se implementan los comandos de GNU que aparecen en las misiones:
 *   s/RE/TEXTO/g     sustituye la primera (o todas) las coincidencias
 *   TEXTO           imprime la linea
 *   d               borra la linea
 *   p               imprime la linea
 *   q               termina
 *   a\TEXTO          anade TEXTO despues
 *   i\TEXTO          anade TEXTO antes
 *   c\TEXTO          cambia la linea
 *   y/claves/sustitución  translitera
 *   =               numera lineas
 *   n / N           siguiente linea / numerada
 * Con `-n` se suprime la impresion automatica.
 */

import { ShellError, EXIT_ERROR, EXIT_MISUSE } from '../errors.js';
import { normalizePath } from '../fs.js';
import { compilarPatron, RegexError } from './regex.js';
import { partir, motivo, quote } from './io.js';

function error(mensaje, code = EXIT_ERROR) {
    return new ShellError('sed: ' + mensaje, code);
}

/** Una instruccion del guion, ya traducida a funciones. */
function compilarInstruccion(texto, numLinea) {
    const sangria = texto.length - texto.trimStart().length;
    let cmd = texto.trimStart();
    let direccion = null;

    // Direccion por numero de linea: `2p`, `3,5d`.
    const rango = /^(\d+)(?:,(\d+))?\s*/.exec(cmd);
    if (rango) {
        direccion = { tipo: 'linea', desde: Number(rango[1]), hasta: rango[2] ? Number(rango[2]) : null };
        cmd = cmd.slice(rango[0].length);
    } else if (cmd.startsWith('/')) {
        // Direccion por patron: `/ERROR/d`, `/^INFO/,/WARN/p`.
        const fin = buscarCierreRegex(cmd, 0);
        const patron = cmd.slice(1, fin);
        cmd = cmd.slice(fin + 1);
        if (cmd.startsWith(',')) {
            const fin2 = buscarCierreRegex(cmd, 1);
            const hasta = cmd.slice(2, fin2);
            cmd = cmd.slice(fin2 + 1);
            direccion = { tipo: 'regex', desde: patron, hasta };
        } else {
            direccion = { tipo: 'regex', desde: patron, hasta: null };
        }
        if (cmd.startsWith(',')) cmd = cmd.slice(1);
    }

    const inst = compilarComando(cmd, numLinea, sangria);
    if (inst && direccion) inst.direccion = direccion;
    return inst;
}

/** Busca el `/` que cierra un patron, saltando los escapes. */
function buscarCierreRegex(texto, desde) {
    let i = desde + 1;
    while (i < texto.length) {
        if (texto[i] === '\\') { i += 2; continue; }
        if (texto[i] === '/') return i;
        i++;
    }
    return -1;
}

function compilarComando(cmd, numLinea, sangria) {
    const letra = cmd[0];

    if (letra === undefined || letra === '#') return null;
    if (cmd.startsWith('{') || cmd.startsWith('}')) {
        throw error("-e expression #" + numLinea + ", char 1: unknown command: `" + letra + "'");
    }

    switch (letra) {
        case 's': {
            const partes = separar(cmd, 's');
            if (partes.length < 2) {
                throw error("-e expression #" + numLinea + ", char " + (sangria + 3) + ": unterminated `s' command");
            }
            const flags = partes[2] ?? '';
            if (!/^[gip0-9]*$/.test(flags)) {
                throw error("-e expression #" + numLinea + ", char " + (sangria + 3) + ": unknown option to `s'");
            }
            return { tipo: 's', regex: compilarRegex(partes[0], numLinea), texto: partes[1], global: flags.includes('g'), numero: /^\d+$/.test(flags) ? Number(flags) : 0 };
        }
        case 'y': {
            const partes = separar(cmd, 'y');
            if (partes.length < 2) {
                throw error("-e expression #" + numLinea + ", char " + (sangria + 3) + ": unterminated `y' command");
            }
            if (partes[0].length !== partes[1].length) {
                throw error("-e expression #" + numLinea + ", char " + (sangria + 3) + ": strings of different lengths");
            }
            const tabla = new Map();
            [...partes[0]].forEach((ch, i) => tabla.set(ch, partes[1][i]));
            return { tipo: 'y', tabla };
        }
        case 'p': return { tipo: 'p' };
        case 'd': return { tipo: 'd' };
        case 'q': return { tipo: 'q' };
        case '=': return { tipo: '=' };
        case 'n': return { tipo: 'n' };
        case 'N': return { tipo: 'N' };
        case 'a': return { tipo: 'a', texto: continuacion(cmd, sangria) };
        case 'i': return { tipo: 'i', texto: continuacion(cmd, sangria) };
        case 'c': return { tipo: 'c', texto: continuacion(cmd, sangria) };
        default:
            throw error("-e expression #" + numLinea + ", char " + (sangria + 1) + ": unknown command: `" + letra + "'");
    }
}

function compilarRegex(patron, numLinea) {
    try {
        return compilarPatron(patron, { ere: false });
    } catch (e) {
        if (e instanceof RegexError) {
            throw error("-e expression #" + numLinea + ", char 3: unterminated `s' command");
        }
        throw e;
    }
}

/** `s/a/b/g` -> ['a', 'b', 'g'] respetando barras invertidas. */
function separar(cmd, letra) {
    const partes = [];
    let actual = '';
    let i = 2;
    const delimitador = cmd[1];
    if (delimitador === undefined) {
        throw error('-e expression #1, char 2: unterminated `' + letra + "' command");
    }
    while (i < cmd.length) {
        const c = cmd[i];
        if (c === '\\' && i + 1 < cmd.length) { actual += c + cmd[i + 1]; i += 2; continue; }
        if (c === delimitador) { partes.push(actual); actual = ''; i++; continue; }
        actual += c;
        i++;
    }
    partes.push(actual);
    return partes;
}

/** Texto de `a\`, `i\` y `c\`: lo que va tras la barra. */
function continuacion(cmd, sangria) {
    const resto = cmd.slice(1).replace(/^\\/, '').replace(/^ /, '');
    return resto.replace(new RegExp('\\n\\s{' + (sangria + 1) + '}', 'g'), '\n');
}

function parseOptions(argv) {
    const opts = { silencioso: false, expresiones: [], ficheros: [], guiones: [] };
    for (let i = 1; i < argv.length; i++) {
        const op = argv[i];
        if (op === '--') { opts.ficheros.push(...argv.slice(i + 1)); break; }
        if (op === '-n' || op === '--quiet' || op === '--silent') { opts.silencioso = true; continue; }
        if (op === '-e' || op === '--expression') { opts.expresiones.push(argv[++i] ?? ''); continue; }
        if (op === '-f' || op === '--file') { opts.ficheroScript = argv[++i]; continue; }
        if (op === '-r' || op === '-z' || op === '-s' || op === '-u' || op === '-E') continue;
        if (op === '--help') throw error("Try 'sed --help' for more information.", EXIT_MISUSE);
        if (/^-[0-9]+$/.test(op)) { opts.silencioso = true; continue; }
        if (op.startsWith('-') && op.length > 1) continue;
        // El primer operando sin opcion es el guion; los demas, ficheros.
        if (opts.expresiones.length === 0 && !opts.ficheroScript) opts.expresiones.push(op);
        else opts.ficheros.push(op);
    }
    if (!opts.expresiones.length && !opts.ficheroScript) {
        throw error('no script specified');
    }
    return opts;
}

export default {
    name: 'sed',
    alias: [],
    synopsis: 'sed [OPTION]... {SCRIPT} [FILE]...',
    run(ctx, argv) {
        const opts = parseOptions(argv);
        if (opts.ficheroScript) {
            let guion = '';
            try {
                guion = ctx.fs.readFile(normalizePath(ctx.cwd, opts.ficheroScript));
            } catch (e) {
                throw error("can't read " + quote(opts.ficheroScript) + ': ' + motivo(e));
            }
            opts.expresiones.push(...partir(guion));
        }
        const instrucciones = [];
        opts.expresiones.forEach((guion, i) => {
            for (const linea of partir(guion)) {
                const inst = compilarInstruccion(linea, i + 1);
                if (inst) instrucciones.push(inst);
            }
        });

        const ficheros = opts.ficheros.length ? opts.ficheros : ['-'];
        let code = 0;
        let termino = false;

        for (const fichero of ficheros) {
            if (termino) break;
            let texto = null;
            let nombre = null;
            if (fichero === '-') texto = ctx.stdin ?? '';
            else {
                nombre = fichero;
                try {
                    texto = ctx.fs.readFile(normalizePath(ctx.cwd, fichero));
                } catch (e) {
                    ctx.stderr.write("sed: can't read " + quote(fichero) + ': ' + motivo(e) + '\n');
                    code = 1;
                    continue;
                }
            }
            const lineas = partir(texto);
            // Un rango `/a/,/b/` no puede cruzar de fichero: su estado se
            // reinicia en cada uno.
            const rangos = new Map();
            for (let i = 0; i < lineas.length; i++) {
                let linea = lineas[i];
                const imprime = !opts.silencioso;
                let borrar = false;
                const salida = [];

                for (const inst of instrucciones) {
                    if (!aplicaDireccion(inst.direccion, linea, i + 1, rangos)) continue;
                    switch (inst.tipo) {
                        case 's': {
                            const regex = inst.global
                                ? new RegExp(inst.regex.source, inst.regex.flags + 'g')
                                : inst.regex;
                            let cuenta = 0;
                            linea = linea.replace(regex, (...args) => {
                                cuenta++;
                                if (inst.numero && cuenta > inst.numero) {
                                    return args[0];
                                }
                                return expandirTexto(inst.texto, args);
                            });
                            break;
                        }
                        case 'y':
                            linea = [...linea].map((ch) => inst.tabla.get(ch) ?? ch).join('');
                            break;
                        case 'p': salida.push(linea); break;
                        case 'd': borrar = true; break;
                        case 'q': termino = true; break;
                        case 'n': {
                            if (i + 1 < lineas.length) { i++; linea = lineas[i]; }
                            break;
                        }
                        case 'N': {
                            if (i + 1 < lineas.length) { i++; linea += '\n' + lineas[i]; }
                            break;
                        }
                        case '=': salida.push(String(i + 1)); break;
                        case 'a': salida.push(inst.texto); break;
                        case 'i': salida.unshift(inst.texto); break;
                        case 'c': linea = inst.texto; break;
                        default: break;
                    }
                }
                if (termino) {
                    for (const s of salida) ctx.stdout.write(s + '\n');
                    break;
                }
                if (!borrar) {
                    if (imprime) ctx.stdout.write(linea + '\n');
                    for (const s of salida) ctx.stdout.write(s + '\n');
                } else {
                    for (const s of salida) ctx.stdout.write(s + '\n');
                }
            }
        }
        return code;
    }
};

/** ¿Se aplica la instruccion en esta linea? Direcciones `N`, `N,M` y `/re/`. */
function aplicaDireccion(direccion, linea, numero, rangos) {
    if (!direccion) return true;
    if (direccion.tipo === 'linea') {
        // `5d` es solo la linea 5; `2,4d` es un intervalo.
        if (direccion.hasta === null) return numero === direccion.desde;
        return numero >= direccion.desde && numero <= direccion.hasta;
    }
    const desde = new RegExp(direccion.desde).test(linea);
    if (direccion.hasta === null) return desde;
    return marcaHasta(rangos, direccion, linea, desde);
}

/**
 * Rango `/a/,/b/`: se abre en la linea que casa con `a` y se cierra en la
 * primera que casa con `b`. El estado vive en un Map que se reinicia al
 * empezar cada fichero, asi que un rango no cruza de fichero a fichero.
 */
function marcaHasta(rangos, direccion, linea, desde) {
    let activo = rangos.get(direccion);
    if (!activo) { activo = { abierto: false }; rangos.set(direccion, activo); }
    if (!activo.abierto) {
        if (desde) activo.abierto = true;
        return activo.abierto;
    }
    if (new RegExp(direccion.hasta).test(linea)) activo.abierto = false;
    return true;
}

/** `\1`, `&` y `\\` en el texto de sustitucion. */
function expandirTexto(texto, args) {
    const [, coincidencia, ...grupos] = args;
    return texto
        .replace(/&/g, coincidencia)
        .replace(/\\(\d)/g, (_, d) => grupos[Number(d) - 1] ?? '')
        .replace(/\\\\/g, '\\');
}

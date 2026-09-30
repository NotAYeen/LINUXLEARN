/**
 * grep — busca lineas que casan con un patron.
 *
 * Mensajes verificados con GNU grep 3.7:
 *   grep: /nope: No such file or directory
 *   grep: /privado: Permission denied
 *   grep: unrecognized option '--nope'
 *   grep: Invalid regular expression
 *   grep: conflicting matchers specified
 *
 * Los codigos de salida son los de grep, no los de bash: 0 si hubo coincidencia,
 * 1 si no, 2 si hubo error. Eso es lo que hace que `if grep -q ...; then` se
 * comporte como en la terminal de verdad.
 */

import { ShellError, EXIT_ERROR, EXIT_MISUSE, EXIT_NOT_FOUND } from '../errors.js';
import { normalizePath, dirnameOf } from '../fs.js';
import { compilarPatrones, RegexError } from './regex.js';
import { partir, motivo, quote } from './io.js';

const ERROR = 2;

function error(mensaje, code = EXIT_MISUSE) {
    return new ShellError('grep: ' + mensaje, code);
}

function parseOptions(argv) {
    const opts = {
        ignorarCase: false, invertir: false, contar: false, soloFichero: false,
        soloCoincidencia: false, numeroLinea: false, tranquilo: false,
        sinFichero: false, regex: true, fijar: [], patrones: [], ficheros: [],
        lineas: false, sinEspacio: false, soloPalabra: false, color: false
    };
    let esperando = null;

    for (let i = 1; i < argv.length; i++) {
        const op = argv[i];
        if (esperando) {
            if (esperando === 'patron') opts.patrones.push(op);
            else if (esperando === 'numLineas') opts.desde = Number(op);
            else if (esperando === 'hastaLinea') opts.hasta = Number(op);
            else if (esperando === 'contexto') opts.contexto = Number(op);
            else if (esperando === 'color') opts.color = op === 'always';
            esperando = null;
            continue;
        }
        if (op === '--') { opts.ficheros.push(...argv.slice(argv.indexOf('--') + 1)); break; }
        if (op === '-e' || op === '--regexp') { esperando = 'patron'; continue; }
        if (op === '-f' || op === '--file') {
            // Los patrones vienen de un fichero, uno por linea.
            let contenido = '';
            try {
                contenido = ctx.fs.readFile(normalizePath(ctx.cwd, argv[i + 1] ?? ''));
            } catch (e) {
                throw error("'" + (argv[i + 1] ?? '') + "': " + motivo(e), ERROR);
            }
            for (const linea of partir(contenido)) if (linea.length) opts.patrones.push(linea);
            i += 1;
            continue;
        }
        if (op === '-m' || op === '--max-count') { esperando = 'numLineas'; continue; }
        if (op === '-A' || op === '--after-context') { esperando = 'hastaLinea'; continue; }
        if (op === '-B' || op === '--before-context') { esperando = 'contextoAntes'; continue; }
        if (op === '-C' || op === '--context') { esperando = 'contexto'; continue; }
        if (op === '--color' || op === '--colour') { esperando = 'color'; continue; }
        if (op === '--help') throw error("Usage: grep [OPTION]... PATTERNS [FILE]...");
        if (op === '--version') { opts.version = true; continue; }
        if (op === '--line-number') { opts.numeroLinea = true; continue; }
        if (op === '--no-filename') { opts.sinFichero = true; continue; }
        if (op === '--with-filename') { opts.conFichero = true; continue; }
        if (op === '--invert-match') { opts.invertir = true; continue; }
        if (op === '--ignore-case') { opts.ignorarCase = true; continue; }
        if (op === '--count') { opts.contar = true; continue; }
        if (op === '--only-matching') { opts.soloCoincidencia = true; continue; }
        if (op === '--quiet') { opts.tranquilo = true; continue; }
        if (op === '--silent') { opts.tranquilo = true; continue; }
        if (op === '--recursive') { opts.recursivo = true; continue; }
        if (op === '--include') { esperando = 'include'; continue; }
        if (op === '--exclude') { esperando = 'exclude'; continue; }
        if (op === '--fixed-strings' || op === '--literal') { opts.regex = false; continue; }
        if (op.startsWith('-') && op.length > 1 && !/^-\d/.test(op)) {
            for (const letra of op.slice(1)) {
                switch (letra) {
                    case 'i': opts.ignorarCase = true; break;
                    case 'v': opts.invertir = true; break;
                    case 'c': opts.contar = true; break;
                    case 'l': opts.soloFichero = true; break;
                    case 'L': opts.soloNoFichero = true; break;
                    case 'o': opts.soloCoincidencia = true; break;
                    case 'n': opts.numeroLinea = true; break;
                    case 'q': opts.tranquilo = true; break;
                    case 'h': opts.sinFichero = true; break;
                    case 'H': opts.conFichero = true; break;
                    case 'r': case 'R': opts.recursivo = true; break;
                    case 's': opts.sinEspacio = true; break;
                    case 'w': opts.soloPalabra = true; break;
                    case 'F': opts.regex = false; break;
                    case 'E': opts.regex = true; break;
                    case 'x': opts.lineaCompleta = true; break;
                    default: error("unrecognized option '--" + letra + "'");
                }
            }
            continue;
        }
        if (opts.patrones.length === 0 || op === '-e') { opts.patrones.push(op); continue; }
        opts.ficheros.push(op);
    }
    if (esperando) error("option '" + esperando + "' requires an argument");
    return opts;
}

/** Con `-r` se recorren los directorios: GNU imprime cada ruta antes de leerla. */
function recorrer(ctx, base, operandos) {
    const salida = [];
    const visit = (nodo, ruta) => {
        if (nodo.isDir) {
            for (const hijo of [...nodo.list()].sort(cmpNombres)) {
                const hijoRuta = ruta === '/' ? '/' + hijo.name : ruta + '/' + hijo.name;
                salida.push(hijoRuta);
                visit(hijo, hijoRuta);
            }
        }
    };
    for (const operando of operandos) {
        const abs = normalizePath(ctx.cwd, operando);
        const nodo = ctx.fs.node(abs);
        if (!nodo) continue;
        if (nodo.isDir) {
            salida.push(operando);
            visit(nodo, abs);
            continue;
        }
        salida.push(operando);
    }
    return salida;
}

function cmpNombres(a, b) {
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

export default {
    name: 'grep',
    alias: [],
    synopsis: 'grep [OPTION]... PATTERN [FILE]...',
    run(ctx, argv) {
        const opts = parseOptions(argv);
        if (opts.version) {
            ctx.stdout.write('grep (GNU grep) 3.7\n');
            return 0;
        }
        if (opts.patrones.length === 0) throw error('missing pattern');

        let regex;
        try {
            regex = compilarPatrones(opts.patrones, { ere: opts.regex, icase: opts.ignorarCase });
        } catch (e) {
            if (e instanceof RegexError) {
                ctx.stderr.write('grep: ' + e.message + '\n');
                return ERROR;
            }
            throw e;
        }
        if (opts.soloPalabra) {
            const envuelto = compilarPatrones(
                opts.patrones.map((p) => '\\b(?:' + p + ')\\b'),
                { ere: opts.regex, icase: opts.ignorarCase }
            );
            regex = envuelto;
        }
        if (opts.lineaCompleta) {
            regex = compilarPatrones(
                opts.patrones.map((p) => '^(?:' + p + ')$'),
                { ere: opts.regex, icase: opts.ignorarCase }
            );
        }

        const ficheros = opts.ficheros.length ? opts.ficheros : ['-'];
        // Con un solo fichero GNU no repite el nombre delante de cada linea.
        const conNombre = ficheros.length > 1 || opts.conFichero === true;
        const lista = opts.recursivo
            ? recorrer(ctx, ctx.cwd, opts.ficheros)
            : ficheros;
        let encontradas = 0;
        let code = 0;

        for (const fichero of lista) {
            let texto = null;
            let nombre = null;
            if (fichero === '-') {
                texto = ctx.stdin ?? '';
            } else {
                nombre = fichero;
                const abs = normalizePath(ctx.cwd, fichero);
                try {
                    const nodo = ctx.fs.node(abs);
                    if (nodo && nodo.isDir) throw new ShellError('Is a directory');
                    texto = ctx.fs.readFile(abs);
                } catch (e) {
                    ctx.stderr.write('grep: ' + quote(fichero) + ': ' + motivo(e) + '\n');
                    code = ERROR;
                    continue;
                }
            }
            if (opts.soloFichero || opts.soloNoFichero) {
                const lineas = partir(texto);
                const hay = lineas.some((l) => {
                    const r = regex.test(l);
                    return opts.invertir ? !r : r;
                });
                if (hay !== !!opts.soloNoFichero) {
                    encontradas++;
                    if (opts.soloFichero) ctx.stdout.write(nombre ?? '(standard input)\n');
                }
                continue;
            }

            const lineas = partir(texto);
            let cuenta = 0;
            for (let i = 0; i < lineas.length; i++) {
                const casa = regex.test(lineas[i]);
                if (casa === opts.invertir) continue;
                cuenta++;
                encontradas++;
                if (opts.contar || opts.tranquilo) continue;
                const prefijo = (conNombre ? nombre + (opts.sinEspacio ? ':' : ':') : '')
                    + (opts.numeroLinea ? (conNombre ? ':' : '') + (i + 1) + (opts.sinEspacio ? ':' : ':') : '');
                if (opts.soloCoincidencia) {
                    const global = new RegExp(regex.source, regex.flags.includes('i') ? 'gi' : 'g');
                    const partes = lineas[i].match(global) ?? [];
                    for (const parte of partes) ctx.stdout.write(prefijo + parte + '\n');
                } else {
                    ctx.stdout.write(prefijo + lineas[i] + '\n');
                }
            }
            if (opts.contar) {
                ctx.stdout.write((conNombre ? nombre + ':' : '') + cuenta + '\n');
            }
        }

        if (opts.tranquilo) return encontradas ? 0 : 1;
        if (!encontradas && code === 0) return EXIT_NOT_FOUND;
        return code;
    }
};

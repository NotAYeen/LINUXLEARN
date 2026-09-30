/**
 * El shell: tuberias, redirecciones, funciones, bucles, `trap` y `set`.
 *
 * Es el unico modulo que ejecuta el AST que producen `lexer.js` y `parser.js`.
 * Vive en el hilo principal y no toca el DOM: la interfaz lo llama y pinta lo
 * que devuelve (regla 1 de AGENTS.md).
 *
 * Decisiones de diseno que hay que respetar (estan en PROGRESO.md):
 *
 *  1. Los errores de los comandos externos llevan su propio nombre y SIN
 *     prefijo; los fallos del shell y los de los builtins se imprimen como
 *     `bash: line N: mensaje`. `diff-bash.mjs` normaliza ese prefijo.
 *  2. Las tuberias son secuenciales: cada etapa recibe la salida entera de la
 *     anterior como `stdin`. No hay streaming, pero asi el motor es
 *     determinista y `head` puede cerrar la lectura.
 *  3. Cada etapa de tuberia, cada subshell y cada `$( )` corre con copia de las
 *     variables y del cwd. Las funciones, los bucles y el cuerpo del `if`
 *     comparten el ambito (alcance dinamico) con una pila de `local`.
 *  4. Los bucles infinitos se cortan con un presupuesto de pasos: al pasarse
 *     se lanza `BudgetError` y el shell avisa como hace bash con un trabajo
 *     demasiado largo.
 *  5. `./guion.sh`, `bash guion.sh` y `source guion.sh` ejecutan ficheros del
 *     propio sistema de ficheros virtuales.
 */

import {
    ShellError, ExitSignal, InterruptSignal, BudgetError,
    EXIT_OK, EXIT_ERROR, EXIT_MISUSE, EXIT_NOT_FOUND
} from './errors.js';
import { tokenize, ShellSyntax } from './lexer.js';
import { normalizePath, dirnameOf, basenameOf } from './fs.js';
import { buildSeed, SHELL_NOW } from './seed.js';
import { parseScript } from './parser.js';
import { expandWords, IFS_POR_DEFECTO } from './expansion.js';
import { buscarComando, nombresOrdenados } from './registry.js';
import { BUILTINS, buscarBuiltin, ReturnSignal } from './builtins.js';
import { evaluarEntero } from './arith.js';

export { ReturnSignal };

/**
 * Tope de salida por etapa de tuberia: protege al navegador de un `yes | cat`.
 * Es tambien lo que corta un `while true; do echo x; done` sin dejar colgada la
 * pagina: 256 KB se llenan deprisa y el comando se detiene solo.
 */
const LIMITE_SALIDA = 256 * 1024;
/** Pasos de ejecucion antes de sospechar de un bucle infinito. */
const PRESUPUESTO = 200000;
/** Anidamiento maximo de tuberias, subshells y funciones. */
const PROFUNDIDAD_MAXIMA = 64;

/** Un destino de escritura: los coreutils escriben con `write()`. */
function crearFlujo(texto = '') {
    return {
        texto,
        write(s) { this.texto += s; },
        get completo() { return this.texto; }
    };
}

/** Crea una sesion de shell sobre el arbol de la semilla. */
export function crearSesion(opciones = {}) {
    const semilla = opciones.semilla ?? buildSeed({ now: SHELL_NOW });
    let estado = crearEstado(semilla, opciones);

    const sesion = {
        get estado() { return estado; },
        historial: estado.historial,

        /** Ejecuta un guion y devuelve `{ stdout, stderr, code }`. */
        ejecutar(guion) {
            return ejecutarGuion(estado, String(guion ?? ''), { nuevoAlcance: false });
        },

        /** Escribe un fichero del VFS desde fuera (tests e interfaz). */
        escribir(ruta, contenido) {
            const abs = normalizePath(estado.cwd, ruta);
            estado.fs.mkdirp(dirnameOf(abs), 0o755, estado.owner);
            estado.fs.writeFile(abs, String(contenido), 0o644, estado.owner);
        },

        cd(ruta) {
            const abs = normalizePath(estado.cwd, ruta);
            if (!estado.fs.isDir(abs)) return false;
            estado.cambiarCwd(abs);
            return true;
        },

        reset() {
            estado = crearEstado(semilla, opciones);
            sesion.historial = estado.historial;
            return sesion;
        },

        /** Sugerencias para el TAB de la interfaz. */
        sugerencias(partial) {
            const prefijo = String(partial ?? '');
            const encontradas = new Set();
            for (const nombre of nombresOrdenados()) if (nombre.startsWith(prefijo)) encontradas.add(nombre);
            for (const nombre of BUILTINS.keys()) if (nombre.startsWith(prefijo)) encontradas.add(nombre);
            if (!prefijo.includes('/')) {
                try {
                    for (const hijo of estado.fs.node(estado.cwd)?.list() ?? []) {
                        const etiqueta = hijo.name + (hijo.isDir ? '/' : '');
                        if (etiqueta.startsWith(prefijo)) encontradas.add(etiqueta);
                    }
                } catch (e) { /* el directorio actual puede haber desaparecido */ }
            }
            return [...encontradas].sort();
        },

        prompt() {
            return estado.usuario + '@' + estado.hostname + ':' + estado.pwd + '$ ';
        },

        /** Interrumpe el comando en curso, como Ctrl+C. */
        interrumpir() {
            estado.interrumpido = true;
        }
    };
    return sesion;
}

/** Estado completo de una sesion: variables, opciones, funciones y trampas. */
function crearEstado(semilla, opciones) {
    const fs = semilla.vfs;
    const usuario = semilla.ctx.user;
    const host = semilla.ctx.hostname ?? semilla.ctx.host ?? 'linuxlearn';
    const home = semilla.ctx.home;

    const estado = {
        fs,
        semilla,
        ctx: semilla.ctx,
        usuario,
        hostname: host,
        home,
        cwd: opciones.cwd ?? home,
        pwd: '~',
        umask: opciones.umask ?? 0o022,
        now: SHELL_NOW,
        pid: 4242,
        estado: 0,
        ultimoTrabajo: 0,
        opciones: { e: false, u: false, pipefail: false, x: false },
        vars: new Map(),
        funciones: new Map(),
        alias: new Map(),
        traps: new Map(),
        posicionales: [],
        historial: [],
        ifs: IFS_POR_DEFECTO,
        pasos: 0,
        profundidad: 0,
        locals: [],
        romper: 0,
        continuar: 0,
        interrumpido: false,
        actualTrabajo: 0,

        leer(nombre) {
            if (nombre === '?') return String(this.estado);
            if (nombre === '#') return String(this.posicionales.length);
            if (nombre === '$') return String(this.pid);
            if (nombre === '!') return String(this.ultimoTrabajo);
            if (nombre === '0') return 'bash';
            // `$1`..`$9` y `$10`: los posicionales de la funcion o el guion.
            if (/^[0-9]+$/.test(nombre)) return this.posicionales[Number(nombre) - 1] ?? '';
            const v = this.vars.get(nombre);
            return v === undefined ? '' : v.valor;
        },

        definir(nombre, valor, exportado) {
            const anterior = this.vars.get(nombre);
            this.vars.set(nombre, {
                valor: String(valor),
                exportado: exportado ?? (anterior ? anterior.exportado : false)
            });
        },

        asignar(nombre, valor) {
            this.definir(nombre, valor, this.vars.get(nombre)?.exportado);
        },

        declararLocal(nombre) {
            const marco = this.locals[this.locals.length - 1];
            const v = this.vars.get(nombre);
            this.vars.set(nombre, { valor: v ? v.valor : '', exportado: v?.exportado ?? false });
            if (marco) marco.push(nombre);
        },

        definirLocal(nombre, valor) {
            const marco = this.locals[this.locals.length - 1];
            const v = this.vars.get(nombre);
            if (marco && !marco.includes(nombre)) marco.push(nombre);
            this.vars.set(nombre, { valor: String(valor), exportado: v?.exportado ?? false });
        },

        cambiarCwd(ruta) {
            this.cwd = ruta;
            this.pwd = ruta === home ? '~'
                : (dirnameOf(ruta) === home ? '~/' + basenameOf(ruta) : ruta);
        },

        get env() {
            const entorno = {};
            for (const [nombre, v] of this.vars) if (v.exportado) entorno[nombre] = v.valor;
            return entorno;
        },

        get owner() { return { uid: semilla.ctx.uid, gid: semilla.ctx.gid }; },

        /** Ejecuta un texto en el ambito actual: `source`, `eval`, funciones. */
        fuente(texto, argumentos = []) {
            return ejecutarGuion(this, texto, { nuevoAlcance: false, argumentos });
        },

        /** Lanza una orden ya expandida: lo usan `xargs`, `find -exec` y `command`. */
        lanzar(argvArray) {
            const palabras = Array.isArray(argvArray) ? argvArray.map(String) : [String(argvArray)];
            if (!palabras.length || !palabras[0]) return { stdout: '', stderr: '', code: 0 };
            const io = nuevoIo();
            io.entrada.texto = '';
            const codigo = despachar(this, palabras, io, this.posicionales, { nuevoAlcance: true });
            this.estado = codigo;
            return { stdout: io.stdout.texto, stderr: io.stderr.texto, code: codigo };
        },

        lanzarGuion(texto, argumentos = [], meta = {}) {
            return ejecutarGuion(this, texto, { nuevoAlcance: true, argumentos, nombreGuion: meta.nombre });
        },

        comandoExterno(nombre) {
            return buscarComando(nombre) !== null;
        },

        builtin(nombre) {
            return buscarBuiltin(nombre) !== null;
        },

        funcion(nombre) {
            return this.funciones.has(nombre);
        }
    };

    for (const [nombre, valor] of Object.entries(semilla.ctx.env ?? {})) {
        estado.vars.set(nombre, { valor, exportado: true });
    }
    estado.vars.set('HOME', { valor: home, exportado: true });
    estado.vars.set('USER', { valor: usuario, exportado: true });
    estado.vars.set('SHELL', { valor: '/bin/bash', exportado: true });
    estado.vars.set('PWD', { valor: estado.cwd, exportado: true });
    estado.vars.set('PATH', { valor: '/usr/local/bin:/usr/bin:/bin', exportado: true });
    estado.vars.set('PS1', { valor: '\\u@\\h:\\w\\$ ', exportado: true });

    // `~/.bashrc` es quien define los alias: se carga al arrancar, como en bash.
    try {
        ejecutarGuion(estado, fs.readFile(home + '/.bashrc'), { nuevoAlcance: false, silencioso: true });
    } catch (e) { /* sin bashrc no pasa nada */ }

    return estado;
}

/** Los items de todas las lineas del guion, en orden: `;` entre lineas. */
function itemsDelGuion(ast) {
    const items = [];
    for (const linea of ast.body ?? []) {
        if (Array.isArray(linea?.items)) items.push(...linea.items);
    }
    return items;
}

/** Los tres flujos de una orden: entrada, salida y error. */
function nuevoIo() {
    return { stdout: crearFlujo(), stderr: crearFlujo(), entrada: { texto: '' } };
}

/** Ejecuta un guion completo y devuelve `{ stdout, stderr, code }`. */
function ejecutarGuion(estado, guion, opciones) {
    const io = nuevoIo();
    io.entrada.texto = opciones.stdin ?? '';
    const posicionales = opciones.argumentos ?? estado.posicionales;
    let codigo;

    estado.pasos = 0;
    estado.profundidad = 0;
    estado.romper = 0;
    estado.continuar = 0;
    estado.locals = [];
    estado.interrumpido = false;

    if (opciones.registrar && guion.trim()) estado.historial.push(guion);

    try {
        const ast = parseScript(guion);
        codigo = ejecutarLista(estado, itemsDelGuion(ast), io, posicionales, opciones);
    } catch (e) {
        codigo = manejarFallo(estado, e, io);
    }

    estado.estado = codigo;

    if (!opciones.silencioso) {
        for (const [senal, accion] of estado.traps) {
            if (senal === 'EXIT' && accion) {
                try {
                    ejecutarTextoAislado(estado, accion, io, posicionales);
                } catch (e) {
                    const c = manejarFallo(estado, e, io);
                    if (c) { /* el trap de salida no cambia el codigo */ }
                }
            }
        }
    }
    return { stdout: io.stdout.texto, stderr: io.stderr.texto, code: codigo };
}

/** Traduce excepciones del motor al mensaje y al codigo que daria bash. */
function manejarFallo(estado, e, io) {
    if (e instanceof ExitSignal) {
        if (e.codigo !== estado.estado && e.mensaje) io.stderr.texto += 'bash: ' + e.mensaje + '\n';
        return e.codigo;
    }
    if (e instanceof BudgetError) {
        // bash avisa de un trabajo demasiado largo con su propio prefijo; aqui
        // el mensaje es el que vera el alumno, en la terminal simulada.
        io.stderr.texto += 'bash: el comando ha tardado demasiado; quiza hay un bucle infinito sin fin\n';
        return EXIT_ERROR;
    }
    if (e instanceof InterruptSignal) {
        io.stderr.texto += '\n';
        return 130;
    }
    if (e instanceof ShellSyntax) {
        io.stderr.texto += 'bash: -c: line 1: ' + e.message + '\n';
        return 2;
    }
    if (e instanceof ShellError) {
        io.stderr.texto += e.message + '\n';
        return e.code;
    }
    io.stderr.texto += 'bash: ' + (e && e.message ? e.message : String(e)) + '\n';
    return EXIT_ERROR;
}

/** Ejecuta una lista de ordenes respetando `&&`, `||` y `;`. */
function ejecutarLista(estado, items, io, posicionales, opciones) {
    let codigo = estado.estado;
    for (const item of items ?? []) {
        if (estado.interrumpido) throw new InterruptSignal();
        if (estado.romper || estado.continuar) break;

        const saltar = (item.op === '&&' && codigo !== 0) || (item.op === '||' && codigo === 0);
        if (saltar) continue;

        codigo = ejecutarNodo(estado, item.pipeline, io, posicionales, opciones);

        if (item.op === '&') {
            estado.ultimoTrabajo = 4243;
            continue;
        }
        if (codigo !== 0 && estado.opciones.e && !item.pipeline.negated && !opciones.condicion) {
            throw new ExitSignal(codigo);
        }
    }
    estado.estado = codigo;
    return codigo;
}

/** Ejecuta un nodo del AST: pipeline, if, for, while, case, grupo o subshell. */
function ejecutarNodo(estado, nodo, io, posicionales, opciones) {
    if (!nodo) return 0;
    estado.pasos++;
    if (estado.pasos > PRESUPUESTO) throw new BudgetError('presupuesto agotado');

    // Las construcciones compuestas tambien aceptan redireccion:
    // `while read l; do ...; done < fichero` es el caso clasico.
    if (nodo.type !== 'pipeline' && nodo.redirects && nodo.redirects.length) {
        return ejecutarConRedirecciones(estado, nodo, io, posicionales, opciones,
            (ioHijo) => ejecutarNodoSinRedirecciones(estado, nodo, ioHijo, posicionales, opciones));
    }
    return ejecutarNodoSinRedirecciones(estado, nodo, io, posicionales, opciones);
}

function ejecutarNodoSinRedirecciones(estado, nodo, io, posicionales, opciones) {
    switch (nodo.type) {
        case 'pipeline': return ejecutarPipeline(estado, nodo, io, posicionales, opciones);
        case 'if': return ejecutarIf(estado, nodo, io, posicionales, opciones);
        case 'for': return ejecutarFor(estado, nodo, io, posicionales, opciones);
        case 'while': return ejecutarBucle(estado, nodo, io, posicionales, opciones, false);
        case 'until': return ejecutarBucle(estado, nodo, io, posicionales, opciones, true);
        case 'case': return ejecutarCase(estado, nodo, io, posicionales, opciones);
        case 'function': estado.funciones.set(nodo.name, nodo.body); return 0;
        case 'group': return ejecutarConRedirecciones(estado, nodo, io, posicionales, opciones,
            (ioHijo) => ejecutarLista(estado, nodo.body, ioHijo, posicionales, opciones));
        case 'subshell': return ejecutarSubshell(estado, nodo, io, posicionales, opciones);
        default:
            throw new ShellSyntax("syntax error near unexpected token '" + nodo.type + "'");
    }
}

/** Pipeline: cada etapa corre con la salida de la anterior como `stdin`. */
function ejecutarPipeline(estado, pipeline, io, posicionales, opciones) {
    const etapas = pipeline.commands;
    let codigo = 0;
    const codigos = [];
    let entradaActual = io.entrada.texto ?? '';

    for (let i = 0; i < etapas.length; i++) {
        const ultima = i === etapas.length - 1;
        const ioEtapa = ultimoIO(etapas.length, ultima, io);
        ioEtapa.entrada.texto = entradaActual;

        // Cada etapa corre en un hijo con copia de variables y cwd.
        const hijo = etapas.length > 1 ? clonarParaHijo(estado) : estado;
        codigo = ejecutarEtapa(hijo, etapas[i], ioEtapa, posicionales, opciones);
        codigos.push(codigo);

        if (!ultima) {
            if (ioEtapa.stdout.texto.length > LIMITE_SALIDA) {
                // bash mata el proceso con SIGPIPE; aqui se corta la etapa y se
                // avisa, que es lo que el alumno puede entender y corregir.
                throw new BudgetError('salida demasiado larga en la tuberia');
            }
            entradaActual = ioEtapa.stdout.texto;
        }
    }

    let final = codigos[codigos.length - 1] ?? 0;
    if (estado.opciones.pipefail) {
        const fallo = codigos.find((c) => c !== 0);
        if (fallo !== undefined) final = fallo;
    }
    if (pipeline.negated) final = final === 0 ? 1 : 0;
    return final;
}

/**
 * La ultima etapa escribe en los flujos reales; las anteriores, en un bucle.
 * El flujo de entrada se conserva siempre: `read` lo consume linea a linea y
 * por eso debe ser el mismo objeto en cada iteracion de un `while`.
 */
function ultimoIO(total, ultima, io) {
    if (total === 1 || ultima) return { stdout: io.stdout, stderr: io.stderr, entrada: io.entrada };
    return { stdout: crearFlujo(), stderr: io.stderr, entrada: io.entrada };
}

/** Copia superficial del estado: variables, alias, funciones y trampas. */
function clonarParaHijo(estado) {
    const copia = Object.create(Object.getPrototypeOf(estado));
    Object.assign(copia, estado);
    copia.vars = new Map();
    for (const [nombre, v] of estado.vars) copia.vars.set(nombre, { ...v });
    copia.alias = new Map(estado.alias);
    copia.funciones = new Map(estado.funciones);
    copia.traps = new Map(estado.traps);
    copia.locals = [];
    return copia;
}

/** Una etapa de tuberia: puede ser una orden simple o una construccion. */
function ejecutarEtapa(estado, nodo, io, posicionales, opciones) {
    if (nodo.type === 'simple') return ejecutarSimple(estado, nodo, io, posicionales, opciones);
    return ejecutarNodo(estado, nodo, io, posicionales, opciones);
}

/** Orden simple: `asignaciones comando argumentos`, con redirecciones. */
function ejecutarSimple(estado, nodo, io, posicionales, opciones) {
    return ejecutarConRedirecciones(estado, nodo, io, posicionales, opciones, (ioHijo) => {
        for (const asignacion of nodo.assigns ?? []) {
            const valor = valorAsignacion(estado, asignacion, ioHijo, posicionales);
            const nombre = asignacion.name;
            const operador = asignacion.operador ?? '=';
            if (operador === '+=') estado.asignar(nombre, estado.leer(nombre) + valor);
            else if (operador === '??') {
                if (estado.leer(nombre) === '') estado.asignar(nombre, valor);
            } else estado.asignar(nombre, valor);
        }

        if (!nodo.words.length) return 0;

        const argv = expandirComando(estado, nodo.words, posicionales, ioHijo);
        if (!argv.length) return 0;
        return despachar(estado, argv, ioHijo, posicionales, opciones);
    });
}

/** Alias, funciones, builtins y coreutils, en ese orden de precedencia. */
function despachar(estado, argv, io, posicionales, opciones) {
    const nombre = argv[0];

    if (estado.funciones.has(nombre)) return llamarFuncion(estado, nombre, argv.slice(1), posicionales, io, opciones);
    if (nombre && nombre.includes('/') && !estado.funciones.has(nombre)) return lanzarGuionOOrden(estado, argv, io, posicionales, opciones);

    const builtin = buscarBuiltin(nombre);
    if (builtin) return ejecutarBuiltin(estado, builtin, argv, io, posicionales, opciones);

    const comando = buscarComando(nombre);
    if (!comando) {
        if (nombre === '.' || nombre === ':') {
            io.stderr.texto += 'bash: ' + nombre + ': command not found\n';
            return EXIT_NOT_FOUND;
        }
        io.stderr.texto += 'bash: ' + nombre + ': command not found\n';
        return EXIT_NOT_FOUND;
    }
    return ejecutarComandoExterno(estado, comando, argv, io, posicionales, opciones);
}

/** `./guion.sh` o `/bin/loque`: ejecuta el fichero del VFS. */
function lanzarGuionOOrden(estado, argv, io, posicionales, opciones) {
    const guion = argv[0];
    const abs = normalizePath(estado.cwd, guion);
    let nodo = null;
    try {
        nodo = estado.fs.node(abs, { follow: false });
    } catch (e) {
        io.stderr.texto += 'bash: ' + guion + ': ' + motivoDe(e) + '\n';
        return 127;
    }
    if (!nodo) {
        io.stderr.texto += 'bash: ' + guion + ': No such file or directory\n';
        return 127;
    }
    if (nodo.isDir) {
        io.stderr.texto += 'bash: ' + guion + ': Is a directory\n';
        return 126;
    }
    if (nodo.type === 'file' && (nodo.mode & 0o111) === 0) {
        io.stderr.texto += 'bash: ' + guion + ': Permission denied\n';
        return 126;
    }
    const hijo = clonarParaHijo(estado);
    return ejecutarGuionEnHijo(hijo, nodo.content, io, argv.slice(1), guion);
}

/** Ejecuta un texto en un estado hijo y deja su salida en `io`. */
function ejecutarGuionEnHijo(estado, texto, io, argumentos, nombreGuion) {
    let codigo;
    try {
        const ast = parseScript(texto);
        codigo = ejecutarLista(estado, itemsDelGuion(ast), io, argumentos, { nuevoAlcance: true, nombreGuion });
    } catch (e) {
        codigo = manejarFallo(estado, e, io);
    }
    return codigo;
}

/** `if`: la primera rama cuya condicion vale 0. */
function ejecutarIf(estado, nodo, io, posicionales, opciones) {
    for (const rama of nodo.branches) {
        const condicion = ejecutarLista(estado, rama.cond, io, posicionales, { ...opciones, condicion: true });
        if (condicion === 0) return ejecutarLista(estado, rama.body, io, posicionales, opciones);
    }
    if (nodo.else) return ejecutarLista(estado, nodo.else, io, posicionales, opciones);
    return 0;
}

/** `for NAME [in palabras]; do ...; done`. */
function ejecutarFor(estado, nodo, io, posicionales, opciones) {
    const ctx = contextoExpansion(estado, posicionales, io);
    const hayLista = nodo.words && nodo.words.length > 0;
    const lista = hayLista
        ? expandWords(ctx, nodo.words, { split: true, glob: true, brace: true })
        : expandWords(ctx, [{ parts: [{ k: 'param', name: '@' }] }], { split: true, glob: true, brace: false });

    let codigo = 0;
    for (const palabra of lista) {
        estado.pasos++;
        if (estado.pasos > PRESUPUESTO) throw new BudgetError('presupuesto agotado');
        estado.asignar(nodo.name, palabra);
        codigo = ejecutarLista(estado, nodo.body, io, posicionales, opciones);
        const salida = controlarBucle(estado);
        if (salida === 'break2') break;
        if (salida === 'break') break;
    }
    return codigo;
}

/** `while` y `until`: comprueban la condicion antes de cada vuelta. */
function ejecutarBucle(estado, nodo, io, posicionales, opciones, hastaQueCumpla) {
    let codigo = 0;
    for (;;) {
        estado.pasos++;
        if (estado.pasos > PRESUPUESTO) throw new BudgetError('presupuesto agotado');
        const condicion = ejecutarLista(estado, nodo.cond, io, posicionales, { ...opciones, condicion: true });
        const seguir = hastaQueCumpla ? condicion !== 0 : condicion === 0;
        if (!seguir) break;
        codigo = ejecutarLista(estado, nodo.body, io, posicionales, opciones);
        const salida = controlarBucle(estado);
        if (salida === 'break2') break;
        if (salida === 'break') break;
    }
    return codigo;
}

/** Traduce `break`/`continue` con su nivel en una decision del bucle. */
function controlarBucle(estado) {
    if (estado.romper > 1) { estado.romper--; return 'break2'; }
    if (estado.romper === 1) { estado.romper = 0; return 'break'; }
    if (estado.continuar) { estado.continuar = 0; return 'continue'; }
    return 'seguir';
}

/** `case`: la primera clausula cuyo patron casa con el sujeto. */
function ejecutarCase(estado, nodo, io, posicionales, opciones) {
    const sujeto = expandirComando(estado, [nodo.subject], posicionales, io)[0] ?? '';
    for (const clausula of nodo.clauses) {
        for (const patron of clausula.patterns) {
            if (patronACasa(textoLiteral(patron), sujeto)) {
                return ejecutarLista(estado, clausula.body, io, posicionales, opciones);
            }
        }
    }
    return 0;
}

/** Un patron de `case` con `*`, `?`, `[...]` y alternativas `a|b`. */
function patronACasa(patron, sujeto) {
    const alternativas = patron.includes('|') ? patron.split('|') : [patron];
    return alternativas.some((p) => new RegExp('^' + globComoRegex(p) + '$').test(sujeto));
}

function globComoRegex(patron) {
    let fuente = '';
    let i = 0;
    while (i < patron.length) {
        const c = patron[i];
        if (c === '*') { fuente += '.*'; i++; continue; }
        if (c === '?') { fuente += '.'; i++; continue; }
        if (c === '[') {
            const fin = patron.indexOf(']', i + 1);
            if (fin > 0) {
                let clase = patron.slice(i + 1, fin);
                if (clase.startsWith('!') || clase.startsWith('^')) clase = '^' + clase.slice(1);
                fuente += '[' + clase.replace(/\\/g, '\\\\') + ']';
                i = fin + 1;
                continue;
            }
        }
        fuente += c.replace(/[.+^${}()|\\]/g, '\\$&');
        i++;
    }
    return fuente;
}

/** Redirecciones de una orden o de un grupo. */
function ejecutarConRedirecciones(estado, nodo, io, posicionales, opciones, cuerpo) {
    const restaurador = prepararRedirecciones(estado, nodo, io, posicionales);
    try {
        return cuerpo(io);
    } finally {
        restaurador();
    }
}

/** Destino de una redireccion ya expandido (tilde, variables y comillas). */
function expandirRedireccion(estado, palabra, posicionales, io) {
    if (!palabra) return '';
    if (palabra.parts.every((p) => p.k === 'lit' && !p.q)) return textoLiteral(palabra);
    const ctx = contextoExpansion(estado, posicionales, io);
    return expandWords(ctx, [palabra], { split: false, glob: false, brace: false })[0] ?? '';
}

/** Monta las redirecciones y devuelve la funcion que las deshace. */
function prepararRedirecciones(estado, nodo, io, posicionales = estado.posicionales) {
    const redirecciones = nodo.redirects ?? [];
    if (!redirecciones.length) return () => {};

    const originales = { stdout: io.stdout, stderr: io.stderr, entrada: io.entrada };
    const aFichero = [];

    for (const red of redirecciones) {
        if (red.heredoc) {
            const flujo = crearFlujo(red.heredoc.body);
            if (red.fd === 0) io.entrada = flujo;
            else if (red.fd === 2) io.stderr = flujo;
            else io.stdout = flujo;
            continue;
        }
        // El destino de una redireccion si se expande: `< ~/f`, `> "$DIR/x"`.
        const destino = expandirRedireccion(estado, red.target, posicionales, io);
        if (red.dup) {
            // `2>&1`, `1>&2`, `2>&-`
            if (destino === '-') {
                if (red.fd === 2) io.stderr = crearFlujo();
                else if (red.fd === 1) io.stdout = crearFlujo();
                continue;
            }
            const fuente = descriptorDe(io, destino);
            if (red.fd === 2) io.stderr = fuente;
            else if (red.fd === 1) io.stdout = fuente;
            continue;
        }
        const abs = normalizePath(estado.cwd, destino);
        if (red.op === '<') {
            io.entrada = crearFlujo(estado.fs.readFile(abs));
            continue;
        }
        if (red.op === '>' || red.op === '>>') {
            const previo = red.op === '>>' && estado.fs.exists(abs) ? estado.fs.readFile(abs) : '';
            const flujo = crearFlujo(previo);
            const fd = red.fd === '&' ? 1 : red.fd;
            aFichero.push({ flujo, ruta: abs, fd });
            if (fd === 2) io.stderr = flujo;
            else io.stdout = flujo;
            continue;
        }
        throw new ShellSyntax("syntax error near unexpected token `" + red.op + "'");
    }

    return function restaurar() {
        for (const item of aFichero) {
            if (!item.flujo.texto) continue;
            try {
                if (estado.fs.exists(item.ruta)) {
                    // El fichero ya existe: se sobreescribe conservando su modo.
                    estado.fs.writeFile(item.ruta, item.flujo.texto, 0o666, estado.owner);
                } else {
                    const padre = estado.fs.node(dirnameOf(item.ruta));
                    if (!padre) continue;
                    if (!estado.fs.canWrite(padre, estado.owner)) {
                        io.stderr.texto += 'bash: ' + item.ruta + ': Permission denied\n';
                        continue;
                    }
                    estado.fs.writeFile(item.ruta, item.flujo.texto, 0o666 & ~(estado.umask || 0), estado.owner);
                }
            } catch (e) {
                io.stderr.texto += 'bash: ' + item.ruta + ': ' + motivoDe(e) + '\n';
            }
        }
        io.stdout = originales.stdout;
        io.stderr = originales.stderr;
        io.entrada = originales.entrada;
    };
}

function descriptorDe(io, numero) {
    if (numero === '1') return io.stdout;
    if (numero === '2') return io.stderr;
    if (numero === '0') return io.entrada;
    return io.stdout;
}

/** Texto literal de una palabra del AST, sin expansion. */
function textoLiteral(palabra) {
    if (!palabra) return '';
    if (palabra.parts && palabra.parts.length) {
        return palabra.parts.map((p) => (p.k === 'lit' ? p.v : '')).join('');
    }
    return palabra.raw ?? '';
}

/** Valor del lado derecho de una asignacion. */
function valorAsignacion(estado, asignacion, io, posicionales) {
    const palabra = asignacion.word;
    const tieneVariable = palabra.parts.some((p) => p.k === 'sub' || p.k === 'arith' || p.k === 'param' || p.k === 'tilde');
    if (!tieneVariable) return palabra.parts.map((p) => (p.k === 'lit' ? p.v : '')).join('');
    const ctx = contextoExpansion(estado, posicionales, io);
    return expandWords(ctx, [palabra], { split: false, glob: false, brace: true })[0] ?? '';
}

/** Expande las palabras de una orden, aplicando alias en la primera. */
function expandirComando(estado, palabras, posicionales, io) {
    const ctx = contextoExpansion(estado, posicionales, io);
    const argv = [];
    for (let i = 0; i < palabras.length; i++) {
        if (i === 0) {
            const aliasValor = estado.alias.get(textoLiteral(palabras[0]));
            if (aliasValor !== undefined) {
                argv.push(...expandirAlias(estado, aliasValor, ctx));
                continue;
            }
        }
        const expandida = expandWords(ctx, [palabras[i]], { split: i > 0, glob: i > 0, brace: true });
        argv.push(...expandida);
    }
    return argv;
}

/** Un alias puede traer varias palabras: `ll='ls -l'` son dos argumentos. */
function expandirAlias(estado, valor, ctx) {
    const palabras = tokenize(valor).filter((t) => t.type === 'word');
    if (!palabras.length) return [];
    const argv = [];
    for (let i = 0; i < palabras.length; i++) {
        argv.push(...expandWords(ctx, [palabras[i]], { split: true, glob: i > 0, brace: true }));
    }
    return argv;
}

/** Contexto que necesita `expansion.js` para resolver variables, glob y `$(( ))`. */
function contextoExpansion(estado, posicionales, io) {
    return {
        fs: estado.fs,
        cwd: estado.cwd,
        env: estado.env,
        ifs: estado.ifs,
        lastStatus: estado.estado,
        pid: estado.pid,
        argumentos: posicionales,
        passwd: estado.semilla.ctx.passwd,
        globState: { cache: new Map() },
        getVar: (nombre) => estado.leer(nombre),
        setVar: (nombre, valor) => estado.asignar(nombre, valor),
        runSub: (src) => {
            const hijo = clonarParaHijo(estado);
            const salidaHijo = nuevoIo();
            const codigo = ejecutarGuionEnHijo(hijo, src, salidaHijo, posicionales, null);
            estado.estado = codigo;
            return { stdout: salidaHijo.stdout.texto, stderr: salidaHijo.stderr.texto, code: codigo };
        },
        evalArith: (src) => evaluarEntero(src, (n) => estado.leer(n)),
        expand: (texto) => {
            const palabras = tokenize(texto).filter((t) => t.type === 'word');
            const argv = [];
            for (let i = 0; i < palabras.length; i++) {
                argv.push(...expandWords(contextoExpansion(estado, posicionales, io), [palabras[i]], { split: true, glob: false, brace: true }));
            }
            return argv.join(' ');
        }
    };
}

/** Ejecuta un texto aislado (traps de salida). */
function ejecutarTextoAislado(estado, texto, io, posicionales) {
    try {
        const ast = parseScript(texto);
        return ejecutarLista(estado, itemsDelGuion(ast), io, posicionales, { nuevoAlcance: false });
    } catch (e) {
        return manejarFallo(estado, e, io);
    }
}

/** Llamada a builtin, con el `ctx` que espera el contrato de builtins.js. */
function ejecutarBuiltin(estado, builtin, argv, io, posicionales, opciones) {
    try {
        const codigo = builtin.run(crearCtx(estado, io, posicionales), argv);
        return typeof codigo === 'number' ? codigo : 0;
    } catch (e) {
        if (e instanceof ReturnSignal || e instanceof ExitSignal || e instanceof BudgetError) throw e;
        if (e instanceof ShellSyntax) throw e;
        if (e instanceof ShellError) {
            io.stderr.texto += (e.message.startsWith('bash:') ? '' : 'bash: ') + e.message + '\n';
            return e.code;
        }
        throw e;
    }
}

/** Llamada a coreutils: monta el `ctx` del contrato y ejecuta. */
function ejecutarComandoExterno(estado, comando, argv, io, posicionales) {
    return comando.run(crearCtx(estado, io, posicionales, comando.name), argv);
}

/** El `ctx` comun a builtins y coreutils. */
function crearCtx(estado, io, posicionales, nombreComando = null) {
    const shell = {
        now: estado.now,
        umask: estado.umask,
        uid: estado.owner.uid,
        gid: estado.owner.gid,
        user: estado.usuario,
        vars: estado.vars,
        passwd: estado.semilla.ctx.passwd,
        estado,
        nombre: nombreComando ?? 'bash',
        home: estado.home,
        getVar: (n) => estado.leer(n),
        setVar: (n, v) => estado.definir(n, v, estado.vars.get(n)?.exportado),
        definir: (n, v, e) => estado.definir(n, v, e),
        definirLocal: (n, v) => estado.definirLocal(n, v),
        declararLocal: (n) => estado.declararLocal(n),
        asignar: (n, v) => estado.asignar(n, v),
        leer: (n) => estado.leer(n),
        opciones: estado.opciones,
        ifs: estado.ifs,
        posicionales: estado.posicionales,
        ahora: () => estado.now,
        historial: estado.historial,
        funciones: estado.funciones,
        alias: estado.alias,
        traps: estado.traps,
        cambiarCwd: (r) => estado.cambiarCwd(r),
        pwdFisico: () => estado.cwd,
        lanzar: (args) => estado.lanzar(args),
        lanzarGuion: (t, a, m) => estado.lanzarGuion(t, a, m),
        lanzarConArgumentos: (args, extra) => {
            const palabras = args.map((p) => String(p).split('{}').join(extra));
            return estado.lanzar(palabras);
        },
        ejecutarEnContexto: (t, o) => ejecutarGuion(estado, t, { nuevoAlcance: false, ...o }),
        fuente: (t, a) => estado.fuente(t, a),
        comandoExterno: (n) => estado.comandoExterno(n),
        builtin: (n) => estado.builtin(n),
        funcion: (n) => estado.funcion(n)
    };
    return {
        fs: estado.fs,
        stdin: io.entrada.texto ?? '',
        // `flujoEntrada` es el objeto vivo: `read` lo consume linea a linea, y
        // es lo que hace que `while read l; do ...; done < f` funcione.
        flujoEntrada: io.entrada,
        stdout: io.stdout,
        stderr: io.stderr,
        env: estado.env,
        cwd: estado.cwd,
        owner: estado.owner,
        posicionales,
        shell
    };
}

/** Funcion definida por el alumno: ambito dinamico con pila de `local`. */
function llamarFuncion(estado, nombre, argumentos, posicionales, io, opciones) {
    const cuerpo = estado.funciones.get(nombre);
    if (!cuerpo) return 127;

    estado.profundidad++;
    if (estado.profundidad > PROFUNDIDAD_MAXIMA) {
        estado.profundidad--;
        throw new ShellError('bash: maximum function nesting level exceeded', 1);
    }

    const marco = [];
    estado.locals.push(marco);
    const posPrevios = estado.posicionales;
    estado.posicionales = argumentos;
    const prologo = nuevoIo();
    prologo.entrada.texto = '';
    estado.actualTrabajo++;

    try {
        return ejecutarLista(estado, cuerpo, io, argumentos, { nuevoAlcance: false, funcion: nombre });
    } catch (e) {
        if (e instanceof ReturnSignal) return e.code;
        throw e;
    } finally {
        for (const n of marco) estado.vars.delete(n);
        estado.locals.pop();
        estado.posicionales = posPrevios;
        estado.profundidad--;
    }
}

/** Subshell: copia de variables y cwd; su salida se recoge en los flujos. */
function ejecutarSubshell(estado, nodo, io, posicionales, opciones) {
    const hijo = clonarParaHijo(estado);
    return ejecutarConRedirecciones(estado, nodo, io, posicionales, opciones, (ioHijo) => {
        ioHijo.stdout = crearFlujo();
        ioHijo.stderr = io.stderr;
        return ejecutarLista(hijo, nodo.body, ioHijo, posicionales, { nuevoAlcance: true });
    });
}

/** Motivo de una excepcion del VFS, como lo imprime bash tras los dos puntos. */
function motivoDe(error) {
    const texto = String(error?.message ?? error ?? '');
    const corte = texto.indexOf(': ');
    return corte >= 0 ? texto.slice(corte + 2) : texto;
}

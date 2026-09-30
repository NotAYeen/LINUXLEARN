/**
 * Panel de mision: enunciado, pistas y las cuatro modalidades.
 *
 *   Terminal     el alumno escribe el comando y se compara con la solucion
 *   Depuracion   hay un comando roto: el alumno lo arregla o explica el fallo
 *   Auditoria    una secuencia con un token que hay que señalar
 *   Ensamblaje   unas etapas desordenadas que hay que colocar en su sitio
 *
 * Igual que el terminal, nada de `innerHTML` con datos: todo son nodos de texto.
 */

import { evaluar, pistaDe, registrarSuperada } from '../check.js';
import { crear } from './terminal.js';

/** Modalidades: cada una dibuja lo suyo y sabe leer la respuesta del alumno. */
const MODALIDADES = {
    Terminal: montarTerminal,
    Depuracion: montarDepuracion,
    Auditoria: montarAuditoria,
    Ensamblaje: montarEnsamblaje
};

/**
 * Monta el panel de una mision.
 *
 * @param {HTMLElement} raiz
 * @param {object} mision  entrada de NIVELES
 * @param {object} opciones `{ almacen, onSuperada }`
 */
export function montarPanel(raiz, mision, opciones = {}) {
    raiz.textContent = '';

    raiz.append(crear('header', { class: 'panel-cabecera' },
        crear('span', { class: 'mision-id', text: 'Mision ' + mision.id }),
        crear('h2', { class: 'mision-titulo', text: mision.titulo }),
        crear('p', { class: 'mision-modo' },
            crear('span', { class: 'etiqueta modo', text: mision.modo }),
            crear('span', { class: 'etiqueta dificultad', text: mision.dificultad })
        )
    ));

    raiz.append(crear('p', { class: 'mision-brief', text: mision.brief }));

    if (mision.objetivos?.length) {
        raiz.append(crear('section', { class: 'objetivos' },
            crear('h3', { text: 'Objetivos' }),
            crear('ul', {},
                ...mision.objetivos.map((o) => crear('li', { text: o }))
            )
        ));
    }

    const zona = crear('div', { class: 'zona-respuesta' });
    raiz.append(zona);

    const pistas = crear('div', { class: 'pistas' });
    raiz.append(pistas);

    const veredicto = crear('div', { class: 'veredicto', role: 'status' });
    raiz.append(veredicto);

    // Pistas, una a una y con coste: la primera es gratis.
    let gastadas = 0;
    const botonPista = crear('button', { class: 'pista-boton', type: 'button', text: 'Ver una pista' });
    botonPista.addEventListener('click', () => {
        const texto = pistaDe(mision, gastadas);
        if (!texto) { botonPista.disabled = true; return; }
        pistas.append(crear('p', { class: 'pista' }, crear('strong', { text: 'Pista ' + (gastadas + 1) + ': ' }), texto));
        gastadas++;
        if (!pistaDe(mision, gastadas)) botonPista.disabled = true;
    });
    pistas.append(botonPista);

    const construir = MODALIDADES[mision.modo] ?? montarTerminal;
    construir(zona, mision, {
        ...opciones,
        alEvaluar: (resultado) => {
            veredicto.textContent = '';
            veredicto.className = 'veredicto ' + (resultado.correcto ? 'ok' : 'mal');
            if (resultado.correcto) {
                veredicto.append(crear('p', { text: 'Correcto. La solucion expecteda es: ' + resultado.guion }));
                registrarSuperada(opciones.almacen, mision.id);
                opciones.onSuperada?.(mision.id);
            } else {
                for (const detalle of resultado.detalles) {
                    veredicto.append(crear('p', { text: detalle.texto }));
                }
                if (resultado.stderr) veredicto.append(crear('pre', { class: 'veredicto-error', text: resultado.stderr }));
            }
        }
    });

    return { mision, zona };
}

/** Terminal: un campo donde escribir el comando y un boton de comprobar. */
function montarTerminal(zona, mision, opciones) {
    const campo = crear('textarea', { class: 'campo-solucion', rows: 2, spellcheck: 'false' });
    const boton = crear('button', { class: 'boton comprobar', type: 'button', text: 'Comprobar' });
    const errores = crear('pre', { class: 'error-solucion' });

    boton.addEventListener('click', () => {
        const resultado = evaluar(mision, campo.value, { sesion: opciones.sesion });
        errores.textContent = resultado.stderr ?? '';
        opciones.alEvaluar?.(resultado);
    });

    zona.append(
        crear('label', { class: 'rotulo', for: 'solucion', text: 'Escribe el comando:' }),
        campo,
        crear('div', { class: 'acciones' }, boton),
        errores
    );
    campo.id = 'solucion-' + mision.id;
    campo.focus();
    return campo;
}

/**
 * Depuracion: se muestra el comando roto y su salida. El alumno puede
 * escribir el comando corregido o la explicacion; ambas se comprueban.
 */
function montarDepuracion(zona, mision, opciones) {
    const fallo = mision.fallo ?? {};
    zona.append(
        crear('h3', { text: 'Encuentra el fallo' }),
        crear('p', { class: 'fallo-comando', text: 'Este comando falla:' }),
        crear('pre', { class: 'comando-roto', text: fallo.comando ?? '' }),
        crear('p', { class: 'fallo-salida' },
            crear('strong', { text: 'Y da esta salida: ' }),
            crear('code', { text: fallo.salida ?? '' })
        )
    );

    const campo = crear('textarea', { class: 'campo-solucion', rows: 2, spellcheck: 'false' });
    const boton = crear('button', { class: 'boton comprobar', type: 'button', text: 'Comprobar' });
    const errores = crear('pre', { class: 'error-solucion' });

    boton.addEventListener('click', () => {
        const escrito = campo.value.trim();
        // Se acepta el comando corregido (cualquiera que no falle) o una
        // explicacion en texto libre que mencione la causa.
        const resultado = evaluar(mision, escrito, { sesion: opciones.sesion });
        const explicacion = esExplicacion(escrito, fallo);
        const final = explicacion
            ? { ...resultado, correcto: explicacion, detalles: [] }
            : resultado;
        errores.textContent = resultado.stderr ?? '';
        opciones.alEvaluar?.(final);
    });

    zona.append(campo, crear('div', { class: 'acciones' }, boton), errores);
}

/** Una respuesta en prosa cuenta si nombra el comando o el sintoma del fallo. */
function esExplicacion(texto, fallo) {
    if (!texto) return false;
    const minusculas = texto.toLowerCase();
    const pista = (fallo.salida ?? '').split(':')[0].trim().toLowerCase();
    return (pista && minusculas.includes(pista)) || minusculas.includes('permiso');
}

/** Auditoria: el alumno tiene que señalar el token que sobra o falta. */
function montarAuditoria(zona, mision, opciones) {
    const auditoria = mision.auditoria ?? {};
    const tokens = auditoria.tokens ?? [];

    zona.append(
        crear('h3', { text: 'Senala el token erroneo' }),
        crear('p', { class: 'auditoria-pista', text: 'Numera los tokens de uno en uno, empezando en 1.' }),
        crear('ol', { class: 'tokens' },
            ...tokens.map((token, i) => crear('li', { text: token }))
        )
    );

    const campo = crear('input', { class: 'campo-token', type: 'text', inputmode: 'numeric', placeholder: 'Numero del token' });
    const boton = crear('button', { class: 'boton comprobar', type: 'button', text: 'Comprobar' });

    boton.addEventListener('click', () => {
        const elegido = Number.parseInt(campo.value, 10);
        const correcto = elegido === auditoria.indice_error;
        opciones.alEvaluar?.({
            correcto,
            guion: String(campo.value),
            detalles: correcto ? [] : [{
                campo: 'auditoria',
                esperado: auditoria.indice_error,
                obtenido: elegido,
                texto: 'ese token no es el que falla; vuelve a mirar la orden'
            }],
            stdout: '',
            stderr: ''
        });
        if (correcto) marcarToken(zona, auditoria.indice_error);
    });

    zona.append(crear('div', { class: 'acciones' }, campo, boton));
}

/** Marca visualmente el token señalado. */
function marcarToken(zona, indice) {
    const elementos = zona.querySelectorAll('.tokens li');
    if (elementos[indice]) elementos[indice].classList.add('token-mal');
}

/**
 * Ensamblaje: las etapas estan en `bloques` desordenadas y el alumno las
 * coloca. Se implementa con botones "subir"/"bajar" para no depender de
 * arrastrar-y-soltar en el movil.
 */
function montarEnsamblaje(zona, mision, opciones) {
    // Las etapas correctas, mezcladas de forma determinista.
    const orden = [...(mision.bloques ?? [])];
    const desorden = desordenar(orden, mision.id);

    zona.append(
        crear('h3', { text: 'Pon las etapas en su orden' }),
        crear('p', { class: 'ensamblaje-pista', text: 'De arriba abajo, como se ejecuta un guion.' })
    );

    const lista = crear('ol', { class: 'etapas' });
    const redibujar = () => {
        lista.textContent = '';
        desorden.forEach((etapa, i) => {
            const item = crear('li', { class: 'etapa' },
                crear('code', { text: etapa }),
                crear('span', { class: 'mover' },
                    crear('button', {
                        class: 'arriba', type: 'button', text: '▲',
                        'aria-label': 'Subir la etapa ' + (i + 1)
                    }),
                    crear('button', {
                        class: 'abajo', type: 'button', text: '▼',
                        'aria-label': 'Bajar la etapa ' + (i + 1)
                    })
                )
            );
            const botones = item.querySelectorAll('button');
            botones[0].addEventListener('click', () => {
                if (i === 0) return;
                [desorden[i - 1], desorden[i]] = [desorden[i], desorden[i - 1]];
                redibujar();
            });
            botones[1].addEventListener('click', () => {
                if (i === desorden.length - 1) return;
                [desorden[i + 1], desorden[i]] = [desorden[i], desorden[i + 1]];
                redibujar();
            });
            lista.append(item);
        });
    };
    redibujar();

    const boton = crear('button', { class: 'boton comprobar', type: 'button', text: 'Comprobar' });
    boton.addEventListener('click', () => {
        const correcto = desorden.every((etapa, i) => etapa === orden[i]);
        opciones.alEvaluar?.({
            correcto,
            guion: desorden.join('\n'),
            detalles: correcto ? [] : [{
                campo: 'ensamblaje',
                esperado: orden.join(' | '),
                obtenido: desorden.join(' | '),
                texto: 'las etapas no estan en el orden correcto'
            }],
            stdout: '',
            stderr: ''
        });
    });

    zona.append(lista, crear('div', { class: 'acciones' }, boton));
}

/** Mezcla determinista: el mismo numero de mision da siempre la misma mezcla. */
function desordenar(etapas, semilla) {
    if (etapas.length < 2) return etapas;
    const resultado = [...etapas];
    let n = Number(semilla) || 1;
    for (let i = resultado.length - 1; i > 0; i--) {
        n = (n * 1103515245 + 12345) % 2147483648;
        const j = n % (i + 1);
        [resultado[i], resultado[j]] = [resultado[j], resultado[i]];
    }
    // Si aun asi queda ordenado, se intercambian las dos ultimas.
    if (resultado.every((etapa, i) => etapa === etapas[i])) {
        [resultado[0], resultado[resultado.length - 1]] = [resultado[resultado.length - 1], resultado[0]];
    }
    return resultado;
}

export { MODALIDADES, desordenar };
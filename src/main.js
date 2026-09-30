/**
 * Punto de entrada de la interfaz: el terminal, el panel de mision y el
 * progreso. Solo esta capa toca el DOM; el motor (src/engine) no lo hace nunca.
 */

import '../css/style.css';
import { NIVELES, misionPorId } from './levels.js';
import { leerProgreso, siguienteMision, registrarSuperada } from './check.js';
import { montarTerminal, crear } from './ui/terminal.js';
import { montarPanel } from './ui/panel.js';

/** Estructura de la pagina: barra lateral con misiones y zona principal. */
function esqueleto() {
    const raiz = document.getElementById('app');
    raiz.textContent = '';

    const cabecera = crear('header', { class: 'cabecera' },
        crear('h1', { text: 'LinuxLearn' }),
        crear('p', { class: 'lema', text: 'Practica la linea de ordenes de Linux en tu navegador.' })
    );

    const lateral = crear('nav', { class: 'lateral', 'aria-label': 'Misiones' });
    const panel = crear('section', { class: 'panel-mision' });
    const terminal = crear('div', { class: 'terminal', 'aria-label': 'Terminal' });

    raiz.append(cabecera, crear('div', { class: 'cuerpo' }, lateral, crear('main', { class: 'principal' },
        crear('h2', { class: 'rotulo-terminal', text: 'Terminal' }),
        terminal,
        panel
    )));

    return { raiz, lateral, panel, terminal };
}

/** Lista lateral con el estado de cada mision. */
function pintarMisiones(contenedor, progreso, activa, alElegir) {
    contenedor.textContent = '';
    const completadas = Object.values(progreso.misiones).filter((m) => m.superada).length;

    contenedor.append(crear('p', { class: 'progreso' },
        crear('strong', { text: completadas + ' / ' + NIVELES.length }),
        ' misiones superadas'
    ));

    const lista = crear('ol', { class: 'misiones' });
    for (const mision of NIVELES) {
        const hecha = Boolean(progreso.misiones[mision.id]?.superada);
        const item = crear('li', {
            class: 'mision' + (hecha ? ' hecha' : '') + (mision.id === activa ? ' activa' : '')
        },
            crear('button', { class: 'mision-boton', type: 'button' },
                crear('span', { class: 'numero', text: String(mision.id) }),
                crear('span', { class: 'nombre', text: mision.titulo }),
                crear('span', { class: 'modo-mini', text: mision.modo })
            )
        );
        item.querySelector('button').addEventListener('click', () => alElegir(mision.id));
        lista.append(item);
    }
    contenedor.append(lista);
}

function arrancar() {
    const { lateral, panel, terminal } = esqueleto();
    const almacen = window.localStorage ?? null;
    let progreso = leerProgreso(almacen);
    let actual = progreso.ultimo ?? siguienteMision(progreso, NIVELES)?.id ?? 1;
    let enganche = null;

    const tty = montarTerminal(terminal, {
        historialInicial: progreso.historial ?? []
    });

    function mostrar(id) {
        const mision = misionPorId(id);
        if (!mision) return;
        actual = id;
        progreso.ultimo = id;
        progreso.historial = tty.historial();
        progreso.misiones[id] = { ...progreso.misiones[id], abierta: true };
        try { window.localStorage?.setItem('lxl_progreso', JSON.stringify(progreso)); } catch (e) { /* modo privado */ }

        // El panel se monta despues para poder engancharlo a la terminal: asi
        // cada comando que el alumno ejecuta se comprueba al momento.
        enganche = montarPanel(panel, mision, {
            almacen,
            siguienteMision: () => {
                const progresoActual = leerProgreso(almacen);
                const siguiente = siguienteMision(progresoActual, NIVELES);
                if (siguiente) mostrar(siguiente.id);
                else tty.enfocar();
            },
            onSuperada: () => {
                progreso = leerProgreso(almacen);
                progreso.ultimo = id;
                progreso.historial = tty.historial();
                pintarMisiones(lateral, progreso, actual, mostrar);
            }
        });
        tty.alEjecutar = (guion, resultado) => enganche?.comandoEjecutado?.(guion, resultado);
        pintarMisiones(lateral, progreso, actual, mostrar);
    }

    pintarMisiones(lateral, progreso, actual, mostrar);
    mostrar(actual);
    tty.enfocar();

    // Cualquier clic en la pagina devuelve el foco a la terminal: es la única
    // forma de escribir, y si pierde el foco parece que no responde.
    document.addEventListener('click', (evento) => {
        const etiqueta = evento.target?.tagName ?? '';
        if (['INPUT', 'TEXTAREA', 'BUTTON', 'A', 'SUMMARY'].includes(etiqueta)) return;
        tty.enfocar();
    });
}

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', arrancar);
    else arrancar();
}

export { arrancar };
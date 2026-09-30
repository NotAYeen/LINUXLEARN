/**
 * Punto de entrada de la interfaz: el terminal, el panel de mision y el
 * progreso. Solo esta capa toca el DOM; el motor (src/engine) no lo hace nunca.
 */

import '../css/style.css';
import { NIVELES, misionPorId } from './levels.js';
import { leerProgreso, registrarSesion, siguienteMision } from './check.js';
import { montarTerminal, crear } from './ui/terminal.js';
import { montarPanel } from './ui/panel.js';
import { montarAcciones } from './ui/acciones.js';

/** Estructura de la pagina: barra lateral con misiones y zona principal. */
function esqueleto() {
    const raiz = document.getElementById('app');
    raiz.textContent = '';

    const barraAcciones = crear('div', { class: 'acciones-zona' });
    const cabecera = crear('header', { class: 'cabecera' },
        crear('div', { class: 'titulos' },
            crear('h1', { text: 'LinuxLearn' }),
            crear('p', { class: 'lema', text: 'Practica la linea de ordenes de Linux en tu navegador.' })
        ),
        barraAcciones
    );

    const lateral = crear('nav', { class: 'lateral', 'aria-label': 'Misiones' });
    const panel = crear('section', { class: 'panel-mision' });
    const terminal = crear('div', { class: 'terminal', 'aria-label': 'Terminal' });

    raiz.append(cabecera, crear('div', { class: 'cuerpo' }, lateral, crear('main', { class: 'principal' },
        crear('h2', { class: 'rotulo-terminal', text: 'Terminal' }),
        terminal,
        panel
    )));

    return { raiz, lateral, panel, terminal, barraAcciones };
}

/** Lista lateral con el estado de cada mision. */
function pintarMisiones(contenedor, progreso, activa, alElegir) {
    contenedor.textContent = '';
    const completadas = Object.values(progreso.misiones).filter((m) => m.superada).length;
    const tanto = Math.round((completadas / NIVELES.length) * 100);

    const barra = crear('div', { class: 'barra-progreso', role: 'progressbar', 'aria-valuenow': String(tanto), 'aria-valuemin': '0', 'aria-valuemax': '100' },
        crear('div', { class: 'relleno', style: 'width: ' + tanto + '%' })
    );
    contenedor.append(crear('p', { class: 'progreso' },
        crear('strong', { text: completadas + ' / ' + NIVELES.length }),
        ' misiones superadas',
        crear('span', { class: 'porcentaje', text: tanto + ' %' })
    ), barra);

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
    const contenedor = document.getElementById('app');
    // El modulo se ejecuta al importarse, y los tests lo llaman a mano mas de
    // una vez: si no hay contenedor, no hay nada que montar.
    if (!contenedor) return;
    const { lateral, panel: zonaPanel, terminal, barraAcciones } = esqueleto();
    const almacen = window.localStorage ?? null;
    let progreso = leerProgreso(almacen);
    let actual = progreso.ultimo ?? siguienteMision(progreso, NIVELES)?.id ?? 1;

    const tty = montarTerminal(terminal, {
        historialInicial: progreso.historial ?? []
    });

    /** Repinta la lateral con el progreso que haya ahora mismo. */
    function refrescar() {
        progreso = leerProgreso(almacen);
        progreso.ultimo = actual;
        progreso.historial = tty.historial();
        pintarMisiones(lateral, progreso, actual, mostrar);
        acciones.sincroniza(actual, Boolean(progreso.misiones[actual]?.superada));
    }

    /** Guarda la posicion (mision abierta + historial) y repinta. */
    function guardar() {
        acciones.guardaSesion(actual, tty.historial());
        refrescar();
    }

    function mostrar(id) {
        const mision = misionPorId(id);
        if (!mision) return;
        actual = id;
        acciones.cancelaConfirmacion();
        // El progreso lo escribe `check.js`: antes lo hacia esta misma funcion a
        // mano, y por eso los errores de almacenamiento pasaban desapercibidos.
        acciones.guardaSesion(id, tty.historial());

        // El panel se monta despues para poder engancharlo a la terminal: asi
        // cada comando que el alumno ejecuta se comprueba al momento.
        const panelMision = montarPanel(zonaPanel, mision, {
            almacen,
            siguienteMision: () => {
                const siguiente = siguienteMision(leerProgreso(almacen), NIVELES);
                if (siguiente) mostrar(siguiente.id);
                else tty.enfocar();
            },
            onSuperada: () => guardar()
        });
        // El panel devuelve `alComando` plano. Antes `main.js` sacaba el enganche de
        // un nivel mas arriba, y el acierto automatico no llegaba a comprobarse
        // nunca en la pagina (los tests lo montaban a mano y no lo cazaban).
        tty.alEjecutar = (guion, resultado) => panelMision.alComando?.(guion, resultado);
        refrescar();
    }

    const acciones = montarAcciones(barraAcciones, {
        almacen,
        tty,
        alCambiarProgreso: (cambio = {}) => {
            if (cambio.restablecido) {
                actual = 1;
                mostrar(1);
            } else if (cambio.importado) {
                constTraido = leerProgreso(almacen);
                actual = siguienteMision(progresoTraido, NIVELES)?.id ?? 1;
                mostrar(actual);
            } else {
                refrescar();
            }
        }
    });

    mostrar(actual);
    acciones.compruebaAlmacenamiento();
    refrescar();
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
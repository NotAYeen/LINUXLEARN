/**
 * @vitest-environment jsdom
 *
 * Este es el unico fichero que necesita DOM: monta el terminal y el panel de
 * mision sobre un documento de verdad. Se declara aqui el entorno para no
 * obligar a todo `npm test` a levantar jsdom.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { montarTerminal, crear } from '../src/ui/terminal.js';
import { montarPanel, desordenar } from '../src/ui/panel.js';
import { evaluar, leerProgreso, registrarSuperada, siguienteMision, guardarProgreso } from '../src/check.js';
import { NIVELES, misionPorId } from '../src/levels.js';

/** `localStorage` de mentira: los tests no tocan el del navegador. */
function almacenFalso() {
    const datos = new Map();
    return {
        getItem: (k) => (datos.has(k) ? datos.get(k) : null),
        setItem: (k, v) => datos.set(k, String(v)),
        removeItem: (k) => datos.delete(k),
        get size() { return datos.size; }
    };
}

describe('terminal', () => {
    let raiz;
    beforeEach(() => { raiz = document.createElement('div'); document.body.append(raiz); });

    it('crea la pantalla y la linea de entrada', () => {
        montarTerminal(raiz);
        expect(raiz.querySelector('.pantalla')).toBeTruthy();
        expect(raiz.querySelector('.campo')).toBeTruthy();
        expect(raiz.querySelector('.prompt').textContent).toBe('agente@linuxlearn:~$ ');
    });

    it('ejecuta lo que se escribe y lo pinta como texto', () => {
        const tty = montarTerminal(raiz);
        tty.escribir('echo hola');
        tty.ejecutar();
        expect(tty.texto()).toContain('hola');
        // La salida se crea como nodo de texto, nunca como HTML: si el alumno
        // escribe una etiqueta, esta aparece como texto.
        tty.escribir('echo "<b>etiqueta</b>"');
        tty.ejecutar();
        expect(raiz.querySelectorAll('b').length).toBe(0);
        expect(tty.texto()).toContain('<b>etiqueta</b>');
    });

    it('no ejecuta innerHTML con la salida del shell', () => {
        const tty = montarTerminal(raiz);
        tty.escribir("echo '<img src=x onerror=alert(1)>'");
        tty.ejecutar();
        expect(raiz.querySelector('img')).toBeNull();
        expect(tty.texto()).toContain('<img src=x');
    });

    it('pinta el error en la clase error y vacia el campo', () => {
        const tty = montarTerminal(raiz);
        tty.escribir('ls /noexiste');
        tty.ejecutar();
        expect(tty.texto()).toContain('No such file or directory');
        expect(raiz.querySelectorAll('.linea.error').length).toBeGreaterThan(0);
    });

    it('guarda el historial y sugiere con el prefijo', () => {
        const tty = montarTerminal(raiz);
        tty.escribir('echo uno');
        tty.ejecutar();
        tty.escribir('ls /var');
        tty.ejecutar();
        expect(tty.historial()).toEqual(['echo uno', 'ls /var']);
        expect(tty.sesion.sugerencias('gr')).toContain('grep');
    });

    it('el codigo de salida se comunica al panel', () => {
        const tty = montarTerminal(raiz, { onEstado: (e) => { tty.ultimoEstado = e; } });
        tty.escribir('false');
        tty.ejecutar();
        expect(tty.ultimoEstado.code).toBe(1);
    });
});

describe('panel de mision', () => {
    let raiz;
    beforeEach(() => { raiz = document.createElement('div'); document.body.append(raiz); });

    it('muestra titulo, modo, dificultad y objetivos', () => {
        montarPanel(raiz, misionPorId(1));
        expect(raiz.querySelector('.mision-titulo').textContent).toBeTruthy();
        expect(raiz.querySelector('.etiqueta.modo').textContent).toBe('Terminal');
        expect(raiz.querySelectorAll('.objetivos li').length).toBeGreaterThan(0);
    });

    it('la modalidad Terminal comprueba la solucion', () => {
        const mision = misionPorId(1);
        let veredicto = null;
        montarPanel(raiz, mision, { onSuperada: () => { veredicto = 'superada'; } });
        const campo = raiz.querySelector('.campo-solucion');
        campo.value = mision.soluciones[0];
        raiz.querySelector('.boton.comprobar').click();
        expect(raiz.querySelector('.veredicto').className).toContain('ok');
        expect(veredicto).toBe('superada');
    });

    it('un comando equivocado no pasa', () => {
        const mision = misionPorId(1);
        montarPanel(raiz, mision);
        const campo = raiz.querySelector('.campo-solucion');
        campo.value = 'ls /tmp';
        raiz.querySelector('.boton.comprobar').click();
        expect(raiz.querySelector('.veredicto').className).toContain('mal');
    });

    it('la modalidad Depuracion muestra el comando roto y su salida', () => {
        const mision = NIVELES.find((m) => m.modo === 'Depuracion');
        montarPanel(raiz, mision);
        expect(raiz.querySelector('.comando-roto').textContent).toBe(mision.fallo.comando);
        expect(raiz.querySelector('.fallo-salida').textContent).toContain(mision.fallo.salida);
    });

    it('la modalidad Auditoria acepta el token erroneo', () => {
        const mision = NIVELES.find((m) => m.modo === 'Auditoria');
        montarPanel(raiz, mision);
        const campo = raiz.querySelector('.campo-token');
        campo.value = String(mision.auditoria.indice_error);
        raiz.querySelector('.boton.comprobar').click();
        expect(raiz.querySelector('.veredicto').className).toContain('ok');
        expect(raiz.querySelector('.tokens li.token-mal')).toBeTruthy();
    });

    it('la modalidad Ensamblaje empieza desordenada y se puede ordenar', () => {
        const mision = NIVELES.find((m) => m.modo === 'Ensamblaje');
        montarPanel(raiz, mision);
        expect(raiz.querySelectorAll('.etapa code').length).toBe(mision.bloques.length);

        // Ordenar con los botones: se busca la etapa que va despues y se
        // baja hasta su sitio, como haria el alumno con los triangulos.
        for (let destino = 0; destino < mision.bloques.length; destino++) {
            const elementos = [...raiz.querySelectorAll('.etapa code')];
            const posicion = elementos.findIndex((nodo) => nodo.textContent === mision.bloques[destino]);
            for (let i = posicion; i > destino; i--) {
                raiz.querySelectorAll('.etapa')[i].querySelector('.arriba').click();
            }
        }

        raiz.querySelector('.boton.comprobar').click();
        expect(raiz.querySelector('.veredicto').className).toContain('ok');
    });

    it('las pistas se revelan de una en una', () => {
        montarPanel(raiz, misionPorId(1));
        const boton = raiz.querySelector('.pista-boton');
        boton.click();
        expect(raiz.querySelectorAll('.pista').length).toBe(1);
        boton.click();
        expect(raiz.querySelectorAll('.pista').length).toBe(2);
    });

    it('la mezcla de etapas es determinista', () => {
        const mision = NIVELES.find((m) => m.modo === 'Ensamblaje');
        expect(desordenar(mision.bloques, mision.id)).toEqual(desordenar(mision.bloques, mision.id));
        expect([...desordenar(mision.bloques, mision.id)].sort()).toEqual([...mision.bloques].sort());
    });
});

describe('progreso', () => {
    it('guarda y lee con el prefijo lxl_', () => {
        const almacen = almacenFalso();
        registrarSuperada(almacen, 3);
        expect(almacen.getItem('lxl_progreso')).toBeTruthy();
        const progreso = leerProgreso(almacen);
        expect(progreso.misiones[3].superada).toBe(true);
        expect(progreso.ultimo).toBe(3);
    });

    it('sigue el avance hasta la primera sin superar', () => {
        const almacen = almacenFalso();
        for (const id of [1, 2, 3, 4]) registrarSuperada(almacen, id);
        expect(siguienteMision(leerProgreso(almacen), NIVELES).id).toBe(5);
    });

    it('devuelve null si esta todo hecho', () => {
        const almacen = almacenFalso();
        for (const m of NIVELES) registrarSuperada(almacen, m.id);
        expect(siguienteMision(leerProgreso(almacen), NIVELES)).toBeNull();
    });

    it('aguanta un almacenamiento roto', () => {
        expect(leerProgreso({ getItem: () => '{no es json' })).toEqual({ misiones: {}, ultimo: null });
        expect(guardarProgreso(null, {})).toBe(true);
        expect(guardarProgreso({ setItem() { throw new Error('lleno'); } }, {})).toBe(false);
    });
});

describe('evaluacion de misiones', () => {
    it('acepta la solucion de referencia de cada Terminal', () => {
        for (const mision of NIVELES.filter((m) => m.modo === 'Terminal' && m.comprobaciones?.length)) {
            const r = evaluar(mision, mision.soluciones[0]);
            expect(r.correcto, mision.id + ': ' + mision.soluciones[0]).toBe(true);
        }
    });

    it('da detalles legibles cuando falla', () => {
        const mision = misionPorId(1);
        const r = evaluar(mision, 'echo nada que ver');
        expect(r.correcto).toBe(false);
        expect(r.detalles.length).toBeGreaterThan(0);
        expect(typeof r.detalles[0].texto).toBe('string');
    });

    it('usa las comprobaciones de fs', () => {
        const mision = {
            id: 999,
            titulo: 'prueba',
            modo: 'Terminal',
            soluciones: ['echo x > /tmp/prueba-check.txt'],
            comprobaciones: [{ fs: { path: '/tmp/prueba-check.txt', exists: true, content: 'x' } }]
        };
        expect(evaluar(mision, mision.soluciones[0]).correcto).toBe(true);
        expect(evaluar(mision, 'echo y > /tmp/prueba-check.txt').correcto).toBe(false);
    });
});

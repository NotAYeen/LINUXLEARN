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
    let terminalRaiz;
    beforeEach(() => {
        raiz = document.createElement('div');
        terminalRaiz = document.createElement('div');
        document.body.append(raiz, terminalRaiz);
    });

    it('muestra titulo, modo, dificultad y objetivos', () => {
        montarPanel(raiz, misionPorId(1));
        expect(raiz.querySelector('.mision-titulo').textContent).toBeTruthy();
        expect(raiz.querySelector('.etiqueta.modo').textContent).toBe('Terminal');
        expect(raiz.querySelectorAll('.objetivos li').length).toBeGreaterThan(0);
    });

    it('la modalidad Terminal comprueba lo que se ejecuta en la terminal', () => {
        const mision = misionPorId(1);
        let superada = null;
        const { enganche } = montarPanel(raiz, mision, { onSuperada: (id) => { superada = id; } });

        // Al abrir la mision el panel espera a que el alumno escriba.
        expect(raiz.querySelector('.seguimiento').textContent).toContain('terminal');
        // No hay textarea: el comando se escribe en la terminal, no en un cuadro.
        expect(raiz.querySelector('.campo-solucion')).toBeNull();

        enganche.comandoEjecutado(mision.soluciones[0]);
        expect(raiz.querySelector('.seguimiento').className).toContain('ok');
        expect(superada).toBe(mision.id);
    });

    it('detecta el acierto sin pulsar el boton', () => {
        const mision = NIVELES.find((m) => m.modo === 'Terminal');
        let superada = null;
        const { enganche } = montarPanel(raiz, mision, { onSuperada: (id) => { superada = id; } });
        // Ni un clic: solo el comando escrito en la terminal.
        enganche.comandoEjecutado(mision.soluciones[0]);
        expect(raiz.querySelector('.seguimiento').className).toContain('ok');
        expect(superada).toBe(mision.id);
    });

    it('acepta cualquier comando equivalente al de referencia', () => {
        // Mision 3: `cat ~/proyecto/notas.txt` y `cat proyecto/notas.txt` dan lo
        // mismo, y los dos valen: lo que se comprueba es el contrato, no el texto.
        const mision = misionPorId(3);
        const { enganche } = montarPanel(raiz, mision);
        enganche.comandoEjecutado('cat proyecto/notas.txt');
        expect(raiz.querySelector('.seguimiento').className).toContain('ok');
    });

    it('no regaña mientras el alumno prueba comandos', () => {
        const mision = misionPorId(1);
        const { enganche } = montarPanel(raiz, mision);
        enganche.comandoEjecutado('ls');
        enganche.comandoEjecutado('ls -a');
        // Todavia no dice nada: la terminal ya ha mostrado la salida.
        expect(raiz.querySelector('.seguimiento').className).toContain('esperando');
        // A partir del tercer intento si da una pista.
        enganche.comandoEjecutado('ls -l /etc');
        expect(raiz.querySelector('.seguimiento').textContent).toMatch(/Todavia no|llevo mal/);
    });

    it('una vez acertado no vuelve a comprobar', () => {
        const mision = misionPorId(1);
        let veces = 0;
        const { enganche } = montarPanel(raiz, mision, { onSuperada: () => { veces++; } });
        enganche.comandoEjecutado(mision.soluciones[0]);
        enganche.comandoEjecutado('ls');
        expect(veces).toBe(1);
    });

    it('un comando equivocado no pasa y explica la diferencia', () => {
        const mision = misionPorId(1);
        const { enganche } = montarPanel(raiz, mision);
        // Con tres intentos fallidos el panel ya da la diferencia.
        for (let i = 0; i < 3; i++) enganche.comandoEjecutado('ls /tmp');
        expect(raiz.querySelector('.seguimiento').className).toContain('mal');
        expect(raiz.querySelector('.seguimiento').textContent).toMatch(/Todavia no/);
    });

    it('un comando que falla tampoco molesta: lo dice la terminal', () => {
        const mision = misionPorId(1);
        const { enganche } = montarPanel(raiz, mision);
        enganche.comandoEjecutado('ordeninventada');
        // Con un solo intento el panel sigue callado; el error ya se ve abajo.
        expect(raiz.querySelector('.seguimiento').className).toContain('esperando');
        // Cuando el alumno insiste, se le distingue del "no has acertado".
        for (let i = 0; i < 3; i++) enganche.comandoEjecutado('ordeninventada');
        expect(raiz.querySelector('.seguimiento').className).toContain('error');
    });

    it('el boton comprueba el ultimo comando escrito en la terminal', () => {
        const mision = misionPorId(1);
        const tty = montarTerminal(terminalRaiz, {});
        const { enganche } = montarPanel(raiz, mision);
        tty.alEjecutar = (guion) => enganche.comandoEjecutado(guion);
        tty.escribir('ls');
        tty.ejecutar();
        // Con un solo intento fallido el panel calla; el boton lo hace hablar.
        raiz.querySelector('.boton.comprobar').click();
        expect(raiz.querySelector('.seguimiento').textContent).toMatch(/Todavia no/);
    });

    it('al acertar ofrece pasar a la siguiente mision', () => {
        const mision = misionPorId(1);
        let pedidas = 0;
        const { enganche } = montarPanel(raiz, mision, { siguienteMision: () => { pedidas++; } });
        enganche.comandoEjecutado(mision.soluciones[0]);
        const boton = raiz.querySelector('.boton.siguiente');
        expect(boton).toBeTruthy();
        boton.click();
        expect(pedidas).toBe(1);
    });

    it('la solucion de referencia se puede desplegar', () => {
        const mision = misionPorId(1);
        montarPanel(raiz, mision);
        const ref = raiz.querySelector('.referencia');
        expect(ref.querySelector('.comando-referencia').textContent).toBe(mision.soluciones[0]);
    });

    it('integracion: la terminal manda al panel lo que se ejecuta', () => {
        const mision = misionPorId(1);
        const tty = montarTerminal(terminalRaiz, {});
        const { enganche } = montarPanel(raiz, mision);
        // Asi es como lo conecta main.js.
        tty.alEjecutar = (guion) => enganche.comandoEjecutado(guion);

        tty.escribir('ls');
        tty.ejecutar();
        // La salida real esta en la terminal; el panel todavia no se queja.
        expect(tty.texto()).toContain('respaldos');
        expect(raiz.querySelector('.seguimiento').className).toContain('esperando');

        tty.escribir(mision.soluciones[0]);
        tty.ejecutar();
        expect(raiz.querySelector('.seguimiento').className).toContain('ok');
        expect(tty.ultimoComando()).toBe(mision.soluciones[0]);
    });

    it('el pie de la terminal muestra el codigo de salida', () => {
        const tty = montarTerminal(terminalRaiz, {});
        tty.escribir('true');
        tty.ejecutar();
        expect(terminalRaiz.querySelector('.terminal-pie').textContent).toContain('codigo de salida: 0');
        tty.escribir('false');
        tty.ejecutar();
        expect(terminalRaiz.querySelector('.terminal-pie').textContent).toContain('codigo de salida: 1');
        expect(terminalRaiz.querySelector('.terminal-pie .error')).toBeTruthy();
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

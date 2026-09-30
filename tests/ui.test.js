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
import { montarAcciones } from '../src/ui/acciones.js';
import {
    desmarcarMision, evaluar, exportarProgreso, guardarProgreso, importarProgreso,
    leerProgreso, registrarSesion, registrarSuperada, restablecerProgreso,
    siguienteMision, LIMITE_HISTORIAL
} from '../src/check.js';
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

    it('clear borra la pantalla en vez de pintar el numero raro', () => {
        const tty = montarTerminal(raiz);
        tty.escribir('echo hola');
        tty.ejecutar();
        expect(tty.texto()).toContain('hola');
        tty.escribir('clear');
        tty.ejecutar();
        // La secuencia de escape se ha traducido, no se ha mostrado.
        expect(tty.texto()).not.toContain('hola');
        expect(tty.texto()).not.toContain('[2J');
        // Y el prompt sigue en su sitio, listo para escribir.
        expect(tty.texto()).not.toContain('Maquina');
        tty.escribir('pwd');
        tty.ejecutar();
        expect(tty.texto()).toContain('/home/agente');
    });

    it('history muestra lo mismo que las flechas', () => {
        const tty = montarTerminal(raiz);
        tty.escribir('echo uno');
        tty.ejecutar();
        tty.escribir('history');
        tty.ejecutar();
        // Es el mismo historial: lo que sale por pantalla es lo que pondria la
        // flecha arriba, no una lista distinta.
        expect(tty.texto()).toContain('echo uno');
        expect(tty.historial()).toEqual(['echo uno', 'history']);
    });

    it('reiniciar deja la maquina como estaba y avisa', () => {
        const tty = montarTerminal(raiz);
        // Cada sesion tiene su propio arbol, asi que se mira el de la del
        // terminal. Con `node` en vez de con `ls` para no ensuciar el historial.
        const existe = () => Boolean(tty.sesion.estado.fs.node('/tmp/prueba', { follow: false }));

        tty.escribir('mkdir /tmp/prueba');
        tty.ejecutar();
        expect(existe()).toBe(true);
        expect(tty.historial()).toEqual(['mkdir /tmp/prueba']);

        tty.reiniciar([]);
        // El arbol vuelve a su estado inicial: lo que se creo, fuera.
        expect(existe()).toBe(false);
        expect(tty.historial()).toEqual([]);
        // El prompt tambien: la sesion nueva empieza en el directorio inicial.
        tty.escribir('pwd');
        tty.ejecutar();
        expect(tty.texto()).toContain('/home/agente');
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
        const { alComando } = montarPanel(raiz, mision, { onSuperada: (id) => { superada = id; } });

        // Al abrir la mision el panel espera a que el alumno escriba.
        expect(raiz.querySelector('.seguimiento').textContent).toContain('terminal');
        // No hay textarea: el comando se escribe en la terminal, no en un cuadro.
        expect(raiz.querySelector('.campo-solucion')).toBeNull();

        alComando(mision.soluciones[0]);
        expect(raiz.querySelector('.seguimiento').className).toContain('ok');
        expect(superada).toBe(mision.id);
    });

    it('detecta el acierto sin pulsar el boton', () => {
        const mision = NIVELES.find((m) => m.modo === 'Terminal');
        let superada = null;
        const { alComando } = montarPanel(raiz, mision, { onSuperada: (id) => { superada = id; } });
        // Ni un clic: solo el comando escrito en la terminal.
        alComando(mision.soluciones[0]);
        expect(raiz.querySelector('.seguimiento').className).toContain('ok');
        expect(superada).toBe(mision.id);
    });

    it('acepta cualquier comando equivalente al de referencia', () => {
        // Mision 3: `cat ~/proyecto/notas.txt` y `cat proyecto/notas.txt` dan lo
        // mismo, y los dos valen: lo que se comprueba es el contrato, no el texto.
        const mision = misionPorId(3);
        const { alComando } = montarPanel(raiz, mision);
        alComando('cat proyecto/notas.txt');
        expect(raiz.querySelector('.seguimiento').className).toContain('ok');
    });

    it('no regaña mientras el alumno prueba comandos', () => {
        const mision = misionPorId(1);
        const { alComando } = montarPanel(raiz, mision);
        alComando('ls');
        alComando('ls -a');
        // Todavia no dice nada: la terminal ya ha mostrado la salida.
        expect(raiz.querySelector('.seguimiento').className).toContain('esperando');
        // A partir del tercer intento si da una pista.
        alComando('ls -l /etc');
        expect(raiz.querySelector('.seguimiento').textContent).toMatch(/Todavia no|llevo mal/);
    });

    it('una vez acertado no vuelve a comprobar', () => {
        const mision = misionPorId(1);
        let veces = 0;
        const { alComando } = montarPanel(raiz, mision, { onSuperada: () => { veces++; } });
        alComando(mision.soluciones[0]);
        alComando('ls');
        expect(veces).toBe(1);
    });

    it('un comando equivocado no pasa y explica la diferencia', () => {
        const mision = misionPorId(1);
        const { alComando } = montarPanel(raiz, mision);
        // Con tres intentos fallidos el panel ya da la diferencia.
        for (let i = 0; i < 3; i++) alComando('ls /tmp');
        expect(raiz.querySelector('.seguimiento').className).toContain('mal');
        expect(raiz.querySelector('.seguimiento').textContent).toMatch(/Todavia no/);
    });

    it('un comando que falla tampoco molesta: lo dice la terminal', () => {
        const mision = misionPorId(1);
        const { alComando } = montarPanel(raiz, mision);
        alComando('ordeninventada');
        // Con un solo intento el panel sigue callado; el error ya se ve abajo.
        expect(raiz.querySelector('.seguimiento').className).toContain('esperando');
        // Cuando el alumno insiste, se le distingue del "no has acertado".
        for (let i = 0; i < 3; i++) alComando('ordeninventada');
        expect(raiz.querySelector('.seguimiento').className).toContain('error');
    });

    it('el boton comprueba el ultimo comando escrito en la terminal', () => {
        const mision = misionPorId(1);
        const tty = montarTerminal(terminalRaiz, {});
        const { alComando } = montarPanel(raiz, mision);
        tty.alEjecutar = (guion) => alComando(guion);
        tty.escribir('ls');
        tty.ejecutar();
        // Con un solo intento fallido el panel calla; el boton lo hace hablar.
        raiz.querySelector('.boton.comprobar').click();
        expect(raiz.querySelector('.seguimiento').textContent).toMatch(/Todavia no/);
    });

    it('al acertar ofrece pasar a la siguiente mision', () => {
        const mision = misionPorId(1);
        let pedidas = 0;
        const { alComando } = montarPanel(raiz, mision, { siguienteMision: () => { pedidas++; } });
        alComando(mision.soluciones[0]);
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
        const { alComando } = montarPanel(raiz, mision);
        // Asi es como lo conecta main.js.
        tty.alEjecutar = (guion) => alComando(guion);

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
        expect(leerProgreso({ getItem: () => '{no es json' })).toEqual({ misiones: {}, ultimo: null, historial: [] });
        expect(guardarProgreso(null, {})).toBe(true);
        expect(guardarProgreso({ setItem() { throw new Error('lleno'); } }, {})).toBe(false);
    });

    it('guarda el historial y lo restaura al recargar', () => {
        const almacen = almacenFalso();
        registrarSesion(almacen, 3, ['echo uno', 'ls /var']);
        // Recargar la pagina: se vuelve a leer de almacenamiento y el historial
        // sigue ahi. Antes se guardaba pero se descartaba al leer.
        expect(leerProgreso(almacen).historial).toEqual(['echo uno', 'ls /var']);
        expect(leerProgreso(almacen).ultimo).toBe(3);
    });

    it('el historial no crece sin limite', () => {
        const almacen = almacenFalso();
        const demasiados = Array.from({ length: LIMITE_HISTORIAL + 50 }, (_, i) => 'echo ' + i);
        registrarSesion(almacen, 1, demasiados);
        const guardado = leerProgreso(almacen).historial;
        expect(guardado.length).toBe(LIMITE_HISTORIAL);
        // Se queda con lo ultimo, que es lo que el alumno quiere recuperar.
        expect(guardado[guardado.length - 1]).toBe('echo ' + (LIMITE_HISTORIAL + 49));
    });

    it('registrarSuperada no borra el resto del registro de la mision', () => {
        const almacen = almacenFalso();
        registrarSesion(almacen, 5, ['echo uno']);
        registrarSuperada(almacen, 5);
        const registro = leerProgreso(almacen).misiones[5];
        expect(registro.superada).toBe(true);
        expect(registro.abierta).toBe(true);
        expect(registro.fecha).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('desmarcar una mision la deja pendiente otra vez', () => {
        const almacen = almacenFalso();
        registrarSuperada(almacen, 2);
        desmarcarMision(almacen, 2);
        expect(leerProgreso(almacen).misiones[2].superada).toBe(false);
    });

    it('exportar e importar deja el progreso igual', () => {
        const almacen = almacenFalso();
        registrarSesion(almacen, 1, ['echo uno']);
        registrarSuperada(almacen, 1);
        registrarSuperada(almacen, 2);
        const texto = exportarProgreso(almacen);

        // Otro dispositivo, otro almacenamiento.
        const otro = almacenFalso();
        const { progreso, error } = importarProgreso(texto);
        expect(error).toBeUndefined();
        guardarProgreso(otro, progreso);
        expect(leerProgreso(otro)).toEqual(leerProgreso(almacen));
    });

    it('importar un texto que no es un progreso lo explica y no toca nada', () => {
        const almacen = almacenFalso();
        registrarSuperada(almacen, 1);
        for (const texto of ['hola', '[1,2,3]', '"cadena"', '', '{}', 'null']) {
            const { error } = importarProgreso(texto);
            expect(error, texto).toMatch(/LinuxLearn|no contiene/);
        }
        // El progreso sigue ahi: un texto raro no lo borra.
        expect(leerProgreso(almacen).misiones[1].superada).toBe(true);
    });

    it('importar descarta lo que no tiene forma de progreso', () => {
        const { progreso } = importarProgreso(JSON.stringify({
            misiones: { 1: { superada: true }, x: { superada: true }, 2: 'nope' },
            ultimo: 'no es un numero',
            historial: ['echo uno', 42, null]
        }));
        expect(progreso.misiones[1].superada).toBe(true);
        expect(progreso.misiones.x).toBeUndefined();
        expect(progreso.misiones['2']).toBeUndefined();
        expect(progreso.ultimo).toBeNull();
        expect(progreso.historial).toEqual(['echo uno']);
    });

    it('restablecer borra el progreso entero', () => {
        const almacen = almacenFalso();
        registrarSesion(almacen, 1, ['echo uno']);
        registrarSuperada(almacen, 1);
        expect(restablecerProgreso(almacen)).toBe(true);
        expect(leerProgreso(almacen)).toEqual({ misiones: {}, ultimo: null, historial: [] });
    });
});

describe('barra de acciones', () => {
    let raiz;
    let almacen;
    let tty;
    let acciones;
    let cambios;

    beforeEach(() => {
        raiz = document.createElement('div');
        document.body.append(raiz);
        almacen = almacenFalso();
        tty = montarTerminal(document.createElement('div'), {});
        cambios = [];
        acciones = montarAcciones(raiz, {
            almacen,
            tty,
            idMision: 1,
            alCambiarProgreso: (cambio) => { cambios.push(cambio ?? {}); }
        });
    });

    it('explica el peligro antes de borrar nada', () => {
        registrarSesion(almacen, 1, ['echo uno']);
        const explicacion = raiz.querySelector('.aviso-peligro');
        expect(explicacion.hidden).toBe(true);

        // Una pulsacion: solo avisa.
        acciones.botonRestablecer().click();
        expect(explicacion.hidden).toBe(false);
        expect(acciones.botonRestablecer().textContent).toMatch(/otra vez/);
        expect(leerProgreso(almacen).historial).toEqual(['echo uno']);
        expect(cambios.length).toBe(0);

        // Dos: borra.
        acciones.botonRestablecer().click();
        expect(leerProgreso(almacen)).toEqual({ misiones: {}, ultimo: null, historial: [] });
        expect(cambios).toEqual([{ restablecido: true }]);
        expect(acciones.aviso()).toMatch(/borrado/i);
    });

    it('cancelar la confirmacion deja el progreso intacto', () => {
        acciones.botonRestablecer().click();
        acciones.cancelaConfirmacion();
        expect(raiz.querySelector('.aviso-peligro').hidden).toBe(true);
        acciones.botonRestablecer().click();
        // Vuelve a preguntar: el primer clic ya no cuenta como el segundo.
        expect(raiz.querySelector('.aviso-peligro').hidden).toBe(false);
    });

    it('reiniciar la maquina no toca el progreso', () => {
        registrarSuperada(almacen, 1);
        tty.escribir('mkdir /tmp/guara');
        tty.ejecutar();
        acciones.botonMaquina().click();
        expect(leerProgreso(almacen).misiones[1].superada).toBe(true);
        expect(tty.sesion.ejecutar('ls /tmp/guara').stdout).toBe('');
    });

    it('rehacer quita la marca de superada', () => {
        registrarSuperada(almacen, 1);
        acciones.sincroniza(1, true);
        acciones.botonRehacer().click();
        expect(leerProgreso(almacen).misiones[1].superada).toBe(false);
        expect(acciones.aviso()).toMatch(/pendiente/i);
    });

    it('rehacer se esconde si la mision no esta superada', () => {
        acciones.sincroniza(1, false);
        expect(acciones.botonRehacer().hidden).toBe(true);
    });

    it('exportar genera el texto y lo deja a mano', () => {
        registrarSuperada(almacen, 1);
        acciones.botonExportar().click();
        expect(acciones.caja().value).toBe(exportarProgreso(almacen));
        expect(acciones.caja().hidden).toBe(false);
    });

    it('importar acepta un progreso valido y rechaza el que no lo es', () => {
        registrarSesion(almacen, 1, ['echo uno']);
        registrarSuperada(almacen, 1);
        const texto = exportarProgreso(almacen);

        acciones.caja().value = 'esto no vale';
        acciones.botonConfirmarImportar().click();
        expect(acciones.aviso()).toMatch(/No se ha importado/);

        acciones.caja().value = texto;
        acciones.botonConfirmarImportar().click();
        expect(acciones.aviso()).toMatch(/1 misiones/);
        expect(cambios).toEqual([{ importado: true }]);
    });

    it('avisa una vez si el navegador no deja guardar', () => {
        const otros = montarAcciones(document.createElement('div'), { almacen: null, tty });
        expect(otros.compruebaAlmacenamiento()).toBe(false);
        expect(otros.aviso()).toMatch(/modo privado/);
    });

    it('avisa si el almacenamiento esta lleno y sigue funcionando', () => {
        const lleno = { getItem: () => null, setItem() { throw new Error('quota'); } };
        const otros = montarAcciones(document.createElement('div'), { almacen: lleno, tty });
        expect(otros.compruebaAlmacenamiento()).toBe(false);
        expect(otros.aviso()).toMatch(/no se esta guardando|no se est[aá] guardando/);
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

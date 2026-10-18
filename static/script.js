const Q = n => 'Q' + Number(n || 0).toFixed(2);

// Escapa texto escrito por usuarios antes de meterlo en el HTML
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* ===================== ESTADO (copia en memoria de lo que hay en la base de datos) ===================== */
const state = {
  // --- Lo define el NEGOCIO (el cliente solo lee) ---
  precios: { porGramo: 0, porHora: 0 },
  materiales: [],          // { id, nombre, mult }
  colores: [],             // { id, nombre }
  productos: [],           // { id, nombre, desc, precio, existencias }
  filamentos: [],          // { id, nombre, restante, costo }
  camaras: [],             // { id, nombre, estado, archivo }

  // --- Lo del CLIENTE ---
  perfil: null,            // fila de 'usuarios'
  archivos: [],
  carrito: [],
  pedidos: [],

  // --- Lo que ve el NEGOCIO ---
  carritosNegocio: [],
  archivosNegocio: [],

  // --- Constantes técnicas para estimar peso y tiempo desde el STL ---
  densidad: 1.24,
  velocidadImpresion: 14,
  lastQuote: null,
};

function toast(msg){
  let t = document.createElement('div');
  t.textContent = msg;
  t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#10140f;border:1px solid #2fae6b;color:#f3f5f1;padding:12px 20px;border-radius:8px;font-size:13.5px;max-width:calc(100vw - 32px);text-align:center;z-index:999;box-shadow:0 8px 24px rgba(0,0,0,.5)';
  document.body.appendChild(t);
  setTimeout(()=>t.remove(), 2800);
}
function fmtFecha(ts){ const d=new Date(ts); return String(d.getDate()).padStart(2,'0')+'/'+String(d.getMonth()+1).padStart(2,'0'); }
const idCarrito = n => 'C-' + String(n).padStart(3,'0');

// Revisa el resultado de una consulta a Supabase; avisa si falló
function okDB(res, msg){
  if(res.error){
    console.error(res.error);
    toast((msg || 'Error') + ': ' + res.error.message);
    return false;
  }
  return true;
}

/* ===================== AUTENTICACIÓN & SUPABASE ===================== */
let supabase = null;

async function initSupabase() {
  if (supabase) return true;
  try {
    const supabaseLib = window.supabase;
    if (!supabaseLib || typeof supabaseLib.createClient !== 'function') {
      alert("Error: La librería de Supabase no se ha cargado en el HTML.");
      return false;
    }
    const res = await fetch('/api/config');
    const config = await res.json();
    if (!config.supabaseUrl || !config.supabaseKey) {
      alert("Error: Flask no devolvió credenciales válidas en /api/config");
      return false;
    }
    supabase = supabaseLib.createClient(config.supabaseUrl, config.supabaseKey);
    return true;
  } catch (err) {
    console.error("Error al inicializar Supabase:", err);
    alert("Error de conexión: " + err.message);
    return false;
  }
}

// Al cargar la página: si ya hay sesión abierta, entra directo según su rol
document.addEventListener('DOMContentLoaded', async () => {
  const ok = await initSupabase();
  if (!ok) return;
  const { data: { session } } = await supabase.auth.getSession();
  if (session) mostrarApp(await obtenerRol());
});

// El rol sale de la base de datos: si la cuenta está en la tabla 'negocio' es admin
async function obtenerRol() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from('negocio').select('id_negocio').eq('auth_id', user.id).maybeSingle();
  if (error) { console.error('Error al leer rol:', error); return 'cliente'; }
  return data ? 'negocio' : 'cliente';
}

function enterApp() {
  const modal = document.getElementById('login-modal');
  if (modal) modal.style.display = 'flex';
}

function cerrarLogin() {
  const modal = document.getElementById('login-modal');
  if (modal) modal.style.display = 'none';
}

function toggleModoAuth(modo) {
  const titulo = document.getElementById('modal-titulo');
  const groupLogin = document.getElementById('btn-login-group');
  const groupRegistro = document.getElementById('btn-registro-group');
  if (modo === 'registro') {
    if (titulo) titulo.textContent = 'Crear Cuenta';
    if (groupLogin) groupLogin.style.display = 'none';
    if (groupRegistro) groupRegistro.style.display = 'block';
  } else {
    if (titulo) titulo.textContent = 'Iniciar Sesión';
    if (groupLogin) groupLogin.style.display = 'block';
    if (groupRegistro) groupRegistro.style.display = 'none';
  }
}

function esEmailValido(email) {
  return /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email);
}

async function mostrarApp(role) {
  const modo = role || 'cliente';
  const landing = document.getElementById('landing');
  const modal = document.getElementById('login-modal');
  const appCliente = document.getElementById('app-cliente');
  const appNegocio = document.getElementById('app-negocio');

  if (landing) landing.style.display = 'none';
  if (modal) modal.style.display = 'none';

  await cargarBase();   // precios, materiales, colores y catálogo (lo ven todos)

  if (modo === 'negocio') {
    if (appCliente) appCliente.style.display = 'none';
    if (appNegocio) appNegocio.style.display = 'flex';
    await cargarNegocio();
    initNegocio();
  } else {
    if (appNegocio) appNegocio.style.display = 'none';
    if (appCliente) appCliente.style.display = 'flex';
    await cargarCliente();
    initCliente();
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showView(app, viewId, btn) {
  const contenedor = document.getElementById(app === 'negocio' ? 'app-negocio' : 'app-cliente');
  if (!contenedor) return;
  contenedor.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  contenedor.querySelectorAll('.side-btn').forEach(b => b.classList.remove('active'));
  const vista = document.getElementById(viewId);
  if (vista) vista.classList.add('active');
  if (btn) btn.classList.add('active');
  // Al cambiar de sección se vuelve a leer la base para ver lo más reciente
  if (app === 'negocio') cargarBase().then(cargarNegocio).then(refrescarNegocio);
  else cargarBase().then(cargarCliente).then(refrescarCliente);
}

async function exitApp() {
  if (supabase) await supabase.auth.signOut();
  location.reload();   // limpia lo que estaba en memoria de esa sesión
}

function enviarMensaje() {
  const asunto = document.getElementById('msg-asunto');
  const cuerpo = document.getElementById('msg-cuerpo');
  if (!asunto.value.trim() || !cuerpo.value.trim()) { toast('Completa el asunto y el mensaje'); return; }
  asunto.value = ''; cuerpo.value = '';
  toast('Mensaje enviado al negocio');
}

async function iniciarSesion() {
  if (!supabase) await initSupabase();
  if (!supabase) return;
  const email = (document.getElementById('login-email')?.value || '').trim();
  const password = (document.getElementById('login-pass')?.value || '').trim();
  if (!email || !password) { alert("Ingresa tu correo y contraseña."); return; }
  try {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) alert("Error de inicio de sesión: " + error.message);
    else mostrarApp(await obtenerRol());
  } catch (err) { console.error("Excepción al iniciar sesión:", err); }
}

// ===================== INICIAR SESIÓN CON GOOGLE =====================
async function iniciarSesionGoogle() {
  if (!supabase) await initSupabase();
  if (!supabase) return;
  try {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin
      }
    });
    if (error) alert("Error al conectar con Google: " + error.message);
  } catch (err) {
    console.error("Excepción con Google Auth:", err);
  }
}

async function registrarse() {
  if (!supabase) await initSupabase();
  if (!supabase) return;
  const emailInput = document.getElementById('login-email');
  const passInput = document.getElementById('login-pass');
  const email = emailInput ? emailInput.value.trim() : '';
  const password = passInput ? passInput.value.trim() : '';
  if (!email || !password) { alert("Por favor completa todos los campos."); return; }
  if (!esEmailValido(email)) { alert("El correo electrónico ingresado no tiene un formato válido."); emailInput.focus(); return; }
  if (password.length < 6) { alert("La contraseña debe tener al menos 6 caracteres."); passInput.focus(); return; }
  try {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) alert("Error al registrar: " + error.message);
    else if (!data.session) { alert("Cuenta creada. Revisa tu correo para confirmarla y luego inicia sesión."); toggleModoAuth('login'); }
    else { alert("¡Cuenta creada con éxito!"); mostrarApp('cliente'); }
  } catch (err) { console.error("Excepción al registrar:", err); }
}

/* ===================== ANIMACIÓN IMPRESORA 3D (decoración de la landing) ===================== */
(function initPrinterScene(){
  const bedY = 278, maxHeight = 210, centerX = 320, halfWidths = 90;
  const profile = [
    {t:0.00, w:46}, {t:0.10, w:52}, {t:0.22, w:34}, {t:0.38, w:48},
    {t:0.55, w:30}, {t:0.72, w:38}, {t:0.86, w:44}, {t:1.00, w:40}
  ];
  const objShape = document.getElementById('objShape');
  const objClipRect = document.getElementById('objClipRect');
  const gantry = document.getElementById('gantryGroup');
  const head = document.getElementById('printHead');
  const printBar = document.getElementById('printBar');
  const printPct = document.getElementById('printPct');
  const printStatus = document.getElementById('printStatus');
  const files = ['maceta_geometrica.stl','llavero_logo.stl','soporte_celular.stl','engranaje_v2.stl'];
  let loopN = 0;
  if(!objShape || !gantry) return;
  const left = profile.map(p => [centerX - p.w, bedY - p.t*maxHeight]);
  const right = profile.map(p => [centerX + p.w, bedY - p.t*maxHeight]).reverse();
  objShape.setAttribute('points', left.concat(right).map(p=>p.join(',')).join(' '));
  const duration = 9000;
  let start = null;
  function frame(ts){
    if(!start) start = ts;
    let t = ((ts - start) % duration) / duration;
    const currentLoop = Math.floor((ts - start) / duration);
    if(currentLoop !== loopN){
      loopN = currentLoop;
      if(printStatus) printStatus.innerHTML = '<span class="rec"></span>Imprimiendo ' + files[loopN % files.length];
    }
    const currentHeight = t * maxHeight;
    const fadeIn = t < 0.03 ? t/0.03 : 1;
    if(objClipRect) { objClipRect.setAttribute('y', bedY - currentHeight); objClipRect.setAttribute('height', currentHeight); }
    objShape.style.opacity = fadeIn;
    gantry.setAttribute('transform', 'translate(0,' + (bedY - currentHeight - 14) + ')');
    const headX = Math.sin(t * 6 * Math.PI * 2) * halfWidths;
    if(head) head.setAttribute('transform', 'translate(' + headX + ',0)');
    const pct = Math.floor(t*100);
    if(printPct) printPct.textContent = pct + '%';
    if(printBar) printBar.style.width = pct + '%';
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();

/* ===================== CARGA DE DATOS DESDE LA BASE ===================== */
// Lo que ven todos: precios, materiales, colores y catálogo
async function cargarBase(){
  const [cfg, mats, cols, prods] = await Promise.all([
    supabase.from('configuracion').select('*').eq('id', 1).maybeSingle(),
    supabase.from('materiales').select('*').order('id'),
    supabase.from('colores').select('*').order('id'),
    supabase.from('productos').select('*').order('id_producto'),
  ]);
  if(cfg.data){
    state.precios = { porGramo: Number(cfg.data.precio_gramo)||0, porHora: Number(cfg.data.precio_hora)||0 };
  }
  state.materiales = (mats.data||[]).map(m=>({ id:m.id, nombre:m.nombre, mult:Number(m.mult) }));
  state.colores    = (cols.data||[]).map(c=>({ id:c.id, nombre:c.nombre }));
  state.productos  = (prods.data||[]).map(p=>({
    id:p.id_producto, nombre:p.nombre, desc:p.descripcion||'', precio:Number(p.precio)||0, existencias:p.existencia||0
  }));
}

async function cargarCliente(){
  const { data: { user } } = await supabase.auth.getUser();
  if(!user) return;

  // La fila de 'usuarios' la crea el trigger al registrarse (correo o Google)
  let per = await supabase.from('usuarios').select('*').eq('auth_id', user.id).maybeSingle();
  if(per.error){ console.error(per.error); toast('No se pudo leer tu perfil: ' + per.error.message); return; }

  // Si la cuenta no tiene perfil todavía (cuenta antigua o Google), se crea solo
  if(!per.data){
    const meta0 = user.user_metadata || {};
    const nombreInicial = meta0.full_name || meta0.name || (user.email || '').split('@')[0];

    // 1) la base lo crea con una función
    const r = await supabase.rpc('asegurar_perfil');
    if(!r.error && r.data){
      per = { data: r.data };
    } else {
      console.warn('asegurar_perfil falló, se intenta crear directo:', r.error);
      // 2) el cliente crea su propio perfil (la política de la base lo permite)
      const ins = await supabase.from('usuarios')
        .insert({ nombre: nombreInicial, correo: user.email, auth_id: user.id })
        .select().maybeSingle();
      if(ins.error || !ins.data){
        console.error(ins.error);
        toast('No se pudo crear tu perfil: ' + (ins.error ? ins.error.message : 'sin respuesta'));
        return;
      }
      per = { data: ins.data };
    }
  }
  state.perfil = per.data;

  const meta = user.user_metadata || {};
  const nombreGoogle = meta.full_name || meta.name || '';
  if(!state.perfil.nombre && nombreGoogle) state.perfil.nombre = nombreGoogle;

  const idUsuarioConsulta = state.perfil.id_user;

  const [arch, carr] = await Promise.all([
    supabase.from('archivos').select('*').eq('id_usuario', idUsuarioConsulta).order('id_archivo', { ascending:false }),
    supabase.from('carritos').select('*, carrito_items(*)').eq('id_usuario', idUsuarioConsulta).order('id_carrito', { ascending:false }),
  ]);

  state.archivos = (arch.data||[]).map(a=>({
    id:a.id_archivo, nombre:a.nombre_archivo, material:a.material||'', color:a.color||'',
    peso:Number(a.peso)||0, tiempo:Number(a.tiempo)||0, precio:Number(a.precio)||0, estado:a.estado||'pendiente'
  }));
  state.pedidos = (carr.data||[]).map(c=>({
    id:c.id_carrito, label:idCarrito(c.id_carrito), total:Number(c.total)||0, estado:c.estado||'pendiente',
    fecha:fmtFecha(c.fecha), items:c.carrito_items||[],
    detalle:(c.carrito_items||[]).map(i=>`${i.nombre} ×${i.cantidad}`).join(', ')
  }));
}

async function cargarNegocio(){
  const [fil, cam, carr, arch] = await Promise.all([
    supabase.from('filamentos').select('*').order('id_filamento'),
    supabase.from('camaras').select('*').order('id_camara'),
    supabase.from('carritos').select('*, usuarios(correo), carrito_items(*)').order('id_carrito', { ascending:false }),
    supabase.from('archivos').select('*, usuarios(correo)').order('id_archivo', { ascending:false }),
  ]);
  state.filamentos = (fil.data||[]).map(f=>({ id:f.id_filamento, nombre:f.tipo||'', restante:f.cantidad||0, costo:Number(f.precio_costo)||0 }));
  state.camaras = (cam.data||[]).map(c=>({ id:c.id_camara, nombre:c.nombre||('Cámara '+c.id_camara), estado:c.estado||'inactiva', archivo:c.archivo||null }));
  state.carritosNegocio = (carr.data||[]).map(c=>({
    id:c.id_carrito, label:idCarrito(c.id_carrito), cliente:(c.usuarios && c.usuarios.correo) || '—',
    total:Number(c.total)||0, estado:c.estado||'pendiente', fecha:fmtFecha(c.fecha), ts:new Date(c.fecha).getTime(),
    items:(c.carrito_items||[]).map(i=>({ tipo:i.id_producto?'producto':'archivo', idProducto:i.id_producto, nombre:i.nombre, cantidad:i.cantidad }))
  }));
  state.archivosNegocio = (arch.data||[]).map(a=>({
    id:a.id_archivo, cliente:(a.usuarios && a.usuarios.correo) || '—', nombre:a.nombre_archivo, material:a.material||'',
    color:a.color||'', peso:Number(a.peso)||0, tiempo:Number(a.tiempo)||0, precio:Number(a.precio)||0, estado:a.estado||'pendiente',
    tieneArchivo: !!a.s3_key
  }));
}

/* ===================== CLIENTE & COTIZADOR STL ===================== */
let clienteInit = false;

function refrescarCliente(){
  rellenarPerfil();
  populateSelects();
  renderArchivos();
  renderCatalogo();
  renderCarrito();
  renderPedidosCliente();
}

function initCliente(){
  refrescarCliente();
  if(clienteInit) return;
  clienteInit = true;
  const dz = document.getElementById('dropzone');
  const input = document.getElementById('stlInput');
  if(dz && input){
    dz.addEventListener('dragover', e=>{ e.preventDefault(); dz.classList.add('drag'); });
    dz.addEventListener('dragleave', ()=> dz.classList.remove('drag'));
    dz.addEventListener('drop', e=>{ e.preventDefault(); dz.classList.remove('drag'); if(e.dataTransfer.files[0]) handleSTL(e.dataTransfer.files[0]); });
    input.addEventListener('change', e=>{ if(e.target.files[0]) handleSTL(e.target.files[0]); });
  }
  // Al cambiar relleno, material, color o cantidad, se recalcula el peso y, si ya hay un precio
  // en pantalla, también se actualiza solo (sin volver a pulsar "Calcular precio").
  ['q-infill', 'q-material', 'q-color', 'q-cantidad'].forEach(id => {
    const el = document.getElementById(id);
    if(!el) return;
    const alCambiar = () => {
      actualizarPesoTiempo();
      if(state.lastQuote) calcularCotizacion();
    };
    el.addEventListener('change', alCambiar);
    if(id === 'q-cantidad') el.addEventListener('input', alCambiar);
  });
}

// ---------- PERFIL DEL CLIENTE ----------
let perfilSucio = false;        // true cuando hay cambios sin guardar en el formulario
let busquedaCatalogo = '';      // texto del buscador de la barra superior

// Datos extra (dirección de envío y notificaciones).
// Si la tabla 'usuarios' ya tiene las columnas, viven en Supabase; si no, se guardan en este navegador.
function leerExtraPerfil(){
  const p = state.perfil || {};
  const base = { direccion:'', ciudad_envio:'', codigo_postal:'', notif_correo:true };
  if('direccion' in p){
    return { direccion:p.direccion||'', ciudad_envio:p.ciudad_envio||'', codigo_postal:p.codigo_postal||'', notif_correo:p.notif_correo !== false };
  }
  try{
    const raw = localStorage.getItem('perfil_extra_' + p.id_user);
    if(raw) return Object.assign(base, JSON.parse(raw));
  }catch(e){}
  return base;
}

function rellenarPerfil(){
  const p = state.perfil;
  if(!p) return;
  const $ = id => document.getElementById(id);
  const setText = (id, v) => { const el = $(id); if(el) el.textContent = v; };

  const nombre = p.nombre || p.full_name || '';
  const correo = p.correo || p.email || '';
  const tel    = p.telefono || p.phone || '';
  const ciudad = p.ciudad || '';
  const x = leerExtraPerfil();

  // --- Tarjeta de identidad (siempre se actualiza) ---
  const visible = nombre || correo.split('@')[0] || 'Cliente';
  const inicial = (nombre || correo || '?').trim().charAt(0).toUpperCase();
  setText('pf-avatar', inicial);
  setText('pf-avatar-top', inicial);
  setText('pf-nombre-card', visible);
  setText('pf-nombre-top', visible);
  setText('pf-correo-card', correo);
  setText('pf-stat-archivos', state.archivos.length);
  setText('pf-stat-pedidos', state.pedidos.filter(o => o.estado === 'entregado').length);

  // --- Qué tan completo está el perfil ---
  const piezas = [['nombre', nombre], ['teléfono', tel], ['ciudad', ciudad], ['dirección de envío', x.direccion]];
  const faltan = piezas.filter(([, v]) => !String(v || '').trim()).map(([k]) => k);
  const pct = Math.round(((piezas.length - faltan.length) / piezas.length) * 100);
  setText('pf-pct', pct + '%');
  const bar = $('pf-pct-bar'); if(bar) bar.style.width = pct + '%';
  setText('pf-pct-hint', faltan.length ? 'Te falta: ' + faltan.join(', ') + '.' : 'Todo listo para tus envíos.');

  // --- Campos del formulario (no se pisan si hay cambios sin guardar) ---
  if(perfilSucio) return;
  const setVal = (id, val) => { const el = $(id); if(el && document.activeElement !== el) el.value = val || ''; };
  setVal('pf-nombre', nombre);
  setVal('pf-correo', correo);
  setVal('pf-tel', tel);
  setVal('pf-ciudad', ciudad);
  setVal('pf-dir', x.direccion);
  setVal('pf-ciudad-envio', x.ciudad_envio);
  setVal('pf-cp', x.codigo_postal);
  const sw = $('pf-notif'); if(sw) sw.checked = x.notif_correo;
}

function marcarPerfilSucio(){
  perfilSucio = true;
  const bar = document.getElementById('savebar');
  if(bar) bar.hidden = false;
}

function descartarPerfil(){
  perfilSucio = false;
  const bar = document.getElementById('savebar');
  if(bar) bar.hidden = true;
  rellenarPerfil();
}

// Guarda los cambios del usuario en Supabase
async function guardarPerfil(event) {
  if (event) event.preventDefault();
  const btn = document.getElementById('btnGuardarPerfil');
  try {
    if (typeof supabase === 'undefined' || !supabase) { toast("Error: No hay conexión con la base de datos"); return; }
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { toast("Debes iniciar sesión para guardar los cambios"); return; }
    if (!state.perfil) { toast("No se encontró tu perfil"); return; }

    const val = id => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
    const datos = {
      nombre:   val('pf-nombre') || state.perfil.nombre,
      telefono: val('pf-tel') || null,
      ciudad:   val('pf-ciudad') || null
    };
    const extra = {
      direccion:     val('pf-dir'),
      ciudad_envio:  val('pf-ciudad-envio'),
      codigo_postal: val('pf-cp'),
      notif_correo:  !!document.getElementById('pf-notif').checked
    };
    const columnasExtra = 'direccion' in state.perfil;
    if(columnasExtra){
      datos.direccion     = extra.direccion || null;
      datos.ciudad_envio  = extra.ciudad_envio || null;
      datos.codigo_postal = extra.codigo_postal || null;
      datos.notif_correo  = extra.notif_correo;
    }

    if(btn){ btn.disabled = true; btn.textContent = 'Guardando...'; }
    const { error } = await supabase.from('usuarios').update(datos).eq('id_user', state.perfil.id_user);

    if (error) {
      console.error("Error al guardar en Supabase:", error);
      toast("Error al guardar: " + error.message);
      return;
    }
    if(!columnasExtra){
      try{ localStorage.setItem('perfil_extra_' + state.perfil.id_user, JSON.stringify(extra)); }catch(e){}
    }
    Object.assign(state.perfil, datos);
    perfilSucio = false;
    document.getElementById('savebar').hidden = true;
    rellenarPerfil();
    toast("¡Perfil guardado correctamente!");
  } catch (err) {
    console.error("Excepción al guardar perfil:", err);
    toast("Ocurrió un error al guardar tu información");
  } finally {
    if(btn){ btn.disabled = false; btn.textContent = 'Guardar cambios'; }
  }
}

// Envía un correo para cambiar la contraseña
async function cambiarPassword(){
  const correo = state.perfil && state.perfil.correo;
  if(!correo){ toast('No encontramos tu correo'); return; }
  const { error } = await supabase.auth.resetPasswordForEmail(correo);
  toast(error ? 'No se pudo enviar el correo: ' + error.message : 'Te enviamos un correo para cambiar tu contraseña');
}

// Abre una sección del cliente desde un botón que no está en el menú
function irAVista(viewId){
  const btn = document.querySelector('#app-cliente .side-btn[data-view="' + viewId + '"]');
  showView('cliente', viewId, btn);
}

// Buscador de la barra superior: filtra el catálogo
function buscarGlobal(e){
  e.preventDefault();
  busquedaCatalogo = document.getElementById('buscador').value.trim().toLowerCase();
  irAVista('v-catalogo');
}
function limpiarBusqueda(){
  busquedaCatalogo = '';
  const i = document.getElementById('buscador'); if(i) i.value = '';
  renderCatalogo();
}

function populateSelects(){
  const matSelect = document.getElementById('q-material');
  const colorSelect = document.getElementById('q-color');
  const pill = document.getElementById('priceRulePill');
  const matPrev = matSelect ? matSelect.value : '';
  const colPrev = colorSelect ? colorSelect.value : '';

  if(matSelect){
    matSelect.innerHTML = state.materiales.length
      ? state.materiales.map(m=>`<option value="${esc(m.nombre)}">${esc(m.nombre)}</option>`).join('')
      : `<option value="">Sin materiales</option>`;
    if(matPrev) matSelect.value = matPrev;
  }
  if(colorSelect){
    colorSelect.innerHTML = state.colores.length
      ? state.colores.map(c=>`<option value="${esc(c.nombre)}">${esc(c.nombre)}</option>`).join('')
      : `<option value="">Sin colores</option>`;
    if(colPrev) colorSelect.value = colPrev;
  }
  if(pill) pill.textContent = (state.precios.porGramo > 0 && state.precios.porHora > 0)
    ? `Q${state.precios.porGramo.toFixed(2)}/g · Q${state.precios.porHora.toFixed(2)}/h`
    : 'Precios no definidos';
}

function signedVolumeOfTriangle(p1,p2,p3){
  return (p1[0]*(p2[1]*p3[2]-p3[1]*p2[2]) - p1[1]*(p2[0]*p3[2]-p3[0]*p2[2]) + p1[2]*(p2[0]*p3[1]-p3[0]*p2[1]))/6.0;
}

// Lee el STL (binario o texto) y mide: volumen, superficie y dimensiones
function parseSTL(buffer){
  const view = new DataView(buffer);
  let volume = 0, area = 0, tris = 0;
  let aLado = 0, aArriba = 0, aAbajo = 0;   // superficie lateral, tapas superiores y base
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];

  const acumular = (a, b, c) => {
    volume += signedVolumeOfTriangle(a, b, c);
    const ux=b[0]-a[0], uy=b[1]-a[1], uz=b[2]-a[2];
    const vx=c[0]-a[0], vy=c[1]-a[1], vz=c[2]-a[2];
    const cx=uy*vz-uz*vy, cy=uz*vx-ux*vz, cz=ux*vy-uy*vx;
    const dobleArea = Math.sqrt(cx*cx + cy*cy + cz*cz);
    const a2 = dobleArea / 2;                           // área del triángulo
    area += a2;
    if(dobleArea > 0){
      const nz = cz / dobleArea;                        // inclinación de la cara (1 = mira hacia arriba)
      aArriba += a2 * Math.max(nz, 0);
      aAbajo  += a2 * Math.max(-nz, 0);
      aLado   += a2 * (1 - Math.abs(nz));
    }
    for(const pt of [a, b, c]) for(let k=0; k<3; k++){
      if(pt[k] < min[k]) min[k] = pt[k];
      if(pt[k] > max[k]) max[k] = pt[k];
    }
    tris++;
  };

  let leido = false;
  if(buffer.byteLength > 84){
    const triCount = view.getUint32(80, true);
    if(84 + triCount*50 === buffer.byteLength){        // STL binario
      let offset = 84;
      for(let i=0; i<triCount; i++){
        offset += 12;                                   // saltar la normal
        const v = [];
        for(let k=0; k<3; k++){
          v.push([view.getFloat32(offset,true), view.getFloat32(offset+4,true), view.getFloat32(offset+8,true)]);
          offset += 12;
        }
        offset += 2;
        acumular(v[0], v[1], v[2]);
      }
      leido = true;
    }
  }
  if(!leido){                                           // STL en texto (ASCII)
    const text = new TextDecoder().decode(buffer);
    const rx = /vertex\s+([\-\d.eE+]+)\s+([\-\d.eE+]+)\s+([\-\d.eE+]+)/g;
    let m, verts = [];
    while((m = rx.exec(text))){
      verts.push([parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])]);
      if(verts.length === 3){ acumular(verts[0], verts[1], verts[2]); verts = []; }
    }
  }
  const dims = tris ? [max[0]-min[0], max[1]-min[1], max[2]-min[2]] : [0,0,0];
  if(volume < 0){ const t = aArriba; aArriba = aAbajo; aAbajo = t; }   // STL con caras al revés
  return { volumeMm3: Math.abs(volume), areaMm2: area, aLado, aArriba, aAbajo, tris, dims };
}

// ---------- Cotizador: el precio se calcula aquí con las tarifas que definió el negocio ----------
let archivoSeleccionado = null;   // el File elegido
let volumenMm3 = 0;               // volumen del modelo
let areaMm2 = 0;                  // superficie del modelo
let areaLadoMm2 = 0, areaArribaMm2 = 0, areaAbajoMm2 = 0;
let alturaMm = 0;                 // altura (eje Z) del modelo
let pesoBaseG = 0, tiempoBaseH = 0;  // peso y tiempo estimados de UNA pieza
let guardandoArchivo = false;     // evita guardar dos veces con doble clic

// Perfil estándar de Bambu Lab A1 (boquilla 0.4 mm, "0.20mm Standard @BBL A1").
// Si tus tiempos reales difieren, ajusta SOLO estos números.
const IMPRESION = {
  anchoLinea: 0.42,   // mm
  paredes: 2,         // perímetros
  capasSup: 5,        // capas sólidas arriba
  capasInf: 3,        // capas sólidas abajo
  altCapa: 0.2,       // mm por capa
  flujoMm3s: 8,       // mm³/s promedio REAL (incluye aceleraciones y desplazamientos)
  segPorCapa: 3       // segundos extra por cada cambio de capa
};
// Solo en el RELLENO: sus líneas se separan según el porcentaje y cada una tiene los bordes
// redondeados, así que llevan ~10% menos plástico que ancho × alto. Las paredes y las capas
// sólidas se pegan entre sí y llenan el 100% del espacio, por eso a ellas NO se les aplica.
IMPRESION.factorExtrusion = 1 - (IMPRESION.altCapa / IMPRESION.anchoLinea) * (1 - Math.PI / 4);
const DENSIDADES = { PLA: 1.24, PETG: 1.27, ABS: 1.04, TPU: 1.21 };   // g/cm³

function densidadDe(nombre){
  const n = String(nombre || '').toUpperCase();
  for(const k in DENSIDADES) if(n.includes(k)) return DENSIDADES[k];
  return state.densidad;
}

const redondear2 = n => Math.round((n + Number.EPSILON) * 100) / 100;

function asegurarContenedorResultado(){
  let c = document.getElementById('quoteResult');
  if(!c){
    const btn = document.querySelector('[onclick="calcularCotizacion()"]');
    const panel = btn ? (btn.closest('.panel') || btn.parentElement) : document.getElementById('v-cotizador');
    c = document.createElement('div');
    c.id = 'quoteResult';
    c.className = 'quote-result';
    if(panel) panel.appendChild(c);
  }
  c.style.display = 'block';
  c.classList.add('show', 'active', 'visible');
  return c;
}

function ocultarResultado(){
  const c = document.getElementById('quoteResult');
  if(c){ c.innerHTML = ''; c.style.display = 'none'; }
}

function handleSTL(file) {
  if(!file.name.toLowerCase().endsWith('.stl')){ toast('Solo se aceptan archivos .stl'); return; }
  archivoSeleccionado = file;
  state.lastQuote = null;
  volumenMm3 = 0; areaMm2 = 0; alturaMm = 0; pesoBaseG = 0; tiempoBaseH = 0;
  areaLadoMm2 = 0; areaArribaMm2 = 0; areaAbajoMm2 = 0;
  ocultarResultado();
  document.getElementById('fileNameLabel').textContent = 'Archivo: ' + file.name + ' · leyendo...';

  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const { volumeMm3, areaMm2: area, aLado, aArriba, aAbajo, tris, dims } = parseSTL(ev.target.result);
      if(!(volumeMm3 > 0)){
        toast('El modelo no tiene volumen cerrado. Revisa el STL en tu programa de diseño.');
        document.getElementById('fileNameLabel').textContent = 'Archivo: ' + file.name;
        return;
      }
      volumenMm3 = volumeMm3; areaMm2 = area; alturaMm = dims[2];
      areaLadoMm2 = aLado; areaArribaMm2 = aArriba; areaAbajoMm2 = aAbajo;
      actualizarPesoTiempo();

      const mayor = Math.max(...dims);
      if(mayor < 2)   toast('El modelo mide menos de 2 mm: revisa que el STL esté en milímetros.');
      else if(mayor > 400) toast('El modelo mide más de 40 cm: revisa las unidades del STL (deben ser mm).');
      else toast(`Modelo leído: ${tris} triángulos · ${dims.map(d=>d.toFixed(0)).join(' × ')} mm`);
    } catch(err) {
      console.error(err);
      toast('No se pudo leer el archivo .STL. Verifica que no esté dañado.');
      document.getElementById('fileNameLabel').textContent = 'Archivo: ' + file.name;
    }
  };
  reader.readAsArrayBuffer(file);
}

// Estima peso y tiempo de UNA pieza según el relleno y el material elegidos
function actualizarPesoTiempo(){
  if(!(volumenMm3 > 0)) return;
  const infill = 0.15
  const matSel = document.getElementById('q-material');
  const densidad = densidadDe(matSel ? matSel.value : '');

  // Cáscara sólida: paredes laterales + capas superiores + capas de la base
  const espLado = IMPRESION.paredes * IMPRESION.anchoLinea;
  const espArriba = IMPRESION.capasSup * IMPRESION.altCapa;
  const espAbajo = IMPRESION.capasInf * IMPRESION.altCapa;
  const cascaraTeorica = areaLadoMm2 * espLado + areaArribaMm2 * espArriba + areaAbajoMm2 * espAbajo;
  const delgada = cascaraTeorica >= volumenMm3;     // paredes tan finas que no queda interior: todo es sólido
  const cascara = Math.min(volumenMm3, cascaraTeorica);
  const interior = Math.max(0, volumenMm3 - cascara);                // lo que lleva relleno
  // Al 100% el relleno es sólido (sin huecos entre líneas), así que ahí no hay descuento
  const factorRelleno = infill >= 0.99 ? 1 : IMPRESION.factorExtrusion;
  const vImpreso = cascara + interior * infill * factorRelleno;                      // mm³ de plástico real

  pesoBaseG = (vImpreso / 1000) * densidad;
  const capas = alturaMm / IMPRESION.altCapa;
  tiempoBaseH = (vImpreso / IMPRESION.flujoMm3s + capas * IMPRESION.segPorCapa) / 3600;

  const ep = document.getElementById('q-peso');
  const et = document.getElementById('q-tiempo');
  if(ep) ep.value = pesoBaseG.toFixed(1);
  if(et) et.value = tiempoBaseH.toFixed(2);

  const lbl = document.getElementById('fileNameLabel');
  if(lbl && archivoSeleccionado){
    lbl.textContent = `Archivo: ${archivoSeleccionado.name} · ${pesoBaseG.toFixed(1)} g · ${tiempoBaseH.toFixed(2)} h`
      + (delgada ? ' · pieza de paredes delgadas (el relleno no cambia el peso)' : '');
  }
}

function calcularCotizacion() {
  if(!(state.precios.porGramo > 0) || !(state.precios.porHora > 0) || !state.materiales.length){
    toast('El negocio aún no ha configurado sus precios y materiales');
    return;
  }
  if(!archivoSeleccionado){ toast('Primero sube un archivo .STL'); return; }
  if(!(volumenMm3 > 0)){ toast('Espera a que se lea el archivo o prueba con otro .STL'); return; }

  const materialNombre = document.getElementById('q-material').value;
  const color = document.getElementById('q-color').value;
  const cant = Math.max(1, parseInt((document.getElementById('q-cantidad') || {}).value) || 1);
  const material = state.materiales.find(m => m.nombre === materialNombre);

  if(!material){ toast('Elige un material'); return; }
  if(!color){ toast('Elige un color'); return; }

  actualizarPesoTiempo();                    // recalcula con el material y relleno actuales
  const peso = pesoBaseG, tiempo = tiempoBaseH;
  if(!(peso > 0) || !(tiempo > 0)){ toast('No se pudo estimar el peso del archivo. Prueba con otro .STL.'); return; }

  // Precio por pieza redondeado a centavos; el total es exactamente la suma de lo que se muestra
  const matUnidad = redondear2(peso * state.precios.porGramo * material.mult);
  const tiempoUnidad = redondear2(tiempo * state.precios.porHora);
  const matTotal = redondear2(matUnidad * cant);
  const tiempoTotal = redondear2(tiempoUnidad * cant);
  const total = redondear2(matTotal + tiempoTotal);
  
  state.lastQuote = {
    archivo: archivoSeleccionado, nombre: archivoSeleccionado.name,
    material: materialNombre, color, peso: redondear2(peso * cant), tiempo: redondear2(tiempo * cant), cant, total
  };

  const c = asegurarContenedorResultado();
  c.innerHTML = `
    <div class="row-between">
      <div><div class="small-note">Precio estimado total</div><div class="total" id="quoteTotal">${Q(total)}</div></div>
      <button class="btn btn-sm btn-primary" onclick="guardarArchivo()">Guardar archivo</button>
    </div>
    <div class="quote-breakdown" id="quoteBreakdown">
      <span>Material (${esc(materialNombre)}): <b>${Q(matTotal)}</b></span>
      <span>Tiempo de impresión: <b>${Q(tiempoTotal)}</b></span>
      <span>Peso: <b>${(peso * cant).toFixed(1)} g</b></span>
      <span>Tiempo: <b>${(tiempo * cant).toFixed(2)} h</b></span>
      <span>Cantidad: <b>${cant}</b></span>
    </div>
    <p class="small-note" style="margin-top:10px;">Precio calculado con el volumen real del modelo. El negocio lo confirma al revisar tu archivo.</p>`;
  c.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// Sube el STL a S3 a través de Flask. Devuelve { clave, hash } o null si falla.
async function subirArchivoA_S3(file) {
  const { data: { session } } = await supabase.auth.getSession();
  if(!session){ toast('Tu sesión expiró. Inicia sesión otra vez.'); return null; }

  const formData = new FormData();
  formData.append('archivo', file);
  try {
    const res = await fetch('/api/archivos', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + session.access_token },
      body: formData
    });
    const data = await res.json().catch(() => ({}));
    if(!res.ok){
      console.error('Error al subir a S3:', data);
      toast('No se pudo subir el archivo: ' + (data.error || res.status));
      return null;
    }
    return { clave: data.clave, hash: data.hash };
  } catch(err) {
    console.error('Excepción de red al subir a S3:', err);
    toast('No se pudo conectar con el servidor.');
    return null;
  }
}

async function guardarArchivo(){
  if(guardandoArchivo) return;                       // ya hay un guardado en curso
  if(!state.lastQuote){ toast('Calcula un precio primero'); return; }
  if(!state.perfil){ toast('No se encontró tu perfil de cliente'); return; }

  guardandoArchivo = true;
  const btn = document.querySelector('[onclick="guardarArchivo()"]');
  if(btn) btn.disabled = true;

  try {
    const q = state.lastQuote;

    // 1) Subir a S3 (el servidor calcula la huella SHA-256 del contenido)
    toast('Subiendo archivo...');
    const sub = await subirArchivoA_S3(q.archivo);
    if(!sub) return;

    // 2) ¿Este cliente ya guardó exactamente este archivo?
    const dup = await supabase.from('archivos').select('id_archivo, nombre_archivo')
      .eq('id_usuario', state.perfil.id_user).eq('hash_archivo', sub.hash).maybeSingle();
    if(dup.data){
      toast(`Ese archivo ya lo guardaste antes (${dup.data.nombre_archivo}). Revisa "Mis archivos".`);
      return;
    }

    // 3) Guardar la cotización con la ruta del archivo en S3
    const res = await supabase.from('archivos').insert({
      nombre_archivo: q.nombre, material: q.material, color: q.color,
      peso: q.peso, tiempo: q.tiempo, precio: q.total,
      estado: 'pendiente', id_usuario: state.perfil.id_user,
      s3_key: sub.clave, hash_archivo: sub.hash
    });
    if(res.error){
      if(res.error.code === '23505'){ toast('Ese archivo ya estaba guardado.'); }
      else okDB(res, 'No se pudo guardar el archivo');
      return;
    }

    // 4) Limpiar para que no se pueda volver a guardar la misma cotización
    state.lastQuote = null;
    archivoSeleccionado = null;
    volumenMm3 = 0; areaMm2 = 0; alturaMm = 0; pesoBaseG = 0; tiempoBaseH = 0;
    areaLadoMm2 = 0; areaArribaMm2 = 0; areaAbajoMm2 = 0;
    limpiar('q-peso', 'q-tiempo');
    document.getElementById('fileNameLabel').textContent = '';
    document.getElementById('stlInput').value = '';
    ocultarResultado();

    await cargarCliente();
    renderArchivos();
    toast('Archivo guardado — pendiente de revisión');
  } finally {
    guardandoArchivo = false;
    if(btn) btn.disabled = false;
  }
}

function badgeEstadoArchivo(estado){
  const map = { pendiente:'Pendiente', aprobada:'Aprobada', rechazada:'Rechazada' };
  return `<span class="badge ${esc(estado)}">${map[estado]||esc(estado)}</span>`;
}

function archivoYaPedido(id){
  return state.pedidos.some(p => p.estado!=='cancelado' && p.items.some(i => i.id_archivo === id));
}

function renderArchivos(){
  const tb = document.querySelector('#tblArchivos tbody');
  if(!tb) return;
  if(!state.archivos.length){ tb.innerHTML = `<tr><td colspan="7" class="empty">Aún no has cotizado ningún archivo.</td></tr>`; return; }
  
  tb.innerHTML = state.archivos.map(a => {
    let accion = `<span class="small-note">—</span>`;
    
    // Configuramos el botón según el estado
    if(a.estado==='aprobada'){
      accion = archivoYaPedido(a.id)
        ? `<span class="small-note">Ya pedida</span>`
        : `<button class="btn btn-sm btn-primary" onclick="agregarArchivoAlCarrito(${a.id})">Agregar</button>`;
    } else if (a.estado === 'rechazada') {
      accion = `<button class="btn btn-sm" style="color:var(--danger); border-color:var(--danger);" onclick="eliminarArchivoCliente(${a.id})">Borrar</button>`;
    }

    // Mostramos el nombre, y si está rechazado, también el motivo
    let celdaNombre = `<td class="strong">${esc(a.nombre)}</td>`;
    if(a.estado === 'rechazada' && a.motivo) {
      celdaNombre = `<td><span class="strong">${esc(a.nombre)}</span><br><span class="small-note" style="color:var(--danger);">Motivo: ${esc(a.motivo)}</span></td>`;
    }

    return `<tr>${celdaNombre}<td>${esc(a.material)}</td><td>${a.peso.toFixed(1)} g</td><td>${a.tiempo.toFixed(1)} h</td>
      <td class="strong">${Q(a.precio)}</td><td>${badgeEstadoArchivo(a.estado)}</td><td>${accion}</td></tr>`;
  }).join('');
}

async function eliminarArchivoCliente(id) {
  if(!confirm('¿Estás seguro de que quieres borrar este archivo rechazado de tu historial?')) return;
  
  const res = await supabase.from('archivos').delete().eq('id_archivo', id);
  if(!okDB(res, 'No se pudo eliminar el archivo')) return;
  
  toast('Archivo eliminado correctamente');
  await cargarCliente(); // Recargamos datos de Supabase
  refrescarCliente();    // Refrescamos la vista
}

function agregarArchivoAlCarrito(id){
  const a = state.archivos.find(x=>x.id===id);
  if(!a) return;
  if(state.carrito.some(l=>l.tipo==='archivo' && l.ref===id)){ toast('Esa pieza ya está en el carrito'); return; }
  state.carrito.push({ tipo:'archivo', ref:a.id, nombre:a.nombre + ' (' + a.material + ')', precio:a.precio, cantidad:1 });
  renderCarrito();
  toast('Agregado al carrito');
}

function renderCatalogo(){
  const grid = document.getElementById('catalogoGrid');
  if(!grid) return;
  if(!state.productos.length){
    grid.innerHTML = `<div class="empty">El negocio aún no ha publicado productos.</div>`;
    return;
  }
  const q = busquedaCatalogo;
  const lista = q ? state.productos.filter(p => ((p.nombre||'') + ' ' + (p.desc||'')).toLowerCase().includes(q)) : state.productos;
  const aviso = q ? `<div class="small-note" style="grid-column:1/-1;margin:0 0 4px;">${lista.length} resultado(s) para «${esc(q)}» · <a href="#" onclick="limpiarBusqueda();return false;" style="color:var(--green);">Ver todo</a></div>` : '';
  if(q && !lista.length){ grid.innerHTML = aviso + `<div class="empty" style="grid-column:1/-1;">No encontramos productos con ese nombre.</div>`; return; }
  grid.innerHTML = aviso + lista.map(p => `
    <div class="prod-card"><h4>${esc(p.nombre)}</h4><p>${esc(p.desc)}</p><div class="price">${Q(p.precio)}</div>
    <p class="small-note">${p.existencias > 0 ? p.existencias + ' disponibles' : ''}</p>
    ${p.existencias > 0
      ? `<button class="btn btn-sm btn-primary" onclick="agregarProductoAlCarrito(${p.id})">Agregar al carrito</button>`
      : `<span class="small-note">Agotado</span>`}</div>
  `).join('');
}

function agregarProductoAlCarrito(id){
  const p = state.productos.find(x=>x.id===id);
  if(!p) return;
  const existente = state.carrito.find(l=>l.tipo==='producto' && l.ref===id);
  const enCarrito = existente ? existente.cantidad : 0;
  if(enCarrito + 1 > p.existencias){ toast('No hay más existencias de este producto'); return; }
  if(existente){ existente.cantidad++; } else { state.carrito.push({ tipo:'producto', ref:id, nombre:p.nombre, precio:p.precio, cantidad:1 }); }
  renderCarrito();
  toast('Agregado al carrito');
}

function renderCarrito(){
  const wrap = document.getElementById('cartLines');
  const cartCount = document.getElementById('cartCount');
  const cartTotal = document.getElementById('cartTotal');
  if(cartCount) cartCount.textContent = state.carrito.reduce((a,l)=>a+l.cantidad,0);
  if(!wrap) return;
  if(!state.carrito.length){
    wrap.innerHTML = `<div class="empty">Tu carrito está vacío.</div>`;
    if(cartTotal) cartTotal.textContent = Q(0);
    return;
  }
  wrap.innerHTML = state.carrito.map((l,i) => `
    <div class="cart-line"><div class="info"><h4>${esc(l.nombre)}</h4><span>${l.tipo==='archivo' ? 'Pieza cotizada' : 'Producto de catálogo'} · cantidad ${l.cantidad}</span></div>
    <div style="display:flex; align-items:center; gap:14px;"><span class="price">${Q(l.precio*l.cantidad)}</span><button class="btn btn-sm" onclick="quitarDelCarrito(${i})">Quitar</button></div></div>
  `).join('');
  if(cartTotal) cartTotal.textContent = Q(state.carrito.reduce((a,l)=>a+l.precio*l.cantidad,0));
}

function quitarDelCarrito(i){ state.carrito.splice(i,1); renderCarrito(); }

async function confirmarPedido(){
  if(!state.carrito.length){ toast('Tu carrito está vacío'); return; }
  if(!state.perfil){ toast('No se encontró tu perfil de cliente'); return; }

  await cargarBase();
  for(const l of state.carrito){
    if(l.tipo === 'producto'){
      const p = state.productos.find(x=>x.id===l.ref);
      if(!p || p.existencias < l.cantidad){ toast(`"${l.nombre}" ya no tiene suficientes existencias`); renderCatalogo(); return; }
    }
  }

  const idUser = state.perfil.id_user || state.perfil.id;
  const total = state.carrito.reduce((a,l)=>a+l.precio*l.cantidad,0);
  const cab = await supabase.from('carritos')
    .insert({ total, estado:'pendiente', id_usuario: idUser })
    .select().single();
  if(!okDB(cab, 'No se pudo crear el pedido')) return;

  const items = state.carrito.map(l => ({
    id_carrito: cab.data.id_carrito,
    id_archivo: l.tipo==='archivo' ? l.ref : null,
    id_producto: l.tipo==='producto' ? l.ref : null,
    nombre: l.nombre, precio: l.precio, cantidad: l.cantidad
  }));
  const det = await supabase.from('carrito_items').insert(items);
  if(!okDB(det, 'No se pudieron guardar los productos del pedido')) return;

  state.carrito = [];
  await cargarCliente();
  refrescarCliente();
  toast('Pedido confirmado y enviado al negocio');
}

function badgeEstadoPedido(estado){
  const map = { pendiente:'Pendiente', progreso:'En progreso', entregado:'Entregado', cancelado:'Cancelado' };
  return `<span class="badge ${esc(estado)}">${map[estado]||esc(estado)}</span>`;
}

function renderPedidosCliente(){
  const tb = document.querySelector('#tblPedidos tbody');
  if(!tb) return;
  if(!state.pedidos.length){ tb.innerHTML = `<tr><td colspan="5" class="empty">Aún no tienes pedidos confirmados.</td></tr>`; return; }
  tb.innerHTML = state.pedidos.map(p => `<tr><td class="strong">${p.label}</td><td>${esc(p.detalle)}</td><td class="strong">${Q(p.total)}</td><td>${badgeEstadoPedido(p.estado)}</td><td>${p.fecha}</td></tr>`).join('');
}

/* ===================== NEGOCIO: PANEL DE ADMINISTRACIÓN ===================== */
const val = id => (document.getElementById(id)?.value ?? '').trim();
const limpiar = (...ids) => ids.forEach(id => { const el = document.getElementById(id); if(el) el.value = ''; });

// ---------- Productos ----------
async function formAgregarProducto(){
  const nombre = val('np-nombre'), desc = val('np-desc');
  const precio = parseFloat(val('np-precio')), exist = parseInt(val('np-exist'));
  if(!nombre || isNaN(precio) || precio < 0 || isNaN(exist) || exist < 0){ toast('Completa nombre, precio y existencias'); return; }
  const res = await supabase.from('productos').insert({ nombre, descripcion: desc || null, precio, existencia: exist });
  if(!okDB(res, 'No se pudo agregar el producto')) return;
  limpiar('np-nombre','np-desc','np-precio','np-exist');
  await cargarBase(); renderProductosNegocio();
  toast('Producto publicado en el catálogo');
}

async function cambiarExistencia(id, valor){
  const e = parseInt(valor);
  if(isNaN(e) || e < 0){ toast('Existencias inválidas'); renderProductosNegocio(); return; }
  const res = await supabase.from('productos').update({ existencia: e }).eq('id_producto', id);
  if(!okDB(res, 'No se pudo actualizar')) return;
  await cargarBase(); renderProductosNegocio();
  toast('Existencias actualizadas');
}

async function cambiarPrecioProducto(id, valor){
  const p = parseFloat(valor);
  if(isNaN(p) || p < 0){ toast('Precio inválido'); renderProductosNegocio(); return; }
  const res = await supabase.from('productos').update({ precio: p }).eq('id_producto', id);
  if(!okDB(res, 'No se pudo actualizar')) return;
  await cargarBase(); renderProductosNegocio();
  toast('Precio actualizado');
}

async function quitarProducto(id){
  if(!confirm('¿Quitar este producto del catálogo?')) return;
  const res = await supabase.from('productos').delete().eq('id_producto', id);
  if(res.error){
    toast('No se puede borrar: ya aparece en pedidos. Ponle existencias en 0 para ocultarlo.');
    return;
  }
  await cargarBase(); renderProductosNegocio();
  toast('Producto eliminado');
}

function renderProductosNegocio(){
  const tb = document.querySelector('#tblProductosNegocio tbody');
  if(!tb) return;
  if(!state.productos.length){ tb.innerHTML = `<tr><td colspan="5" class="empty">Aún no has agregado productos.</td></tr>`; return; }
  tb.innerHTML = state.productos.map(p => `
    <tr><td class="strong">${esc(p.nombre)}</td><td>${esc(p.desc)}</td>
    <td><input type="number" min="0" step="0.01" value="${p.precio}" style="width:90px" onchange="cambiarPrecioProducto(${p.id}, this.value)"></td>
    <td><input type="number" min="0" step="1" value="${p.existencias}" style="width:80px" onchange="cambiarExistencia(${p.id}, this.value)"></td>
    <td><button class="btn btn-sm" onclick="quitarProducto(${p.id})">Quitar</button></td></tr>
  `).join('');
}

// ---------- Precios, materiales y colores ----------
async function formGuardarPrecios(){
  const g = parseFloat(val('np-gramo')), h = parseFloat(val('np-hora'));
  if(!(g > 0) || !(h > 0)){ toast('Ingresa precios válidos (mayores a 0)'); return; }
  const res = await supabase.from('configuracion').update({ precio_gramo: g, precio_hora: h }).eq('id', 1);
  if(!okDB(res, 'No se pudieron guardar los precios')) return;
  state.precios = { porGramo: g, porHora: h };
  toast('Precios guardados');
}

async function formAgregarMaterial(){
  const nombre = val('nm-nombre'), mult = parseFloat(val('nm-mult'));
  if(!nombre || !(mult > 0)){ toast('Escribe el nombre y un multiplicador mayor a 0'); return; }
  const res = await supabase.from('materiales').insert({ nombre, mult });
  if(!okDB(res, 'No se pudo agregar el material')) return;
  limpiar('nm-nombre','nm-mult');
  await cargarBase(); renderMaterialesColores();
  toast('Material agregado');
}

async function quitarMaterial(id){
  const res = await supabase.from('materiales').delete().eq('id', id);
  if(!okDB(res, 'No se pudo quitar')) return;
  await cargarBase(); renderMaterialesColores();
}

async function formAgregarColor(){
  const nombre = val('nc-nombre');
  if(!nombre){ toast('Escribe un color'); return; }
  const res = await supabase.from('colores').insert({ nombre });
  if(!okDB(res, 'No se pudo agregar el color')) return;
  limpiar('nc-nombre');
  await cargarBase(); renderMaterialesColores();
  toast('Color agregado');
}

async function quitarColor(id){
  const res = await supabase.from('colores').delete().eq('id', id);
  if(!okDB(res, 'No se pudo quitar')) return;
  await cargarBase(); renderMaterialesColores();
}

function renderMaterialesColores(){
  const lm = document.getElementById('listaMateriales');
  const lc = document.getElementById('listaColores');
  if(lm) lm.innerHTML = state.materiales.length
    ? state.materiales.map(m=>`<div class="cart-line"><div class="info"><h4>${esc(m.nombre)}</h4><span>multiplicador ×${m.mult}</span></div><button class="btn btn-sm" onclick="quitarMaterial(${m.id})">Quitar</button></div>`).join('')
    : `<div class="empty">Aún no has agregado materiales.</div>`;
  if(lc) lc.innerHTML = state.colores.length
    ? state.colores.map(c=>`<div class="cart-line"><div class="info"><h4>${esc(c.nombre)}</h4></div><button class="btn btn-sm" onclick="quitarColor(${c.id})">Quitar</button></div>`).join('')
    : `<div class="empty">Aún no has agregado colores.</div>`;
}

function rellenarPreciosNegocio(){
  const g = document.getElementById('np-gramo'), h = document.getElementById('np-hora');
  if(g && document.activeElement !== g) g.value = state.precios.porGramo || '';
  if(h && document.activeElement !== h) h.value = state.precios.porHora || '';
}

// ---------- Filamentos ----------
async function formAgregarFilamento(){
  const tipo = val('nf-tipo'), rest = parseInt(val('nf-restante')), costo = parseFloat(val('nf-costo'));
  if(!tipo || isNaN(rest) || rest < 0 || rest > 100){ toast('Escribe el tipo/color y un % entre 0 y 100'); return; }
  const res = await supabase.from('filamentos').insert({ tipo, cantidad: rest, precio_costo: isNaN(costo) ? null : costo });
  if(!okDB(res, 'No se pudo registrar el filamento')) return;
  limpiar('nf-tipo','nf-restante','nf-costo');
  await cargarNegocio(); renderFilamentosNegocio(); drawFilamentos();
  toast('Filamento registrado');
}

async function cambiarRestante(id, valor){
  const r = parseInt(valor);
  if(isNaN(r) || r < 0 || r > 100){ toast('Debe ser un % entre 0 y 100'); renderFilamentosNegocio(); return; }
  const res = await supabase.from('filamentos').update({ cantidad: r }).eq('id_filamento', id);
  if(!okDB(res, 'No se pudo actualizar')) return;
  await cargarNegocio(); renderFilamentosNegocio(); drawFilamentos();
}

async function quitarFilamento(id){
  const res = await supabase.from('filamentos').delete().eq('id_filamento', id);
  if(!okDB(res, 'No se pudo quitar')) return;
  await cargarNegocio(); renderFilamentosNegocio(); drawFilamentos();
}

function renderFilamentosNegocio(){
  const tb = document.querySelector('#tblFilamentos tbody');
  if(!tb) return;
  if(!state.filamentos.length){ tb.innerHTML = `<tr><td colspan="4" class="empty">Aún no has registrado filamentos.</td></tr>`; return; }
  tb.innerHTML = state.filamentos.map(f => `
    <tr><td class="strong">${esc(f.nombre)}</td>
    <td><input type="number" min="0" max="100" value="${f.restante}" style="width:80px" onchange="cambiarRestante(${f.id}, this.value)"> %</td>
    <td>${f.costo ? Q(f.costo) : '—'}</td>
    <td><button class="btn btn-sm" onclick="quitarFilamento(${f.id})">Quitar</button></td></tr>
  `).join('');
}

// ---------- Cámaras ----------
async function formAgregarCamara(){
  const nombre = val('ncam-nombre');
  if(!nombre){ toast('Escribe el nombre de la cámara'); return; }
  const res = await supabase.from('camaras').insert({ nombre, estado: 'inactiva' });
  if(!okDB(res, 'No se pudo registrar la cámara')) return;
  limpiar('ncam-nombre');
  await cargarNegocio(); renderCamaras(); renderKPIs();
  toast('Cámara registrada');
}

async function alternarCamara(id){
  const c = state.camaras.find(x=>x.id===id);
  if(!c) return;
  const nuevo = c.estado === 'activa' ? 'inactiva' : 'activa';
  const res = await supabase.from('camaras').update({ estado: nuevo, archivo: nuevo==='activa' ? c.archivo : null }).eq('id_camara', id);
  if(!okDB(res, 'No se pudo actualizar')) return;
  await cargarNegocio(); renderCamaras(); renderKPIs();
}

async function asignarArchivoCamara(id){
  const nombre = prompt('¿Qué pieza está imprimiendo/vigilando esta cámara?');
  if(nombre === null) return;
  const res = await supabase.from('camaras').update({ archivo: nombre.trim() || null, estado: nombre.trim() ? 'activa' : 'inactiva' }).eq('id_camara', id);
  if(!okDB(res, 'No se pudo actualizar')) return;
  await cargarNegocio(); renderCamaras(); renderKPIs();
}

async function quitarCamara(id){
  if(!confirm('¿Quitar esta cámara?')) return;
  const res = await supabase.from('camaras').delete().eq('id_camara', id);
  if(res.error){ toast('No se puede quitar: tiene archivos asignados'); return; }
  await cargarNegocio(); renderCamaras(); renderKPIs();
}

// ---------- Revisar archivos de clientes ----------
async function revisarArchivo(id, estado){
  let datosActualizar = { estado: estado };
  
  if (estado === 'rechazada') {
    const motivo = prompt('Escribe el motivo del rechazo para el cliente:');
    if (motivo === null) return; // Si el admin cancela, no hacemos nada
    datosActualizar.motivo_rechazo = motivo.trim() || 'No cumple con los requisitos de impresión.';
  } else {
    datosActualizar.motivo_rechazo = null; // Limpiar si se aprueba
  }

  const res = await supabase.from('archivos').update(datosActualizar).eq('id_archivo', id);
  if(!okDB(res, 'No se pudo actualizar')) return;
  
  await cargarNegocio(); 
  renderArchivosNegocio();
  toast(estado === 'aprobada' ? 'Archivo aprobado' : 'Archivo rechazado');
}

function renderArchivosNegocio(){
  const tb = document.querySelector('#tblArchivosNegocio tbody');
  if(!tb) return;
  if(!state.archivosNegocio.length){ tb.innerHTML = `<tr><td colspan="7" class="empty">Aún no hay archivos de clientes.</td></tr>`; return; }
  tb.innerHTML = state.archivosNegocio.map(a => `
    <tr><td>${esc(a.cliente)}</td><td class="strong">${esc(a.nombre)}</td><td>${esc(a.material)} · ${esc(a.color)}</td>
    <td>${a.peso.toFixed(1)} g · ${a.tiempo.toFixed(1)} h</td><td class="strong">${Q(a.precio)}</td><td>${badgeEstadoArchivo(a.estado)}</td>
    <td>${a.estado==='pendiente'
      ? `<button class="btn btn-sm btn-primary" onclick="revisarArchivo(${a.id}, 'aprobada')">Aprobar</button> <button class="btn btn-sm" onclick="revisarArchivo(${a.id}, 'rechazada')">Rechazar</button>`
      : `<span class="small-note">—</span>`}
      ${a.tieneArchivo ? `<button class="btn btn-sm" onclick="descargarSTL(${a.id})">Descargar STL</button>` : ''}</td></tr>
  `).join('');
}

// El servidor firma una URL temporal de S3; solo la entrega si RLS deja ver ese archivo
async function descargarSTL(id){
  const { data: { session } } = await supabase.auth.getSession();
  if(!session){ toast('Tu sesión expiró'); return; }
  try {
    const res = await fetch(`/api/archivos/${id}/url`, { headers: { 'Authorization': 'Bearer ' + session.access_token } });
    const data = await res.json().catch(() => ({}));
    if(!res.ok){ toast('No se pudo descargar: ' + (data.error || res.status)); return; }
    window.open(data.url, '_blank');
  } catch(err) { console.error(err); toast('No se pudo conectar con el servidor'); }
}

// ---------- Pedidos ----------
async function cambiarEstadoCarrito(id, estado){
  const c = state.carritosNegocio.find(x=>x.id===id);
  if(!c || c.estado === estado) return;
  const anterior = c.estado;

  let delta = 0;
  if(anterior === 'pendiente' && estado === 'progreso') delta = -1;
  if(anterior === 'progreso' && estado === 'cancelado') delta = +1;

  if(delta === -1){
    await cargarBase();
    for(const it of c.items.filter(i=>i.idProducto)){
      const p = state.productos.find(x=>x.id===it.idProducto);
      if(p && p.existencias < it.cantidad){
        toast(`No hay existencias suficientes de "${p.nombre}"`);
        renderPedidosNegocioTable();
        return;
      }
    }
  }

  const res = await supabase.from('carritos').update({ estado }).eq('id_carrito', id);
  if(!okDB(res, 'No se pudo cambiar el estado')){ renderPedidosNegocioTable(); return; }

  if(delta !== 0){
    for(const it of c.items.filter(i=>i.idProducto)){
      const p = state.productos.find(x=>x.id===it.idProducto);
      if(p) await supabase.from('productos').update({ existencia: Math.max(0, p.existencias + delta*it.cantidad) }).eq('id_producto', p.id);
    }
  }

  await cargarBase(); await cargarNegocio();
  refrescarNegocio();
  toast('Estado actualizado');
}

/* ===================== NEGOCIO: MÉTRICAS ===================== */
const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

function calcularVentasMensuales(){
  const ahora = new Date();
  const meses = [];
  for(let i=5;i>=0;i--){
    const d = new Date(ahora.getFullYear(), ahora.getMonth()-i, 1);
    meses.push({ y:d.getFullYear(), m:d.getMonth(), mes:MESES[d.getMonth()], valor:0 });
  }
  state.carritosNegocio.filter(c=>c.estado==='entregado').forEach(c=>{
    const d = new Date(c.ts);
    const slot = meses.find(x=>x.y===d.getFullYear() && x.m===d.getMonth());
    if(slot) slot.valor += c.total;
  });
  return meses;
}

let negocioInit = false;
function initNegocio(){
  negocioInit = true;
  refrescarNegocio();
}

function refrescarNegocio(){
  renderKPIs(); drawLine(); drawDonut(); drawTopProductos(); drawFilamentos(); renderCamaras();
  renderPedidosNegocioTable(); renderProductosNegocio(); renderMaterialesColores(); rellenarPreciosNegocio();
  renderFilamentosNegocio(); renderArchivosNegocio();
}

function renderKPIs(){
  const kpiRow = document.getElementById('kpiRow');
  if(!kpiRow) return;
  const vm = calcularVentasMensuales();
  const ventasMes = vm[vm.length-1].valor;
  const ventasAnt = vm[vm.length-2].valor;
  const deltaTxt = ventasAnt > 0
    ? (((ventasMes-ventasAnt)/ventasAnt*100).toFixed(1)) + '% vs mes anterior'
    : 'sin datos del mes anterior';
  const pedidosActivos = state.carritosNegocio.filter(c=>c.estado==='pendiente'||c.estado==='progreso').length;
  const piezasImprimiendo = state.camaras.filter(c=>c.estado==='activa' && c.archivo).length;
  const camarasActivas = state.camaras.filter(c=>c.estado==='activa').length;
  const kpis = [
    { label:'Ventas del mes', value:Q(ventasMes), delta:deltaTxt, icon:'◆' },
    { label:'Carritos activos', value:pedidosActivos, delta:'pendientes + en progreso', icon:'▤' },
    { label:'Piezas imprimiendo', value:piezasImprimiendo, delta:'monitoreadas por cámara', icon:'▶' },
    { label:'Cámaras en línea', value:camarasActivas+' / '+state.camaras.length, delta:'de las registradas', icon:'●' },
  ];
  kpiRow.innerHTML = kpis.map(k=>`
    <div class="kpi"><div class="top"><span class="label">${k.label}</span><span class="icon">${k.icon}</span></div>
    <span class="value">${k.value}</span><span class="delta up">${k.delta}</span></div>
  `).join('');
}

function drawLine(){
  const svg = document.getElementById('lineChart');
  if(!svg) return;
  const data = calcularVentasMensuales();
  if(!data.some(v=>v.valor>0)){
    svg.innerHTML = `<text x="280" y="105" text-anchor="middle" class="axis-label">Aún no hay ventas registradas</text>`;
    return;
  }
  const W=560, H=200, padL=40, padR=10, padT=10, padB=26;
  const max = Math.max(...data.map(v=>v.valor)) * 1.15;
  const stepX = (W-padL-padR)/(data.length-1);
  const yFor = v => padT + (1 - v/max)*(H-padT-padB);
  const xFor = i => padL + i*stepX;
  let html = '';
  for(let i=0;i<=3;i++){
    const v = max/3*i, y = yFor(v);
    html += `<line x1="${padL}" y1="${y}" x2="${W-padR}" y2="${y}" class="grid-line"/>`;
    html += `<text x="4" y="${y+4}" class="axis-label">Q${Math.round(v)}</text>`;
  }
  data.forEach((v,i)=>{ html += `<text x="${xFor(i)}" y="${H-6}" class="axis-label" text-anchor="middle">${v.mes}</text>`; });
  const linePts = data.map((v,i)=>`${xFor(i)},${yFor(v.valor)}`).join(' ');
  const areaPts = `${padL},${yFor(0)} ${linePts} ${xFor(data.length-1)},${yFor(0)}`;
  html += `<defs><linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#2fae6b" stop-opacity="0.35"/><stop offset="100%" stop-color="#2fae6b" stop-opacity="0"/></linearGradient></defs>
    <polygon points="${areaPts}" fill="url(#areaGrad)"/>
    <polyline points="${linePts}" fill="none" stroke="#2fae6b" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;
  data.forEach((v,i)=>{ html += `<circle cx="${xFor(i)}" cy="${yFor(v.valor)}" r="4" fill="#0a0c0a" stroke="#2fae6b" stroke-width="2.5"/>`; });
  svg.innerHTML = html;
}

function drawDonut(){
  const svg = document.getElementById('donutChart');
  if(!svg) return;
  const counts = {pendiente:0, progreso:0, entregado:0, cancelado:0};
  state.carritosNegocio.forEach(c=>{ if(counts[c.estado]!==undefined) counts[c.estado]++; });
  const segs = [
    {estado:'Pendiente', valor:counts.pendiente, color:'#e0b04a'},
    {estado:'En progreso', valor:counts.progreso, color:'#2fae6b'},
    {estado:'Entregado', valor:counts.entregado, color:'#cfe8d6'},
    {estado:'Cancelado', valor:counts.cancelado, color:'#d9584f'},
  ];
  const total = segs.reduce((a,s)=>a+s.valor,0);
  const cx=90, cy=90, r=64, strokeW=22;
  const circumference = 2*Math.PI*r;
  let offsetAcc = 0;
  let html = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#181a17" stroke-width="${strokeW}"/>`;
  if(total > 0){
    segs.forEach(seg=>{
      const len = (seg.valor/total)*circumference;
      html += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${seg.color}" stroke-width="${strokeW}" stroke-dasharray="${len} ${circumference-len}" stroke-dashoffset="${-offsetAcc}" transform="rotate(-90 ${cx} ${cy})" stroke-linecap="butt"/>`;
      offsetAcc += len;
    });
  }
  html += `<text x="${cx}" y="${cy-4}" text-anchor="middle" font-family="JetBrains Mono" font-size="20" font-weight="700" fill="#f3f5f1">${total}</text>`;
  html += `<text x="${cx}" y="${cy+14}" text-anchor="middle" font-family="JetBrains Mono" font-size="10" fill="#93a091">carritos</text>`;
  svg.innerHTML = html;
  const legend = document.getElementById('donutLegend');
  if(legend) legend.innerHTML = segs.map(s=>`
    <div class="legend-item"><span class="left"><span class="legend-dot" style="background:${s.color}"></span>${s.estado}</span><span class="val">${s.valor}</span></div>
  `).join('');
}

function drawTopProductos(){
  const el = document.getElementById('topProductos');
  if(!el) return;
  const conteo = {};
  state.carritosNegocio.filter(c=>c.estado!=='cancelado').forEach(c=>{
    c.items.filter(i=>i.tipo==='producto').forEach(i=>{ conteo[i.nombre] = (conteo[i.nombre]||0) + i.cantidad; });
  });
  const top = Object.entries(conteo).map(([nombre,ventas])=>({nombre,ventas})).sort((a,b)=>b.ventas-a.ventas).slice(0,5);
  if(!top.length){ el.innerHTML = `<div class="empty">Aún no hay productos vendidos.</div>`; return; }
  const max = top[0].ventas;
  el.innerHTML = top.map(p=>`
    <div class="bar-row"><div class="top-row"><span class="name">${esc(p.nombre)}</span><span class="num">${p.ventas}</span></div>
    <div class="bar-track"><div class="bar-fill" style="width:${(p.ventas/max*100).toFixed(0)}%"></div></div></div>
  `).join('');
}

function drawFilamentos(){
  const el = document.getElementById('filamentoList');
  if(!el) return;
  if(!state.filamentos.length){ el.innerHTML = `<div class="empty">Aún no has registrado filamentos.</div>`; return; }
  el.innerHTML = state.filamentos.map(f=>`
    <div class="bar-row"><div class="top-row"><span class="name">${esc(f.nombre)}</span><span class="num">${f.restante}%</span></div>
    <div class="bar-track"><div class="bar-fill ${f.restante<30?'warn':''}" style="width:${f.restante}%"></div></div></div>
  `).join('');
}

function renderCamaras(){
  const sub = document.getElementById('camSub');
  const grid = document.getElementById('camsGrid');
  if(sub) sub.textContent = state.camaras.filter(c=>c.estado==='activa').length + ' de ' + state.camaras.length + ' activas';
  if(!grid) return;
  if(!state.camaras.length){ grid.innerHTML = `<div class="empty">Aún no has registrado cámaras.</div>`; return; }
  grid.innerHTML = state.camaras.map(c=>`
    <div class="cam-card"><div class="row-top"><span class="name">${esc(c.nombre)}</span>${c.estado==='activa' ? '<span class="rec-dot"></span>' : ''}</div>
    <span class="badge ${esc(c.estado)}">${c.estado==='activa'?'Activa':'Inactiva'}</span>
    <div class="file">${c.archivo ? 'Vigilando: ' + esc(c.archivo) : 'Sin trabajo asignado'}</div>
    <div style="display:flex; gap:6px; margin-top:10px; flex-wrap:wrap;">
      <button class="btn btn-sm" onclick="alternarCamara(${c.id})">${c.estado==='activa' ? 'Desactivar' : 'Activar'}</button>
      <button class="btn btn-sm" onclick="asignarArchivoCamara(${c.id})">Asignar pieza</button>
      <button class="btn btn-sm" onclick="quitarCamara(${c.id})">Quitar</button>
    </div></div>
  `).join('');
}

function renderPedidosNegocioTable(){
  const tb = document.querySelector('#tblCarritosNegocio tbody');
  if(!tb) return;
  if(!state.carritosNegocio.length){ tb.innerHTML = `<tr><td colspan="6" class="empty">Aún no hay carritos de clientes.</td></tr>`; return; }
  const opciones = ['pendiente','progreso','entregado','cancelado'];
  const etiquetas = { pendiente:'Pendiente', progreso:'En progreso', entregado:'Entregado', cancelado:'Cancelado' };
  tb.innerHTML = state.carritosNegocio.map(c=>`
    <tr><td class="strong">${c.label}</td><td>${esc(c.cliente)}</td>
    <td>${esc(c.items.map(i=>`${i.nombre} ×${i.cantidad}`).join(', '))}</td>
    <td class="strong">${Q(c.total)}</td>
    <td><select onchange="cambiarEstadoCarrito(${c.id}, this.value)">
      ${opciones.map(o=>`<option value="${o}" ${o===c.estado?'selected':''}>${etiquetas[o]}</option>`).join('')}
    </select></td><td>${c.fecha}</td></tr>
  `).join('');
}
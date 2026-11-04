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
  t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#161616;border:2px solid #161616;color:#F6F6F4;padding:12px 20px;border-radius:10px;font-size:14px;font-weight:600;font-family:Outfit,system-ui,sans-serif;max-width:calc(100vw - 32px);text-align:center;z-index:999;box-shadow:4px 4px 0 #FFC21A';
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
    mostrarVistaInicial();
    await cargarCliente();
    initCliente();
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showView(app, viewId, btn) {
  const contenedor = document.getElementById(app === 'negocio' ? 'app-negocio' : 'app-cliente');
  if (!contenedor) return;
  cerrarMenu();                                   // en celular el panel se cierra al elegir una sección
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

// ---------- Contacto: el mensaje se envía a una función AWS Lambda ----------
const CONTACTO_URL = 'https://ooc3kvsndc2ccx3agvgjk44dca0dfvbi.lambda-url.us-east-2.on.aws/';
let enviandoMensaje = false;

async function enviarMensaje() {
  if (enviandoMensaje) return;
  const asunto = document.getElementById('msg-asunto');
  const cuerpo = document.getElementById('msg-cuerpo');
  const inputNombre = document.getElementById('msg-nombre');
  const inputTel = document.getElementById('msg-telefono');

  const a = asunto ? asunto.value.trim() : '';
  const m = cuerpo ? cuerpo.value.trim() : '';

  if (a.length < 3 || m.length < 10) { toast('Escribe un asunto (mínimo 3 letras) y un mensaje (mínimo 10 letras)'); return; }
  if (a.length > 100 || m.length > 1000) { toast('El asunto admite hasta 100 caracteres y el mensaje hasta 1000'); return; }
  if (!CONTACTO_URL) { toast('El formulario de contacto todavía no está conectado'); return; }

  const btn = document.getElementById('btnEnviarMsg');
  enviandoMensaje = true;
  if (btn) { btn.disabled = true; btn.textContent = 'Enviando...'; }
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { toast('Inicia sesión de nuevo para enviar tu mensaje'); return; }

    // MEJORA: Lee de los inputs del formulario si existen, con respaldo en el perfil cargado
    const p = state.perfil || {};
    const nombre = (inputNombre && inputNombre.value.trim()) || p.nombre || '';
    const telefono = (inputTel && inputTel.value.trim()) || p.telefono || '';

    const res = await fetch(CONTACTO_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + session.access_token },
      body: JSON.stringify({ nombre, telefono, asunto: a, mensaje: m })
    });
    let data = {};
    try { data = await res.json(); } catch (e) {}
    if (res.ok) {
      if (asunto) asunto.value = '';
      if (cuerpo) cuerpo.value = '';
      if (inputNombre) inputNombre.value = '';
      if (inputTel) inputTel.value = '';
      toast('Mensaje enviado. Te responderemos pronto.');
    }
    else if (res.status === 429) toast('Enviaste varios mensajes seguidos. Intenta de nuevo en un rato.');
    else if (res.status === 401) toast('Tu sesión venció. Inicia sesión de nuevo.');
    else toast(data.error || 'No se pudo enviar el mensaje. Intenta de nuevo.');
  } catch (err) {
    console.error('Error al enviar el mensaje:', err);
    toast('No se pudo conectar. Revisa tu internet e intenta de nuevo.');
  } finally {
    enviandoMensaje = false;
    if (btn) { btn.disabled = false; btn.textContent = 'Enviar mensaje'; }
  }
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

/* ===================== INICIAR SESIÓN CON GOOGLE ===================== */
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
    if(head) head.setAttribute('transform', 'translate(' + (centerX + headX) + ',0)');
    const pct = Math.floor(t*100);
    if(printPct) printPct.textContent = pct + '%';
    if(printBar) printBar.style.width = pct + '%';
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();

/* ===================== CARGA DE DATOS DESDE LA BASE ===================== */
async function cargarBase(){
  const [cfg, mats, cols, prods, fils] = await Promise.all([
    supabase.from('configuracion').select('*').eq('id', 1).maybeSingle(),
    supabase.from('materiales').select('*').order('id'),
    supabase.from('colores').select('*').order('id'),
    supabase.from('productos').select('*').order('id_producto'),
    supabase.from('filamentos').select('id_filamento, tipo, cantidad').order('id_filamento'),
  ]);
  // Filamentos con existencia: es lo único que el cliente puede elegir al cotizar
  state.filamentosTodos = (fils.data||[]).map(f=>({ id:f.id_filamento, nombre:f.tipo||'', gramos:Number(f.cantidad)||0, ...partesFilamento(f.tipo) }))
    .filter(f => f.material && f.color);
  state.filamentosDisp = state.filamentosTodos.filter(f => f.gramos > 0);
  // ¿Esta cuenta puede leer la tabla de filamentos? (si las reglas RLS no lo permiten, viene vacía)
  state.filamentosVisibles = !!(fils.data && fils.data.length);
  if(cfg.data){
    state.precios = { porGramo: Number(cfg.data.precio_gramo)||0, porHora: Number(cfg.data.precio_hora)||0 };
  }
  state.materiales = (mats.data||[]).map(m=>({ id:m.id, nombre:m.nombre, mult:Number(m.mult) }));
  state.colores    = (cols.data||[]).map(c=>({ id:c.id, nombre:c.nombre }));
  state.productos  = (prods.data||[]).map(p=>({
    id:p.id_producto, nombre:p.nombre, desc:p.descripcion||'', precio:Number(p.precio)||0,
    imagenes: (Array.isArray(p.imagenes) && p.imagenes.length ? p.imagenes : (p.imagen_url ? [p.imagen_url] : [])).filter(Boolean),
    imagen:p.imagen_url||'', peso:Number(p.peso_gramos)||0, material:p.material||'', color:p.color||'',
    existencias:0, existenciaGuardada:Number(p.existencia)||0
  }));
  // Las existencias ya no se escriben a mano: salen de los gramos de filamento
  state.productos.forEach(p => {
    if(!p.imagen && p.imagenes.length) p.imagen = p.imagenes[0];
    // Total de piezas que alcanzan sumando todos los colores disponibles del material
    const cols = coloresProducto(p);
    p.existencias = cols.length ? cols.reduce((a,c)=>a + c.piezas, 0) : piezasPosibles(p);
  });
}

/* ---- Productos hechos con filamento: cuántas piezas alcanzan ---- */
function filamentoDeProducto(p){
  return p && p.material && p.color ? filamentoPara(state.filamentosTodos, p.material, p.color) : null;
}
function piezasPosibles(p, gramosApartados){
  const f = filamentoDeProducto(p);
  // Si esta cuenta no puede ver los filamentos (cliente), se usa la cifra que el negocio deja guardada en el producto
  if(!f && !state.filamentosVisibles) return Math.max(0, p.existenciaGuardada - Math.ceil((gramosApartados||0) / (p.peso || 1)));
  if(!f || !(p.peso > 0)) return 0;
  return Math.max(0, Math.floor((f.gramos - (gramosApartados||0)) / p.peso));
}
// Colores en que se puede pedir un producto: los filamentos del mismo material con gramos.
// Si la cuenta no puede ver filamentos, solo el color con el que se registró.
function coloresProducto(p){
  if(!p || !(p.peso > 0) || !p.material) return [];
  if(!state.filamentosVisibles){
    return p.color ? [{ color:p.color, piezas:Math.max(0, p.existenciaGuardada), fil:null }] : [];
  }
  const lista = state.filamentosTodos.filter(f => mismoTexto(f.material, p.material))
    .map(f => ({ color:f.color, piezas:Math.floor(f.gramos / p.peso), fil:f }));
  // el color con el que se registró el producto va primero
  lista.sort((a,b) => (mismoTexto(b.color, p.color) - mismoTexto(a.color, p.color)) || a.color.localeCompare(b.color));
  return lista;
}
// Cuántas piezas MÁS de este producto y color caben, contando lo que ya está en el carrito
function maxAgregable(p, color){
  const f = filamentoPara(state.filamentosTodos, p.material, color);
  if(!f){
    if(state.filamentosVisibles) return 0;
    const yaEnCarrito = state.carrito.filter(l=>l.tipo==='producto' && l.ref===p.id).reduce((a,l)=>a+l.cantidad,0);
    return Math.max(0, p.existenciaGuardada - yaEnCarrito);
  }
  const usados = state.carrito.filter(l=>l.tipo==='producto').reduce((a,l)=>{
    const q = state.productos.find(x=>x.id===l.ref);
    return a + (q && filamentoPara(state.filamentosTodos, q.material, l.color || q.color) === f ? q.peso * l.cantidad : 0);
  }, 0);
  return Math.max(0, Math.floor((f.gramos - usados) / p.peso));
}
const COLORES_CSS = { negro:'#161616', blanco:'#FFFFFF', gris:'#9A9A9A', plata:'#C7C7C7', plateado:'#C7C7C7', rojo:'#E53935', azul:'#2F6BFF',
  celeste:'#6EC6FF', verde:'#2BD96B', amarillo:'#FFD60A', naranja:'#FF7A1A', anaranjado:'#FF7A1A', rosa:'#FF4F9A', rosado:'#FF4F9A',
  morado:'#7E4BD6', violeta:'#7E4BD6', lila:'#B79CED', cafe:'#7A4B2A', 'café':'#7A4B2A', marron:'#7A4B2A', 'marrón':'#7A4B2A',
  dorado:'#D4AF37', oro:'#D4AF37', beige:'#E8D9B5', crema:'#F3E9D2', turquesa:'#1CC8B6', transparente:'transparent' };
function colorCSS(nombre){
  const n = String(nombre||'').trim().toLowerCase();
  if(COLORES_CSS[n]) return COLORES_CSS[n];
  const k = Object.keys(COLORES_CSS).find(x => n.includes(x));
  return k ? COLORES_CSS[k] : '#BDBDBD';
}

// Gramos que ya ocupan en el carrito otros productos del mismo filamento
function gramosEnCarrito(p, excluirId){
  const f = filamentoDeProducto(p);
  if(!f) return 0;   // sin acceso a filamentos: cada producto se limita por su propia cifra guardada
  return state.carrito.filter(l=>l.tipo==='producto' && l.ref!==excluirId).reduce((a,l)=>{
    const q = state.productos.find(x=>x.id===l.ref);
    return a + (q && filamentoDeProducto(q) === f ? q.peso * l.cantidad : 0);
  }, 0);
}

async function cargarCliente(){
  const { data: { user } } = await supabase.auth.getUser();
  if(!user) return;

  const ap = user.app_metadata || {};
  const provs = (ap.providers || (ap.provider ? [ap.provider] : [])).slice();
  const ids = user.identities || [];
  ids.forEach(i => { if(i.provider && provs.indexOf(i.provider) === -1) provs.push(i.provider); });
  state.tieneGoogle   = provs.indexOf('google') !== -1;
  state.tienePassword = provs.indexOf('email') !== -1;
  state.esSoloGoogle  = state.tieneGoogle && !state.tienePassword;
  const um = user.user_metadata || {};
  const gi = ids.filter(i => i.provider === 'google')[0];
  const gd = (gi && gi.identity_data) || {};
  state.fotoGoogle = state.tieneGoogle ? (um.avatar_url || um.picture || gd.avatar_url || gd.picture || '') : '';

  let per = await supabase.from('usuarios').select('*').eq('auth_id', user.id).maybeSingle();
  if(per.error){ console.error(per.error); toast('No se pudo leer tu perfil: ' + per.error.message); return; }

  if(!per.data){
    const meta0 = user.user_metadata || {};
    const nombreInicial = meta0.full_name || meta0.name || (user.email || '').split('@')[0];

    const r = await supabase.rpc('asegurar_perfil');
    if(!r.error && r.data){
      per = { data: r.data };
    } else {
      console.warn('asegurar_perfil falló, se intenta crear directo:', r.error);
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
  restaurarCarrito();
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

  const selMaterial = document.getElementById('q-material');
  if(selMaterial) selMaterial.addEventListener('change', () => {
    actualizarColoresCliente();
    actualizarPesoTiempo();
    if(state.lastQuote) calcularCotizacion();
  });

  ['q-infill', 'q-material', 'q-color', 'q-cantidad'].forEach(id => {
    const el = document.getElementById(id);
    if(!el) return;
    const alCambiar = () => {
      actualizarPesoTiempo();
      if(state.lastQuote) calcularCotizacion();
    };
    el.addEventListener('change', alCambiar);
    if(id === 'q-cantidad' || id === 'q-infill') el.addEventListener('input', alCambiar);
  });
}

// ---------- REGLAS Y RESTRICCIONES ----------
const MAX_ARCHIVO_MB = 50;      
const MIN_MEDIDA_MM  = 2;       
const MAX_MEDIDA_MM  = 400;     
const MAX_CANTIDAD   = 100;     

const CIUDADES_ENVIO = [
  { grupo: 'Departamento de Guatemala', ciudades: [
    'Guatemala', 'Mixco', 'Villa Nueva', 'Villa Canales', 'San Miguel Petapa', 'Santa Catarina Pinula',
    'San José Pinula', 'Fraijanes', 'Chinautla', 'San Pedro Ayampuc', 'San Pedro Sacatepéquez',
    'San Juan Sacatepéquez', 'Amatitlán', 'Palencia', 'San Raimundo', 'San José del Golfo', 'Chuarrancho' ] },
  { grupo: 'Cabeceras departamentales', ciudades: [
    'Antigua Guatemala', 'Chimaltenango', 'Escuintla', 'Cuilapa', 'Sololá', 'Totonicapán', 'Quetzaltenango',
    'Mazatenango', 'Retalhuleu', 'San Marcos', 'Huehuetenango', 'Santa Cruz del Quiché', 'Salamá', 'Cobán',
    'Flores', 'Puerto Barrios', 'Chiquimula', 'Zacapa', 'Jalapa', 'Jutiapa', 'Guastatoya' ] }
];
const CIUDADES_PLANAS = CIUDADES_ENVIO.reduce((a, g) => a.concat(g.ciudades), []);

function digitosTelGT(v){
  const s = String(v || '').trim();
  let d;
  if(s.startsWith('+502')) d = s.slice(4).replace(/\D/g, '');
  else { d = s.replace(/\D/g, ''); if(d.length > 8 && d.startsWith('502')) d = d.slice(3); }
  return d;
}
function formatearTelGT(v){
  const d = digitosTelGT(v).slice(0, 8);
  if(!d) return '';
  return '+502 ' + d.slice(0, 4) + (d.length > 4 ? ' ' + d.slice(4) : '');
}
function errTelGT(v){
  const d = digitosTelGT(v);
  if(!d) return 'Ingresa tu teléfono';
  if(d.length !== 8) return 'Debe tener 8 dígitos, por ejemplo +502 5555 1234';
  if(!/^[2-7]/.test(d)) return 'Los números de Guatemala empiezan con 2, 3, 4, 5, 6 o 7';
  if(/^(\d)\1{7}$/.test(d)) return 'Ese número no parece real';
  return '';
}
function errCiudad(v){
  if(!String(v || '').trim()) return 'Selecciona una ciudad';
  return CIUDADES_PLANAS.indexOf(v) === -1 ? 'Elige una ciudad de la lista' : '';
}
function errCP(v){
  const s = String(v || '').trim();
  return (s && !/^\d{5}$/.test(s)) ? 'El código postal tiene 5 dígitos' : '';
}
function errDireccion(v){
  const s = String(v || '').trim();
  if(s.length < 10) return 'Escribe tu dirección completa (calle, zona, colonia o referencias)';
  if(s.length > 150) return 'La dirección es muy larga (máximo 150 caracteres)';
  return '';
}

const MAX_FOTO_MB = 5;
const BUCKET_PERFILES = 'perfiles';     // bucket de Supabase Storage para fotos de perfil
const BUCKET_PRODUCTOS = 'productos';   // bucket de Supabase Storage para fotos del catálogo          
const FOTO_PX = 256;            

const PALABRAS_PROHIBIDAS = [
  'puta','puto','putas','putos','putada','hijueputa','hdp','ptm','pendejo','pendeja','pendejada',
  'cabron','cabrona','chinga','chingar','chingada','chingado','chingue','mierda','carajo','verga','pinga',
  'culo','culero','culera','culiado','marica','maricon','mamon','mamona','zorra','perra','idiota','imbecil',
  'estupido','estupida','malparido','malparida','gonorrea','joder','jodido','cojones','ojete','pinche',
  'huevon','huevona','conchatumadre','mamaguevo','sexo','porno','nazi','hitler','violador','violacion',
  'asesino','terrorista','narco','admin','administrador','staff',
  'fuck','fucker','fucking','shit','bitch','asshole','bastard','cunt','whore','slut','nigger','nigga',
  'faggot','retard','rapist','pussy'
];
function _normNombre(s){
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]+/g, ' ').trim();
}
function _colapsar(t){ return t.replace(/(.)\1+/g, '$1'); }          
const _PROHIBIDAS = new Set(PALABRAS_PROHIBIDAS.map(w => _colapsar(_normNombre(w))));
function nombreInapropiado(nombre){
  const tokens = _normNombre(nombre).split(' ').filter(Boolean).map(_colapsar);
  const pegadas = []; let run = '';                                   
  tokens.forEach(t => { if(t.length === 1) run += t; else { if(run.length >= 3) pegadas.push(run); run = ''; } });
  if(run.length >= 3) pegadas.push(run);
  return tokens.concat(pegadas).some(t => _PROHIBIDAS.has(t) || _PROHIBIDAS.has(t.replace(/e?s$/, '')));
}
function errNombre(v){
  const s = String(v || '').normalize('NFC').replace(/\s+/g, ' ').trim();
  if(s.length < 2 || s.length > 40) return 'Escribe tu nombre (entre 2 y 40 caracteres)';
  if(!/^\p{L}[\p{L} .'’-]*$/u.test(s)) return 'Usa solo letras, espacios, guiones y apóstrofes';
  if((s.match(/\p{L}/gu) || []).length < 2 || /(.)\1{3,}/u.test(s)) return 'Ese nombre no parece real';
  if(/(https?|www|\.com|\.net|\.org)/i.test(s)) return 'No se permiten enlaces en el nombre';
  if(nombreInapropiado(s)) return 'Ese nombre no está permitido. Usa tu nombre real.';
  return '';
}

// ---------- PERFIL DEL CLIENTE ----------
let perfilSucio = false;        
let validarAlMostrar = null;    
let busquedaCatalogo = '';      

function leerExtraPerfil(){
  const p = state.perfil || {};
  let local = {};
  try{ local = JSON.parse(localStorage.getItem('perfil_extra_' + p.id_user) || '{}') || {}; }catch(e){}
  const v = k => (k in p) ? p[k] : local[k];            
  return {
    direccion:     v('direccion') || '',
    ciudad_envio:  v('ciudad_envio') || '',
    codigo_postal: v('codigo_postal') || '',
    residencial:   v('residencial') || '',
    codigo_acceso: v('codigo_acceso') || '',
    notif_correo:  v('notif_correo') !== false
  };
}

function poblarCiudades(){
  ['pf-ciudad', 'pf-ciudad-envio'].forEach((id, i) => {
    const sel = document.getElementById(id);
    if(!sel || sel.options.length) return;
    sel.innerHTML = `<option value="">${i ? 'Selecciona la ciudad de entrega' : 'Selecciona tu ciudad'}</option>` +
      CIUDADES_ENVIO.map(g => `<optgroup label="${esc(g.grupo)}">` + g.ciudades.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('') + '</optgroup>').join('');
  });
}

function rellenarPerfil(){
  const p = state.perfil;
  if(!p) return;
  poblarCiudades();
  const $ = id => document.getElementById(id);
  const setText = (id, v) => { const el = $(id); if(el) el.textContent = v; };

  const nombre = p.nombre || p.full_name || '';
  const correo = p.correo || p.email || '';
  const tel    = p.telefono || p.phone || '';
  const ciudad = p.ciudad || '';
  const x = leerExtraPerfil();

  const visible = nombre || correo.split('@')[0] || 'Cliente';
  const inicial = (nombre || correo || '?').trim().charAt(0).toUpperCase();
  const propia = leerAvatarPropio();
  const foto = propia || state.fotoGoogle;
  pintarAvatar($('pf-avatar'), inicial, foto);
  pintarAvatar($('pf-avatar-top'), inicial, foto);
  const qf = $('pf-quitar-foto'); if(qf) qf.hidden = !propia;

  const gSolo = !!state.esSoloGoogle, gAlgo = !!state.tieneGoogle;
  const via = $('pf-via'); if(via) via.hidden = !gAlgo;
  setText('pf-via-txt', gSolo ? 'Conectado con Google' : 'Google vinculado');
  const bp = $('pf-btn-pass'); if(bp) bp.hidden = gSolo;
  const ag = $('pf-acceso-google'); if(ag) ag.hidden = !gAlgo;
  setText('pf-google-txt', gSolo
    ? 'Inicias sesión con Google, así que tu contraseña y la seguridad de tu acceso se administran desde tu cuenta de Google.'
    : 'Tu cuenta también está vinculada con Google. Puedes entrar con cualquiera de los dos; la contraseña de aquí la cambias con el botón de arriba.');
  setText('pf-correo-help', gSolo ? 'Es el correo de tu cuenta de Google y no se puede cambiar.' : 'El correo es tu acceso y no se puede cambiar.');
  setText('pf-nombre-card', visible);
  setText('pf-nombre-top', visible);
  setText('pf-correo-card', correo);
  setText('pf-stat-archivos', state.archivos.length);
  setText('pf-stat-pedidos', state.pedidos.filter(o => o.estado === 'entregado').length);

  const piezas = [['nombre', nombre], ['teléfono', tel], ['ciudad', ciudad], ['dirección de envío', x.direccion]];
  const faltan = piezas.filter(([, v]) => !String(v || '').trim()).map(([k]) => k);
  const pct = Math.round(((piezas.length - faltan.length) / piezas.length) * 100);
  setText('pf-pct', pct + '%');
  const bar = $('pf-pct-bar'); if(bar) bar.style.width = pct + '%';
  setText('pf-pct-hint', faltan.length ? 'Te falta: ' + faltan.join(', ') + '.' : 'Todo listo para tus envíos.');

  if(!perfilSucio){
    const setVal = (id, val) => { const el = $(id); if(el && document.activeElement !== el) el.value = val || ''; };
    setVal('pf-nombre', nombre);
    setVal('pf-correo', correo);
    setVal('pf-tel', formatearTelGT(tel));
    setVal('pf-ciudad', ciudad);            
    setVal('pf-dir', x.direccion);
    setVal('pf-ciudad-envio', x.ciudad_envio);
    setVal('pf-cp', x.codigo_postal);
    setVal('pf-res', x.residencial);
    setVal('pf-codigo', x.codigo_acceso);
    const sw = $('pf-notif'); if(sw) sw.checked = x.notif_correo;
  }
  if(validarAlMostrar){ const o = validarAlMostrar; validarAlMostrar = null; validarFormularioPerfil(o); }
}

function setError(id, msg){
  const el = document.getElementById(id);
  const field = el && el.closest('.field');
  if(!field) return;
  let box = field.querySelector('.field-error');
  if(msg){
    if(!box){ box = document.createElement('div'); box.className = 'field-error'; box.setAttribute('role', 'alert'); field.appendChild(box); }
    box.textContent = msg;
    field.classList.add('invalid');
    el.setAttribute('aria-invalid', 'true');
  } else {
    if(box) box.remove();
    field.classList.remove('invalid');
    el.removeAttribute('aria-invalid');
  }
}

function validarFormularioPerfil(opts){
  opts = opts || {};
  const exigir = opts.envio !== undefined;
  const v = id => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
  const err = {};
  { const m = errNombre(v('pf-nombre')); if(m) err['pf-nombre'] = m; }
  if(v('pf-tel') || exigir){ const m = errTelGT(v('pf-tel')); if(m) err['pf-tel'] = m; }
  if(v('pf-ciudad') || exigir){ const m = errCiudad(v('pf-ciudad')); if(m) err['pf-ciudad'] = m; }
  const dir = v('pf-dir'), ce = v('pf-ciudad-envio'), cp = v('pf-cp'), res = v('pf-res'), cod = v('pf-codigo');
  if(dir || ce || cp || res || cod || opts.envio){
    const m1 = errDireccion(dir); if(m1) err['pf-dir'] = m1;
    const m2 = errCiudad(ce);     if(m2) err['pf-ciudad-envio'] = m2;
  }
  { const m3 = errCP(cp); if(m3) err['pf-cp'] = m3; }
  if(res.length > 80) err['pf-res'] = 'Máximo 80 caracteres';
  if(cod.length > 60) err['pf-codigo'] = 'Máximo 60 caracteres';

  ['pf-nombre', 'pf-tel', 'pf-ciudad', 'pf-dir', 'pf-ciudad-envio', 'pf-cp', 'pf-res', 'pf-codigo'].forEach(id => setError(id, err[id] || ''));
  const primero = Object.keys(err)[0];
  if(primero){
    const el = document.getElementById(primero);
    if(opts.foco) el.focus(); else el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  return err;
}

function alEscribirPerfil(e){
  const t = e && e.target;
  if(t && t.type === 'file') return;
  if(t && t.id){
    if(t.id === 'pf-tel'){ const f = formatearTelGT(t.value); if(f !== t.value) t.value = f; }
    if(t.id === 'pf-cp'){ t.value = t.value.replace(/\D/g, '').slice(0, 5); }
    setError(t.id, '');
  }
  marcarPerfilSucio();
}

function alSalirCampo(e){
  const t = e && e.target;
  if(!t || !t.id || !t.value.trim()) return;
  if(t.id === 'pf-tel') setError('pf-tel', errTelGT(t.value));
  else if(t.id === 'pf-cp') setError('pf-cp', errCP(t.value));
  else if(t.id === 'pf-dir') setError('pf-dir', errDireccion(t.value));
}

function exigirPerfil(conEnvio){
  const p = state.perfil || {}, x = leerExtraPerfil(), falta = [];
  if(errTelGT(p.telefono)) falta.push('teléfono');
  if(errCiudad(p.ciudad)) falta.push('ciudad');
  if(conEnvio){
    if(errDireccion(x.direccion)) falta.push('dirección de entrega');
    if(errCiudad(x.ciudad_envio)) falta.push('ciudad de entrega');
  }
  if(!falta.length) return true;
  validarAlMostrar = { envio: !!conEnvio };
  toast('Antes de continuar completa en tu perfil: ' + falta.join(', ') + '.');
  abrirPerfil();
  return false;
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

async function guardarPerfil(event) {
  if (event) event.preventDefault();
  const btn = document.getElementById('btnGuardarPerfil');
  try {
    if (typeof supabase === 'undefined' || !supabase) { toast("Error: No hay conexión con la base de datos"); return; }
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { toast("Debes iniciar sesión para guardar los cambios"); return; }
    if (!state.perfil) { toast("No se encontró tu perfil"); return; }

    const errores = validarFormularioPerfil({ foco: true });
    if(Object.keys(errores).length){ toast('Revisa los campos marcados en rojo'); return; }

    const val = id => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
    const datos = {
      nombre:   val('pf-nombre').replace(/\s+/g, ' ') || state.perfil.nombre,
      telefono: val('pf-tel') ? formatearTelGT(val('pf-tel')) : null,
      ciudad:   val('pf-ciudad') || null
    };
    const extra = {
      direccion:     val('pf-dir').replace(/\s+/g, ' '),
      ciudad_envio:  val('pf-ciudad-envio'),
      codigo_postal: val('pf-cp'),
      residencial:   val('pf-res').replace(/\s+/g, ' '),
      codigo_acceso: val('pf-codigo').replace(/\s+/g, ' '),
      notif_correo:  !!document.getElementById('pf-notif').checked
    };
    const enLocal = {};
    Object.keys(extra).forEach(k => {
      if(k in state.perfil) datos[k] = (typeof extra[k] === 'string') ? (extra[k] || null) : extra[k];
      else enLocal[k] = extra[k];
    });

    if(btn){ btn.disabled = true; btn.textContent = 'Guardando...'; }
    const { error } = await supabase.from('usuarios').update(datos).eq('id_user', state.perfil.id_user);

    if (error) {
      console.error("Error al guardar en Supabase:", error);
      toast("Error al guardar: " + error.message);
      return;
    }
    if(Object.keys(enLocal).length){
      try{
        const clave = 'perfil_extra_' + state.perfil.id_user;
        const previo = JSON.parse(localStorage.getItem(clave) || '{}') || {};
        localStorage.setItem(clave, JSON.stringify(Object.assign(previo, enLocal)));
      }catch(e){}
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

async function cambiarPassword(){
  if(state.esSoloGoogle){ toast('Tu cuenta usa Google: administra tu contraseña desde tu cuenta de Google'); return; }
  const correo = state.perfil && state.perfil.correo;
  if(!correo){ toast('No encontramos tu correo'); return; }
  const { error } = await supabase.auth.resetPasswordForEmail(correo);
  toast(error ? 'No se pudo enviar el correo: ' + error.message : 'Te enviamos un correo para cambiar tu contraseña');
}

let perfilAbierto = false, perfilFocoPrevio = null;

function abrirPerfil(){
  const m = document.getElementById('perfil-modal');
  if(!m || !m.hidden) return;
  perfilFocoPrevio = document.activeElement;
  m.hidden = false; perfilAbierto = true;
  document.body.style.overflow = 'hidden';
  rellenarPerfil();                                    
  if(!m.querySelector('.invalid')){ const x = m.querySelector('.icon-btn'); if(x) x.focus(); }
}

function cerrarPerfil(){
  const m = document.getElementById('perfil-modal');
  if(!m || m.hidden) return true;
  if(perfilSucio){
    if(!confirm('Tienes cambios sin guardar. ¿Descartarlos?')) return false;
    descartarPerfil();
  }
  ['pf-nombre', 'pf-tel', 'pf-ciudad', 'pf-dir', 'pf-ciudad-envio', 'pf-cp', 'pf-res', 'pf-codigo'].forEach(id => setError(id, ''));
  m.hidden = true; perfilAbierto = false;
  document.body.style.overflow = '';
  if(perfilFocoPrevio && perfilFocoPrevio.focus) perfilFocoPrevio.focus();
  return true;
}

document.addEventListener('keydown', e => {
  if(!perfilAbierto) return;
  if(e.key === 'Escape'){ e.preventDefault(); cerrarPerfil(); return; }
  if(e.key === 'Tab'){                                 
    const m = document.getElementById('perfil-modal');
    const f = Array.prototype.filter.call(m.querySelectorAll('a[href], button:not([disabled]), input, select, textarea'), el => el.offsetParent !== null);
    if(!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if(e.shiftKey && document.activeElement === first){ e.preventDefault(); last.focus(); }
    else if(!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
  }
});

function leerAvatarPropio(){
  const p = state.perfil || {};
  if('avatar_url' in p) return p.avatar_url || '';
  try{ return localStorage.getItem('perfil_avatar_' + p.id_user) || ''; }catch(e){ return ''; }
}

async function guardarAvatarUrl(url){
  const p = state.perfil;
  if('avatar_url' in p){
    const { error } = await supabase.from('usuarios').update({ avatar_url: url || null }).eq('id_user', p.id_user);
    if(error) throw error;
    p.avatar_url = url || null;
  } else {
    try{ if(url) localStorage.setItem('perfil_avatar_' + p.id_user, url); else localStorage.removeItem('perfil_avatar_' + p.id_user); }catch(e){}
  }
}

function procesarFoto(file){
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const lado = Math.min(img.naturalWidth, img.naturalHeight);
      if(!lado) return reject(new Error('La imagen está vacía'));
      const c = document.createElement('canvas');
      c.width = c.height = FOTO_PX;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, FOTO_PX, FOTO_PX);
      ctx.drawImage(img, (img.naturalWidth - lado) / 2, (img.naturalHeight - lado) / 2, lado, lado, 0, 0, FOTO_PX, FOTO_PX);
      c.toBlob(b => b ? resolve(b) : reject(new Error('No se pudo procesar la imagen')), 'image/jpeg', 0.85);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo leer la imagen')); };
    img.src = url;
  });
}

function elegirFoto(){ const i = document.getElementById('pf-foto-input'); if(i) i.click(); }

async function alElegirFoto(e){
  const input = e.target, file = input.files && input.files[0];
  input.value = '';
  if(!file) return;
  if(['image/jpeg', 'image/png', 'image/webp'].indexOf(file.type) === -1){ toast('Usa una foto JPG, PNG o WebP'); return; }
  if(file.size > MAX_FOTO_MB * 1024 * 1024){ toast(`La foto pesa más de ${MAX_FOTO_MB} MB`); return; }
  const cam = document.getElementById('pf-cam');
  try{
    if(typeof supabase === 'undefined' || !supabase){ toast('No hay conexión con la base de datos'); return; }
    const { data: { user } } = await supabase.auth.getUser();
    if(!user){ toast('Inicia sesión de nuevo para cambiar tu foto'); return; }
    if(cam) cam.disabled = true;
    toast('Subiendo foto...');
    const blob = await procesarFoto(file);
    const ruta = user.id + '/avatar.jpg';
    const { error } = await supabase.storage.from(BUCKET_PERFILES).upload(ruta, blob, { upsert: true, contentType: 'image/jpeg', cacheControl: '3600' });
    if(error) throw error;
    const base = supabase.storage.from(BUCKET_PERFILES).getPublicUrl(ruta).data.publicUrl;
    await guardarAvatarUrl(base + '?v=' + Date.now());     
    rellenarPerfil();
    toast('¡Foto actualizada!');
  }catch(err){
    console.error('Error al subir la foto:', err);
    toast('No se pudo subir la foto: ' + (err.message || err));
  }finally{
    if(cam) cam.disabled = false;
  }
}

async function quitarFoto(){
  try{
    const { data: { user } } = await supabase.auth.getUser();
    if(user) await supabase.storage.from(BUCKET_PERFILES).remove([user.id + '/avatar.jpg']);
    await guardarAvatarUrl('');
    rellenarPerfil();
    toast('Foto eliminada');
  }catch(err){
    console.error('Error al quitar la foto:', err);
    toast('No se pudo quitar la foto: ' + (err.message || err));
  }
}

function pintarAvatar(el, inicial, foto){
  if(!el) return;
  const ok = !!foto && /^https:\/\//.test(foto);
  if(ok && el.dataset.foto === foto && el.querySelector('img')) return;
  el.textContent = inicial; delete el.dataset.foto;
  if(!ok) return;
  const img = new Image();
  img.alt = ''; img.referrerPolicy = 'no-referrer';
  img.onload = () => { el.textContent = ''; el.appendChild(img); el.dataset.foto = foto; };
  img.src = foto;
}

function mostrarVistaInicial(){
  const app = document.getElementById('app-cliente');
  if(!app) return;
  app.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'v-catalogo'));
  app.querySelectorAll('.sidebar .side-btn').forEach(b => b.classList.toggle('active', b.dataset.view === 'v-catalogo'));
  const m = document.getElementById('perfil-modal');
  if(m){ m.hidden = true; perfilAbierto = false; document.body.style.overflow = ''; }
}

const MQ_MOVIL = window.matchMedia('(max-width: 900px)');
let menuFocoPrevio = null;

function actualizarBotonMenu(app){
  const b = app.querySelector('.side-collapse'); if(!b) return;
  const col = app.classList.contains('menu-colapsado');
  const t = MQ_MOVIL.matches ? 'Cerrar menú' : (col ? 'Expandir menú' : 'Contraer menú');
  b.setAttribute('aria-label', t); b.title = t;
  b.setAttribute('aria-expanded', String(MQ_MOVIL.matches ? app.classList.contains('menu-abierto') : !col));
}

function alternarMenu(btn){
  const app = btn.closest('.app');
  if(MQ_MOVIL.matches){ cerrarMenu(app); return; }
  app.classList.toggle('menu-colapsado');
  try{ localStorage.setItem('menu_colapsado_' + app.id, app.classList.contains('menu-colapsado') ? '1' : '0'); }catch(e){}
  actualizarBotonMenu(app);
}

function abrirMenu(btn){
  const app = btn.closest('.app'); if(!app) return;
  menuFocoPrevio = btn;
  app.classList.add('menu-abierto');
  document.body.style.overflow = 'hidden';
  actualizarBotonMenu(app);
  const activo = app.querySelector('.sidebar .side-btn.active') || app.querySelector('.sidebar .side-btn');
  if(activo) setTimeout(() => activo.focus(), 60);
}

function cerrarMenu(app){
  app = app || document.querySelector('.app.menu-abierto');
  if(!app || !app.classList.contains('menu-abierto')) return;
  app.classList.remove('menu-abierto');
  if(!perfilAbierto) document.body.style.overflow = '';
  actualizarBotonMenu(app);
  if(menuFocoPrevio && menuFocoPrevio.focus) menuFocoPrevio.focus();
}

function iniciarMenus(){
  document.querySelectorAll('.app').forEach(app => {
    let col = false;
    try{ col = localStorage.getItem('menu_colapsado_' + app.id) === '1'; }catch(e){}
    app.classList.toggle('menu-colapsado', col);
    app.querySelectorAll('.side-btn').forEach(b => { const l = b.querySelector('.lbl'); if(l) b.title = l.textContent.trim(); });   
    actualizarBotonMenu(app);
  });
}
(MQ_MOVIL.addEventListener ? MQ_MOVIL.addEventListener.bind(MQ_MOVIL) : MQ_MOVIL.addListener.bind(MQ_MOVIL))('change', () => {
  cerrarMenu();
  document.querySelectorAll('.app').forEach(actualizarBotonMenu);
});
document.addEventListener('keydown', e => { if(e.key === 'Escape') cerrarMenu(); });
if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciarMenus); else iniciarMenus();

function irAVista(viewId){
  const btn = document.querySelector('#app-cliente .side-btn[data-view="' + viewId + '"]');
  showView('cliente', viewId, btn);
}

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

/* ---- Filamentos: el tipo se guarda como "Material · Color" y la cantidad en gramos ---- */
const GRAMOS_CARRETE = 1000;   // referencia para la barra del resumen (carrete estándar de 1 kg)
function partesFilamento(tipo){
  const p = String(tipo||'').split('·').map(x=>x.trim()).filter(Boolean);
  return p.length >= 2 ? { material:p[0], color:p.slice(1).join(' · ') } : { material:'', color:p[0]||'' };
}
const mismoTexto = (a,b) => String(a||'').trim().toLowerCase() === String(b||'').trim().toLowerCase();
function filamentoPara(lista, material, color){
  return (lista||[]).find(f=>{ const x = f.material !== undefined ? f : partesFilamento(f.nombre); return mismoTexto(x.material, material) && mismoTexto(x.color, color); });
}
const gramosTxt = g => (Math.round(g*10)/10).toLocaleString('es-GT') + ' g';

function actualizarColoresCliente(){
  const matSelect = document.getElementById('q-material');
  const colorSelect = document.getElementById('q-color');
  if(!matSelect || !colorSelect) return;
  const colPrev = colorSelect.value;
  const disp = (state.filamentosDisp||[]).filter(f=>mismoTexto(f.material, matSelect.value));
  colorSelect.innerHTML = disp.length
    ? disp.map(f=>`<option value="${esc(f.color)}">${esc(f.color)}</option>`).join('')
    : `<option value="">Sin colores disponibles</option>`;
  if(colPrev && disp.some(f=>f.color===colPrev)) colorSelect.value = colPrev;
}

function populateSelects(){
  const matSelect = document.getElementById('q-material');
  const colorSelect = document.getElementById('q-color');
  const pill = document.getElementById('priceRulePill');
  const matPrev = matSelect ? matSelect.value : '';
  const colPrev = colorSelect ? colorSelect.value : '';

  // Solo materiales que el negocio tiene en filamento (con gramos disponibles)
  const disp = state.filamentosDisp || [];
  const materialesDisp = state.materiales.filter(m => disp.some(f=>mismoTexto(f.material, m.nombre)));
  if(matSelect){
    matSelect.innerHTML = materialesDisp.length
      ? materialesDisp.map(m=>`<option value="${esc(m.nombre)}">${esc(m.nombre)}</option>`).join('')
      : `<option value="">Sin filamentos disponibles</option>`;
    if(matPrev && materialesDisp.some(m=>m.nombre===matPrev)) matSelect.value = matPrev;
  }
  if(colorSelect){
    actualizarColoresCliente();
    if(colPrev && [...colorSelect.options].some(o=>o.value===colPrev)) colorSelect.value = colPrev;
  }
  if(pill) pill.textContent = (state.precios.porGramo > 0 && state.precios.porHora > 0)
    ? `Q${state.precios.porGramo.toFixed(2)}/g · Q${state.precios.porHora.toFixed(2)}/h`
    : 'Precios no definidos';
}

function signedVolumeOfTriangle(p1,p2,p3){
  return (p1[0]*(p2[1]*p3[2]-p3[1]*p2[2]) - p1[1]*(p2[0]*p3[2]-p3[0]*p2[2]) + p1[2]*(p2[0]*p3[1]-p3[0]*p2[1]))/6.0;
}

function parseSTL(buffer){
  const view = new DataView(buffer);
  let volume = 0, area = 0, tris = 0;
  let aLado = 0, aArriba = 0, aAbajo = 0;   
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];

  const acumular = (a, b, c) => {
    volume += signedVolumeOfTriangle(a, b, c);
    const ux=b[0]-a[0], uy=b[1]-a[1], uz=b[2]-a[2];
    const vx=c[0]-a[0], vy=c[1]-a[1], vz=c[2]-a[2];
    const cx=uy*vz-uz*vy, cy=uz*vx-ux*vz, cz=ux*vy-uy*vx;
    const dobleArea = Math.sqrt(cx*cx + cy*cy + cz*cz);
    const a2 = dobleArea / 2;                           
    area += a2;
    if(dobleArea > 0){
      const nz = cz / dobleArea;                        
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
    if(84 + triCount*50 === buffer.byteLength){        
      let offset = 84;
      for(let i=0; i<triCount; i++){
        offset += 12;                                   
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
  if(!leido){                                           
    const text = new TextDecoder().decode(buffer);
    const rx = /vertex\s+([\-\d.eE+]+)\s+([\-\d.eE+]+)\s+([\-\d.eE+]+)/g;
    let m, verts = [];
    while((m = rx.exec(text))){
      verts.push([parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])]);
      if(verts.length === 3){ acumular(verts[0], verts[1], verts[2]); verts = []; }
    }
  }
  const dims = tris ? [max[0]-min[0], max[1]-min[1], max[2]-min[2]] : [0,0,0];
  if(volume < 0){ const t = aArriba; aArriba = aAbajo; aAbajo = t; }   
  return { volumeMm3: Math.abs(volume), areaMm2: area, aLado, aArriba, aAbajo, tris, dims };
}

let archivoSeleccionado = null;   
let volumenMm3 = 0;               
let areaMm2 = 0;                  
let areaLadoMm2 = 0, areaArribaMm2 = 0, areaAbajoMm2 = 0;
let alturaMm = 0;                 
let pesoBaseG = 0, tiempoBaseH = 0;  
let guardandoArchivo = false;     

const IMPRESION = {
  anchoLinea: 0.42,   
  paredes: 2,         
  capasSup: 5,        
  capasInf: 3,        
  altCapa: 0.2,       
  flujoMm3s: 8,       
  segPorCapa: 3       
};

IMPRESION.factorExtrusion = 1 - (IMPRESION.altCapa / IMPRESION.anchoLinea) * (1 - Math.PI / 4);
const DENSIDADES = { PLA: 1.24, PETG: 1.27, ABS: 1.04, TPU: 1.21 };   

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
  if(file.size === 0){ toast('El archivo está vacío.'); return; }
  if(file.size > MAX_ARCHIVO_MB * 1024 * 1024){ toast(`El archivo pesa más de ${MAX_ARCHIVO_MB} MB. Redúcelo o contáctanos.`); return; }
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
      const mayor = Math.max(...dims);
      if(mayor < MIN_MEDIDA_MM || mayor > MAX_MEDIDA_MM){
        toast(mayor < MIN_MEDIDA_MM
          ? `El modelo mide menos de ${MIN_MEDIDA_MM} mm: revisa que el STL esté en milímetros.`
          : `El modelo mide más de ${MAX_MEDIDA_MM/10} cm, que es nuestro tamaño máximo. Revisa que esté en milímetros o contáctanos.`);
        document.getElementById('fileNameLabel').textContent = 'Archivo rechazado: ' + file.name;
        archivoSeleccionado = null;
        return;
      }
      volumenMm3 = volumeMm3; areaMm2 = area; alturaMm = dims[2];
      areaLadoMm2 = aLado; areaArribaMm2 = aArriba; areaAbajoMm2 = aAbajo;
      actualizarPesoTiempo();

      toast(`Modelo leído: ${tris} triángulos · ${dims.map(d=>d.toFixed(0)).join(' × ')} mm`);
    } catch(err) {
      console.error(err);
      toast('No se pudo leer el archivo .STL. Verifica que no esté dañado.');
      document.getElementById('fileNameLabel').textContent = 'Archivo: ' + file.name;
    }
  };
  reader.readAsArrayBuffer(file);
}

// MEJORA: Estima peso y tiempo de UNA pieza leyendo dinámicamente el relleno del DOM (#q-infill)
function actualizarPesoTiempo(){
  if(!(volumenMm3 > 0)) return;

  const infillEl = document.getElementById('q-infill');
  const infillVal = infillEl ? parseFloat(infillEl.value) : 15;
  const infill = (infillVal > 1 ? infillVal / 100 : infillVal) || 0.15;

  const matSel = document.getElementById('q-material');
  const densidad = densidadDe(matSel ? matSel.value : '');

  const espLado = IMPRESION.paredes * IMPRESION.anchoLinea;
  const espArriba = IMPRESION.capasSup * IMPRESION.altCapa;
  const espAbajo = IMPRESION.capasInf * IMPRESION.altCapa;
  const cascaraTeorica = areaLadoMm2 * espLado + areaArribaMm2 * espArriba + areaAbajoMm2 * espAbajo;
  const delgada = cascaraTeorica >= volumenMm3;     
  const cascara = Math.min(volumenMm3, cascaraTeorica);
  const interior = Math.max(0, volumenMm3 - cascara);                
  
  const factorRelleno = infill >= 0.99 ? 1 : IMPRESION.factorExtrusion;
  const vImpreso = cascara + interior * infill * factorRelleno;                      

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
  const cantIn = document.getElementById('q-cantidad');
  let cant = Math.max(1, parseInt((cantIn || {}).value) || 1);
  if(cant > MAX_CANTIDAD){ cant = MAX_CANTIDAD; toast(`La cantidad máxima por cotización es ${MAX_CANTIDAD}. Para más piezas contáctanos.`); }
  if(cantIn) cantIn.value = cant;
  const material = state.materiales.find(m => m.nombre === materialNombre);
  if(!filamentoPara(state.filamentosDisp, materialNombre, color)){
    toast('Ese material y color no está disponible. Elige uno de la lista.');
    return;
  }

  if(!material){ toast('Elige un material'); return; }
  if(!color){ toast('Elige un color'); return; }

  actualizarPesoTiempo();                    
  const peso = pesoBaseG, tiempo = tiempoBaseH;
  if(!(peso > 0) || !(tiempo > 0)){ toast('No se pudo estimar el peso del archivo. Prueba con otro .STL.'); return; }

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
  if(guardandoArchivo) return;                       
  if(!state.lastQuote){ toast('Calcula un precio primero'); return; }
  if(!state.perfil){ toast('No se encontró tu perfil de cliente'); return; }
  if(!exigirPerfil(false)) return;          

  guardandoArchivo = true;
  const btn = document.querySelector('[onclick="guardarArchivo()"]');
  if(btn) btn.disabled = true;

  try {
    const q = state.lastQuote;

    toast('Subiendo archivo...');
    const sub = await subirArchivoA_S3(q.archivo);
    if(!sub) return;

    const dup = await supabase.from('archivos').select('id_archivo, nombre_archivo')
      .eq('id_usuario', state.perfil.id_user).eq('hash_archivo', sub.hash).maybeSingle();
    if(dup.data){
      toast(`Ese archivo ya lo guardaste antes (${dup.data.nombre_archivo}). Revisa "Mis archivos".`);
      return;
    }

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
    
    if(a.estado==='aprobada'){
      accion = archivoYaPedido(a.id)
        ? `<span class="small-note">Ya pedida</span>`
        : `<button class="btn btn-sm btn-primary" onclick="agregarArchivoAlCarrito(${a.id})">Agregar</button>`;
    } else if (a.estado === 'rechazada') {
      accion = `<button class="btn btn-sm" style="color:var(--danger); border-color:var(--danger);" onclick="eliminarArchivoCliente(${a.id})">Borrar</button>`;
    }

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
  await cargarCliente(); 
  refrescarCliente();    
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
  const aviso = q ? `<div class="small-note" style="grid-column:1/-1;margin:0 0 4px;">${lista.length} resultado(s) para «${esc(q)}» · <a href="#" onclick="limpiarBusqueda();return false;" style="color:var(--green-ink);font-weight:700;text-decoration:underline;">Ver todo</a></div>` : '';
  if(q && !lista.length){ grid.innerHTML = aviso + `<div class="empty" style="grid-column:1/-1;">No encontramos productos con ese nombre.</div>`; return; }
  grid.innerHTML = aviso + lista.map(p => {
    const cols = coloresProducto(p).filter(c => c.piezas > 0);
    const color = cols.length ? cols[0].color : '';
    const max = color ? maxAgregable(p, color) : 0;
    const nFotos = p.imagenes.length;
    return `
    <div class="prod-card">
      <button type="button" class="prod-img prod-abrir" onclick="abrirProducto(${p.id})" aria-label="Ver ${esc(p.nombre)} en grande">
        ${p.imagen ? `<img src="${esc(p.imagen)}" alt="${esc(p.nombre)}" loading="lazy">` : '<span class="prod-img-vacia" aria-hidden="true"></span>'}
        ${nFotos > 1 ? `<span class="prod-nfotos">${nFotos} fotos</span>` : ''}
      </button>
      <h4><button type="button" class="prod-titulo" onclick="abrirProducto(${p.id})">${esc(p.nombre)}</button></h4>
      <p>${esc(p.desc)}</p>
      <div class="price">${Q(p.precio)}</div>
      ${cols.length ? `<div class="color-dots" aria-label="Colores disponibles">${cols.slice(0,6).map(c=>`<span class="color-dot" style="background:${colorCSS(c.color)}" title="${esc(c.color)}"></span>`).join('')}${cols.length>6?`<span class="small-note">+${cols.length-6}</span>`:''}</div>` : ''}
      <p class="small-note">${p.existencias > 0 ? p.existencias + ' disponibles' + (cols.length > 1 ? ' · ' + cols.length + ' colores' : (color ? ' · ' + esc(p.material) + ' ' + esc(color) : '')) : 'Agotado'}</p>
      ${max > 0 ? `
      <div class="prod-acciones">
        <div class="stepper" data-stepper>
          <button type="button" class="step-btn" onclick="pasoCantidad(this,-1)" aria-label="Menos">−</button>
          <input type="number" class="step-num" id="cant-${p.id}" value="1" min="1" max="${max}" inputmode="numeric" aria-label="Cantidad de ${esc(p.nombre)}" onchange="limitarCantidad(this)">
          <button type="button" class="step-btn" onclick="pasoCantidad(this,1)" aria-label="Más">+</button>
        </div>
        <button class="btn btn-sm btn-primary" onclick="agregarProductoAlCarrito(${p.id}, document.getElementById('cant-${p.id}').value, '${esc(color).replace(/'/g,"&#39;")}')">Agregar</button>
      </div>` : `<button type="button" class="btn btn-sm" onclick="abrirProducto(${p.id})">${p.existencias > 0 ? 'Ver colores' : 'Ver producto'}</button>`}
    </div>`;
  }).join('');
}

// Botones − / + del selector de cantidad
function pasoCantidad(btn, d){
  const input = btn.parentElement.querySelector('input');
  if(!input) return;
  input.value = (parseInt(input.value) || 1) + d;
  limitarCantidad(input);
}
function limitarCantidad(input){
  const max = parseInt(input.max) || 1;
  let v = parseInt(input.value) || 1;
  if(v < 1) v = 1;
  if(v > max){ v = max; toast(`Solo hay ${max} disponible(s)`); }
  input.value = v;
  if(input.id === 'pm-cant') actualizarTotalModal();
}

function agregarProductoAlCarrito(id, cantidad, color){
  const p = state.productos.find(x=>x.id===id);
  if(!p) return false;
  const n = Math.max(1, parseInt(cantidad) || 1);
  if(!color){
    const cols = coloresProducto(p).filter(c=>c.piezas>0);
    color = cols.length ? cols[0].color : p.color;
  }
  const maximo = maxAgregable(p, color);
  if(n > maximo){
    toast(maximo ? `Solo puedes agregar ${maximo} más de ${p.nombre} en ${color}` : `${p.nombre} en ${color} está agotado por ahora`);
    return false;
  }
  const existente = state.carrito.find(l=>l.tipo==='producto' && l.ref===id && mismoTexto(l.color, color));
  if(existente){ existente.cantidad += n; }
  else { state.carrito.push({ tipo:'producto', ref:id, nombre:p.nombre + (color ? ` · ${color}` : ''), precio:p.precio, cantidad:n, color }); }
  renderCarrito();
  renderCatalogo();
  toast(`${n} × ${p.nombre}${color ? ' (' + color + ')' : ''} agregado al carrito`);
  return true;
}

function guardarCarrito(){
  const id = state.perfil && state.perfil.id_user;
  if(!id || state.carritoDe !== id) return;            
  try{
    localStorage.setItem('carrito_' + id, JSON.stringify(state.carrito.map(l => ({ tipo: l.tipo, ref: l.ref, cantidad: l.cantidad, color: l.color || null }))));
  }catch(e){}
}

function restaurarCarrito(){
  const id = state.perfil && state.perfil.id_user;
  if(!id || state.carritoDe === id) return;
  state.carritoDe = id;
  let guardado = [];
  try{ guardado = JSON.parse(localStorage.getItem('carrito_' + id) || '[]'); }catch(e){}
  if(!Array.isArray(guardado)) guardado = [];
  const lineas = []; let descartados = 0;
  guardado.forEach(g => {
    if(g && g.tipo === 'producto'){
      const p = state.productos.find(x => x.id === g.ref);
      if(!p){ descartados++; return; }
      const color = g.color || p.color;
      state.carrito = lineas;   // para que maxAgregable cuente lo ya restaurado
      const cant = Math.min(Math.max(1, parseInt(g.cantidad) || 1), maxAgregable(p, color));
      if(cant < 1){ descartados++; return; }
      lineas.push({ tipo:'producto', ref:p.id, nombre:p.nombre + (color ? ` · ${color}` : ''), precio:p.precio, cantidad:cant, color });
    } else if(g && g.tipo === 'archivo'){
      const a = state.archivos.find(x => x.id === g.ref);
      if(!a || a.estado !== 'aprobada'){ descartados++; return; }
      lineas.push({ tipo:'archivo', ref:a.id, nombre:a.nombre + ' (' + a.material + ')', precio:a.precio, cantidad:1 });
    }
  });
  state.carrito = lineas;
  if(descartados) toast('Actualizamos tu carrito: algunos artículos ya no están disponibles');
}

function renderEntregaCarrito(){
  const box = document.getElementById('cartEntrega');
  const datos = document.getElementById('cartEntregaDatos');
  if(!box || !datos) return;
  box.hidden = !state.carrito.length;
  if(!state.carrito.length || !state.perfil) return;
  const x = leerExtraPerfil();
  const falta = [];
  if(errDireccion(x.direccion)) falta.push('dirección de entrega');
  if(errCiudad(x.ciudad_envio)) falta.push('ciudad de entrega');
  if(errTelGT(state.perfil.telefono)) falta.push('teléfono');
  if(falta.length){
    datos.innerHTML = `<p class="entrega-falta">Para confirmar tu pedido falta: <b>${esc(falta.join(', '))}</b>.</p>`;
    return;
  }
  const extras = [];
  if(x.residencial) extras.push(`<div class="entrega-dato"><b>${esc(x.residencial)}</b><span>Residencial, condominio o edificio</span></div>`);
  if(x.codigo_acceso) extras.push(`<div class="entrega-dato"><b>${esc(x.codigo_acceso)}</b><span>Código de acceso / indicaciones</span></div>`);
  datos.innerHTML = `<div class="entrega-dato"><b>${esc(x.direccion)}</b><span>${esc(x.ciudad_envio)}${x.codigo_postal ? ' · CP ' + esc(x.codigo_postal) : ''}</span></div>`
    + extras.join('')
    + `<div class="entrega-dato"><b>${esc(state.perfil.telefono)}</b><span>Teléfono de contacto</span></div>`;
}

function renderCarrito(){
  guardarCarrito();
  renderEntregaCarrito();
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

let confirmandoPedido = false;
async function confirmarPedido(){
  if(confirmandoPedido) return;                          
  confirmandoPedido = true;
  const btn = document.getElementById('btnConfirmar');
  if(btn){ btn.disabled = true; btn.textContent = 'Enviando...'; }
  try{ await _confirmarPedido(); }
  catch(err){ console.error('Error al confirmar el pedido:', err); toast('No se pudo confirmar el pedido. Intenta de nuevo.'); }
  finally{
    confirmandoPedido = false;
    if(btn){ btn.disabled = false; btn.textContent = 'Confirmar pedido'; }
  }
}

async function _confirmarPedido(){
  if(!state.carrito.length){ toast('Tu carrito está vacío'); return; }
  if(!state.perfil){ toast('No se encontró tu perfil de cliente'); return; }
  if(!exigirPerfil(true)) return;           

  await cargarBase();
  // Gramos que pide el carrito por cada filamento (varios productos pueden usar el mismo)
  const pedidoPorFil = new Map();
  for(const l of state.carrito){
    if(l.tipo === 'producto'){
      const p = state.productos.find(x=>x.id===l.ref);
      const f = p ? filamentoPara(state.filamentosTodos, p.material, l.color || p.color) : null;
      if(p && !f && !state.filamentosVisibles){
        if(p.existenciaGuardada < l.cantidad){ toast(`"${l.nombre}" ya no tiene suficientes piezas disponibles`); renderCatalogo(); return; }
        continue;
      }
      if(!p || !f || !(p.peso > 0)){ toast(`"${l.nombre}" ya no está disponible`); renderCatalogo(); return; }
      pedidoPorFil.set(f, (pedidoPorFil.get(f)||0) + p.peso * l.cantidad);
    }
  }
  for(const [f, g] of pedidoPorFil){
    if(g > f.gramos){ toast(`No alcanza el filamento ${f.nombre} para todo tu carrito. Baja algunas cantidades.`); renderCatalogo(); return; }
  }

  const idUser = state.perfil.id_user || state.perfil.id;
  const total = state.carrito.reduce((a,l)=>a+l.precio*l.cantidad,0);
  const x = leerExtraPerfil();
  const basico = { direccion_envio: x.direccion, ciudad_envio: x.ciudad_envio, telefono_contacto: state.perfil.telefono };
  const conCP = Object.assign({}, basico, { codigo_postal: x.codigo_postal || null });
  const completo = Object.assign({}, conCP, { residencial: x.residencial || null, codigo_acceso: x.codigo_acceso || null });
  const base = { total, estado:'pendiente', id_usuario: idUser };

  const intentos = [Object.assign({}, base, completo), Object.assign({}, base, conCP), Object.assign({}, base, basico), base];
  let cab;
  for(let i = 0; i < intentos.length; i++){
    cab = await supabase.from('carritos').insert(intentos[i]).select().single();
    if(!(cab.error && (cab.error.code === 'PGRST204' || /column/i.test(cab.error.message || '')))) break;
    console.warn("Faltan columnas de entrega en 'carritos'. Ejecuta el SQL para que el negocio vea todos los datos.");
  }
  if(!okDB(cab, 'No se pudo crear el pedido')) return;

  const items = state.carrito.map(l => ({
    id_carrito: cab.data.id_carrito,
    id_archivo: l.tipo==='archivo' ? l.ref : null,
    id_producto: l.tipo==='producto' ? l.ref : null,
    nombre: l.nombre, precio: l.precio, cantidad: l.cantidad,
    color: l.tipo==='producto' ? (l.color || null) : null
  }));
  // Al guardar los artículos, Supabase descuenta el filamento de los productos (todo o nada)
  let det = await supabase.from('carrito_items').insert(items);
  if(det.error && /color/i.test(det.error.message || '')){
    // La tabla aún no tiene la columna "color": se guarda sin ella
    det = await supabase.from('carrito_items').insert(items.map(({color, ...resto}) => resto));
  }
  if(det.error){
    console.error(det.error);
    await supabase.from('carritos').delete().eq('id_carrito', cab.data.id_carrito);   // no dejar un pedido vacío
    const sinFil = /filamento/i.test(det.error.message || '');
    toast(sinFil ? 'No se pudo confirmar: ' + det.error.message + '. Baja algunas cantidades.' : 'No se pudieron guardar los productos del pedido: ' + det.error.message);
    await cargarBase(); renderCatalogo();
    return;
  }

  state.carrito = [];
  await cargarBase();        // las piezas disponibles ya bajaron
  await cargarCliente();
  refrescarCliente();
  if(typeof renderCatalogo === 'function') renderCatalogo();
  toast('Pedido confirmado y enviado al negocio');
  irAVista('v-pedidos');
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

/* ---- Fotos de productos (bucket "productos" de Supabase Storage) ---- */
const PRODUCTO_PX = 900;   // lado mayor de la foto guardada

function procesarFotoProducto(file){
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const w = img.naturalWidth, h = img.naturalHeight;
      if(!w || !h) return reject(new Error('La imagen está vacía'));
      const k = Math.min(1, PRODUCTO_PX / Math.max(w, h));
      const c = document.createElement('canvas');
      c.width = Math.round(w*k); c.height = Math.round(h*k);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      c.toBlob(b => b ? resolve(b) : reject(new Error('No se pudo procesar la imagen')), 'image/jpeg', 0.85);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo leer la imagen')); };
    img.src = url;
  });
}

function validarFotoProducto(file){
  if(!file) return 'Elige una foto';
  if(['image/jpeg','image/png','image/webp'].indexOf(file.type) === -1) return 'Usa una foto JPG, PNG o WebP';
  if(file.size > MAX_FOTO_MB * 1024 * 1024) return `La foto pesa más de ${MAX_FOTO_MB} MB`;
  return '';
}

async function subirFotoProducto(file){
  const blob = await procesarFotoProducto(file);
  const ruta = `producto-${Date.now()}-${Math.random().toString(36).slice(2,8)}.jpg`;
  const { error } = await supabase.storage.from(BUCKET_PRODUCTOS).upload(ruta, blob, { contentType:'image/jpeg', cacheControl:'31536000', upsert:false });
  if(error) throw error;
  return { ruta, url: supabase.storage.from(BUCKET_PRODUCTOS).getPublicUrl(ruta).data.publicUrl };
}

// De la URL pública saca la ruta dentro del bucket (para poder borrar la foto vieja)
function rutaFotoProducto(url){
  const m = String(url||'').match(/\/object\/public\/productos\/([^?]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}
async function borrarFotoProducto(url){
  const ruta = rutaFotoProducto(url);
  if(ruta) { try { await supabase.storage.from(BUCKET_PRODUCTOS).remove([ruta]); } catch(e) { console.warn('No se pudo borrar la foto', e); } }
}

// Vista previa en el formulario de alta
// Fotos elegidas en el formulario de alta (todavía no subidas)
const MAX_FOTOS_PRODUCTO = 8;
let fotosNuevas = [];   // [{ file, url }]

function alElegirFotoNueva(e){
  const files = Array.from(e.target.files || []);
  e.target.value = '';
  for(const file of files){
    if(fotosNuevas.length >= MAX_FOTOS_PRODUCTO){ toast(`Máximo ${MAX_FOTOS_PRODUCTO} fotos por producto`); break; }
    const err = validarFotoProducto(file);
    if(err){ toast(`${file.name}: ${err}`); continue; }
    fotosNuevas.push({ file, url: URL.createObjectURL(file) });
  }
  pintarFotosNuevas();
}
function quitarFotoNueva(ev, i){
  if(ev){ ev.preventDefault(); ev.stopPropagation(); }
  if(i === undefined){ fotosNuevas.forEach(f=>URL.revokeObjectURL(f.url)); fotosNuevas = []; }
  else { const [f] = fotosNuevas.splice(i,1); if(f) URL.revokeObjectURL(f.url); }
  pintarFotosNuevas();
}
function pintarFotosNuevas(){
  const g = document.getElementById('np-fotos');
  const box = document.getElementById('np-foto-box');
  if(box) box.classList.toggle('con-foto', fotosNuevas.length > 0);
  if(!g) return;
  g.innerHTML = fotosNuevas.map((f,i)=>`
    <div class="foto-mini">
      <img src="${f.url}" alt="Foto ${i+1}">
      ${i===0 ? '<span class="foto-principal">Principal</span>' : ''}
      <button type="button" class="foto-x" onclick="quitarFotoNueva(event, ${i})" aria-label="Quitar foto ${i+1}">×</button>
    </div>`).join('');
}

async function formAgregarProducto(){
  const nombre = val('np-nombre'), desc = val('np-desc');
  const precio = parseFloat(val('np-precio')), peso = parseFloat(val('np-peso'));
  const fil = state.filamentosTodos.find(f => String(f.id) === val('np-filamento'));
  if(!nombre || isNaN(precio) || precio < 0){ toast('Completa el nombre y el precio'); return; }
  if(!fil){ toast('Elige el filamento con el que se imprime'); return; }
  if(isNaN(peso) || peso <= 0){ toast('Escribe cuántos gramos pesa una pieza'); return; }
  const btn = document.getElementById('btnAgregarProducto');
  if(btn) btn.disabled = true;
  const subidas = [];
  try {
    for(let i=0;i<fotosNuevas.length;i++){
      toast(`Subiendo foto ${i+1} de ${fotosNuevas.length}...`);
      subidas.push((await subirFotoProducto(fotosNuevas[i].file)).url);
    }
    const fila = { nombre, descripcion: desc || null, precio, peso_gramos: peso, material: fil.material, color: fil.color,
                   existencia: Math.floor(fil.gramos / peso) };   // referencia; lo real se calcula con el filamento
    if(subidas.length){ fila.imagen_url = subidas[0]; fila.imagenes = subidas; }
    let res = await supabase.from('productos').insert(fila);
    if(res.error && /imagenes/i.test(res.error.message || '')){
      // La tabla aún no tiene la columna "imagenes": se guarda solo la principal
      delete fila.imagenes;
      res = await supabase.from('productos').insert(fila);
      if(!res.error && subidas.length > 1) toast('Se guardó solo la primera foto: falta la columna "imagenes" (corre el SQL)');
    }
    if(!okDB(res, 'No se pudo agregar el producto')){
      for(const u of subidas) await borrarFotoProducto(u);   // no dejar fotos huérfanas
      return;
    }
    limpiar('np-nombre','np-desc','np-precio','np-peso');
    actualizarAlcanceProducto();
    quitarFotoNueva();
    await cargarBase(); renderProductosNegocio();
    toast('Producto publicado en el catálogo');
  } catch(err) {
    console.error('Error con las fotos del producto:', err);
    for(const u of subidas) await borrarFotoProducto(u);
    toast('No se pudo subir la foto: ' + (err.message || err));
  } finally {
    if(btn) btn.disabled = false;
  }
}

// Opciones de filamento para los productos
function opcionesFilamento(selMaterial, selColor){
  if(!state.filamentosTodos.length) return '<option value="">Primero registra filamentos</option>';
  let html = '';
  if(!selMaterial) html += '<option value="">Elige filamento…</option>';
  html += state.filamentosTodos.map(f => {
    const sel = selMaterial && mismoTexto(f.material, selMaterial) && mismoTexto(f.color, selColor);
    return `<option value="${f.id}" ${sel?'selected':''}>${esc(f.nombre)} · ${gramosTxt(f.gramos)}</option>`;
  }).join('');
  return html;
}
function actualizarAlcanceProducto(){
  const out = document.getElementById('np-alcance');
  if(!out) return;
  const f = state.filamentosTodos.find(x => String(x.id) === val('np-filamento'));
  const peso = parseFloat(val('np-peso'));
  if(!f || !(peso > 0)){ out.textContent = 'Elige el filamento y el peso para ver cuántas piezas alcanzan.'; out.className = 'alcance'; return; }
  const n = Math.floor(f.gramos / peso);
  out.textContent = n > 0 ? `Con ${gramosTxt(f.gramos)} de ${f.nombre} alcanza para ${n} pieza(s).` : `No alcanza: ${f.nombre} solo tiene ${gramosTxt(f.gramos)}.`;
  out.className = 'alcance ' + (n > 0 ? 'alcance-ok' : 'alcance-no');
}
async function cambiarFilamentoProducto(id, idFil){
  const f = state.filamentosTodos.find(x => String(x.id) === String(idFil));
  if(!f){ renderProductosNegocio(); return; }
  const res = await supabase.from('productos').update({ material: f.material, color: f.color }).eq('id_producto', id);
  if(!okDB(res, 'No se pudo cambiar el filamento')) return;
  await cargarBase(); renderProductosNegocio();
  toast('Filamento del producto actualizado');
}
async function cambiarPesoProducto(id, valor){
  const g = parseFloat(valor);
  if(isNaN(g) || g <= 0){ toast('El peso debe ser mayor a 0 gramos'); renderProductosNegocio(); return; }
  const res = await supabase.from('productos').update({ peso_gramos: g }).eq('id_producto', id);
  if(!okDB(res, 'No se pudo cambiar el peso')) return;
  await cargarBase(); renderProductosNegocio();
  toast('Peso actualizado');
}

// ---- Fotos de un producto que ya existe (ventana "Fotos del producto") ----
let productoFotoId = null;
function elegirFotoProducto(id){   // se abre el gestor de fotos
  productoFotoId = id;
  const back = document.getElementById('fotos-modal');
  if(!back) return;
  back.hidden = false;
  document.body.classList.add('sin-scroll');
  pintarGestorFotos();
}
function cerrarGestorFotos(){
  const back = document.getElementById('fotos-modal');
  if(back) back.hidden = true;
  document.body.classList.remove('sin-scroll');
  productoFotoId = null;
}
function pintarGestorFotos(){
  const p = state.productos.find(x=>x.id===productoFotoId);
  if(!p) return cerrarGestorFotos();
  document.getElementById('fm-titulo').textContent = 'Fotos de ' + p.nombre;
  const g = document.getElementById('fm-grid');
  g.innerHTML = p.imagenes.length ? p.imagenes.map((u,i)=>`
    <div class="foto-mini grande">
      <img src="${esc(u)}" alt="Foto ${i+1} de ${esc(p.nombre)}">
      ${i===0 ? '<span class="foto-principal">Principal</span>' : `<button type="button" class="btn btn-sm foto-hacer" onclick="hacerPrincipal(${i})">Hacer principal</button>`}
      <button type="button" class="foto-x" onclick="quitarFotoExistente(${i})" aria-label="Quitar foto ${i+1}">×</button>
    </div>`).join('') : '<div class="empty" style="grid-column:1/-1;">Este producto aún no tiene fotos.</div>';
  const n = document.getElementById('fm-n');
  if(n) n.textContent = `${p.imagenes.length} de ${MAX_FOTOS_PRODUCTO} fotos · la primera es la que sale en el catálogo`;
}
async function guardarFotosProducto(p, lista){
  const fila = { imagenes: lista, imagen_url: lista[0] || null };
  let res = await supabase.from('productos').update(fila).eq('id_producto', p.id);
  if(res.error && /imagenes/i.test(res.error.message || '')){
    toast('Falta la columna "imagenes" en productos. Corre el SQL 04_productos.sql.');
    return false;
  }
  return okDB(res, 'No se pudieron guardar las fotos');
}
async function alCambiarFotoProducto(e){
  const files = Array.from(e.target.files || []);
  e.target.value = '';
  const p = state.productos.find(x=>x.id===productoFotoId);
  if(!p || !files.length) return;
  const libres = MAX_FOTOS_PRODUCTO - p.imagenes.length;
  if(libres <= 0){ toast(`Máximo ${MAX_FOTOS_PRODUCTO} fotos por producto`); return; }
  const nuevas = [];
  try {
    for(const file of files.slice(0, libres)){
      const err = validarFotoProducto(file);
      if(err){ toast(`${file.name}: ${err}`); continue; }
      toast(`Subiendo foto ${nuevas.length+1}...`);
      nuevas.push((await subirFotoProducto(file)).url);
    }
    if(!nuevas.length) return;
    if(!(await guardarFotosProducto(p, p.imagenes.concat(nuevas)))){ for(const u of nuevas) await borrarFotoProducto(u); return; }
    await cargarBase(); renderProductosNegocio(); pintarGestorFotos();
    toast(nuevas.length === 1 ? 'Foto agregada' : `${nuevas.length} fotos agregadas`);
  } catch(err) {
    console.error('Error al subir fotos:', err);
    for(const u of nuevas) await borrarFotoProducto(u);
    toast('No se pudo subir la foto: ' + (err.message || err));
  }
}
async function quitarFotoExistente(i){
  const p = state.productos.find(x=>x.id===productoFotoId);
  if(!p) return;
  const url = p.imagenes[i];
  const lista = p.imagenes.filter((_,k)=>k!==i);
  if(!(await guardarFotosProducto(p, lista))) return;
  await borrarFotoProducto(url);
  await cargarBase(); renderProductosNegocio(); pintarGestorFotos();
  toast('Foto quitada');
}
async function hacerPrincipal(i){
  const p = state.productos.find(x=>x.id===productoFotoId);
  if(!p) return;
  const lista = [p.imagenes[i]].concat(p.imagenes.filter((_,k)=>k!==i));
  if(!(await guardarFotosProducto(p, lista))) return;
  await cargarBase(); renderProductosNegocio(); pintarGestorFotos();
  toast('Foto principal actualizada');
}

async function quitarProducto(id){
  if(!confirm('¿Quitar este producto del catálogo?')) return;
  const prod = state.productos.find(x=>x.id===id);
  const res = await supabase.from('productos').delete().eq('id_producto', id);
  if(res.error){
    toast('No se puede borrar: ya aparece en pedidos.');
    return;
  }
  if(prod){ for(const u of (prod.imagenes.length ? prod.imagenes : [prod.imagen])) await borrarFotoProducto(u); }
  await cargarBase(); renderProductosNegocio();
  toast('Producto eliminado');
}

let sincronizando = false;
async function sincronizarExistencias(){
  if(sincronizando || !state.filamentosVisibles) return;
  sincronizando = true;
  try {
    for(const p of state.productos){
      if(!filamentoDeProducto(p) || !(p.peso > 0)) continue;
      const n = piezasPosibles(p);
      if(n !== p.existenciaGuardada){
        const r = await supabase.from('productos').update({ existencia: n }).eq('id_producto', p.id);
        if(!r.error) p.existenciaGuardada = n; else console.warn('No se pudo sincronizar existencias de', p.nombre, r.error);
      }
    }
  } finally { sincronizando = false; }
}

function renderProductosNegocio(){
  sincronizarExistencias();
  const tb = document.querySelector('#tblProductosNegocio tbody');
  if(!tb) return;
  const sf = document.getElementById('np-filamento');
  if(sf){ const prev = sf.value; sf.innerHTML = opcionesFilamento(); if(prev) sf.value = prev; }
  actualizarAlcanceProducto();
  if(!state.productos.length){ tb.innerHTML = `<tr><td colspan="7" class="empty">Aún no has agregado productos.</td></tr>`; return; }
  tb.innerHTML = state.productos.map(p => `
    <tr><td><div class="prod-celda">
      <button type="button" class="prod-thumb" onclick="elegirFotoProducto(${p.id})" title="Fotos del producto" aria-label="Fotos de ${esc(p.nombre)}">
        ${p.imagen ? `<img src="${esc(p.imagen)}" alt="" loading="lazy">` : '<svg class="ico" aria-hidden="true"><use href="#i-camera"/></svg>'}
        ${p.imagenes.length > 1 ? `<span class="thumb-n">${p.imagenes.length}</span>` : ''}
      </button><span class="strong">${esc(p.nombre)}</span></div></td><td>${esc(p.desc)}</td>
    <td><input type="number" min="0" step="0.01" value="${p.precio}" style="width:90px" onchange="cambiarPrecioProducto(${p.id}, this.value)"></td>
    <td><select onchange="cambiarFilamentoProducto(${p.id}, this.value)" aria-label="Filamento de ${esc(p.nombre)}">${opcionesFilamento(p.material, p.color)}</select></td>
    <td><span class="input-gramos"><input type="number" min="0.1" step="0.1" value="${p.peso || ''}" placeholder="—" onchange="cambiarPesoProducto(${p.id}, this.value)" aria-label="Peso de ${esc(p.nombre)}"> g</span></td>
    <td>${!filamentoDeProducto(p) || !(p.peso > 0)
        ? '<span class="stock-tag stock-no">Asigna filamento y peso</span>'
        : `<span class="stock-tag ${p.existencias > 0 ? 'stock-ok' : 'stock-no'}">${p.existencias > 0 ? p.existencias + ' piezas' : 'Agotado'}</span>`}</td>
    <td><button class="btn btn-sm" onclick="quitarProducto(${p.id})">Quitar</button></td></tr>
  `).join('');
}

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
  rellenarFormFilamento();
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

async function formAgregarFilamento(){
  const material = val('nf-material'), color = val('nf-color');
  const gramos = parseFloat(val('nf-gramos')), costo = parseFloat(val('nf-costo'));
  if(!material || !color){ toast('Elige el material y el color del filamento'); return; }
  if(isNaN(gramos) || gramos <= 0){ toast('Escribe cuántos gramos tiene el carrete'); return; }
  const tipo = `${material} · ${color}`;
  const existente = filamentoPara(state.filamentos, material, color);
  let res;
  if(existente){
    // Mismo material y color: se suman los gramos al registro que ya existe
    res = await supabase.from('filamentos').update({ cantidad: Math.round(existente.restante + gramos) }).eq('id_filamento', existente.id);
  } else {
    res = await supabase.from('filamentos').insert({ tipo, cantidad: Math.round(gramos), precio_costo: isNaN(costo) ? null : costo });
  }
  if(!okDB(res, 'No se pudo registrar el filamento')) return;
  limpiar('nf-gramos','nf-costo');
  await cargarBase(); await cargarNegocio(); renderFilamentosNegocio(); drawFilamentos(); renderProductosNegocio(); renderArchivosNegocio();
  toast(existente ? `Se sumaron ${gramosTxt(gramos)} a ${tipo}` : 'Filamento registrado');
}

async function cambiarRestante(id, valor){
  const g = parseFloat(valor);
  if(isNaN(g) || g < 0){ toast('Escribe una cantidad de gramos válida'); renderFilamentosNegocio(); return; }
  const res = await supabase.from('filamentos').update({ cantidad: Math.round(g) }).eq('id_filamento', id);
  if(!okDB(res, 'No se pudo actualizar')) return;
  await cargarBase(); await cargarNegocio(); renderFilamentosNegocio(); drawFilamentos(); renderProductosNegocio(); renderArchivosNegocio();
}

async function quitarFilamento(id){
  const res = await supabase.from('filamentos').delete().eq('id_filamento', id);
  if(!okDB(res, 'No se pudo quitar')) return;
  await cargarBase(); await cargarNegocio(); renderFilamentosNegocio(); drawFilamentos(); renderProductosNegocio();
}

function rellenarFormFilamento(){
  const m = document.getElementById('nf-material'), c = document.getElementById('nf-color');
  if(m){ const prev = m.value; m.innerHTML = state.materiales.length ? state.materiales.map(x=>`<option value="${esc(x.nombre)}">${esc(x.nombre)}</option>`).join('') : '<option value="">Agrega materiales primero</option>'; if(prev) m.value = prev; }
  if(c){ const prev = c.value; c.innerHTML = state.colores.length ? state.colores.map(x=>`<option value="${esc(x.nombre)}">${esc(x.nombre)}</option>`).join('') : '<option value="">Agrega colores primero</option>'; if(prev) c.value = prev; }
}

function renderFilamentosNegocio(){
  rellenarFormFilamento();
  const tb = document.querySelector('#tblFilamentos tbody');
  if(!tb) return;
  if(!state.filamentos.length){ tb.innerHTML = `<tr><td colspan="4" class="empty">Aún no has registrado filamentos.</td></tr>`; return; }
  tb.innerHTML = state.filamentos.map(f => `
    <tr><td class="strong">${esc(f.nombre)}${partesFilamento(f.nombre).material ? '' : '<br><span class="small-note" style="color:var(--danger);">Sin material: vuelve a registrarlo como Material · Color</span>'}</td>
    <td><span class="input-gramos"><input type="number" min="0" step="1" value="${f.restante}" onchange="cambiarRestante(${f.id}, this.value)" aria-label="Gramos de ${esc(f.nombre)}"> g</span></td>
    <td>${f.costo ? Q(f.costo) : '—'}</td>
    <td><button class="btn btn-sm" onclick="quitarFilamento(${f.id})">Quitar</button></td></tr>
  `).join('');
}

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

async function revisarArchivo(id, estado){
  let datosActualizar = { estado: estado };
  
  if (estado === 'rechazada') {
    const motivo = prompt('Escribe el motivo del rechazo para el cliente:');
    if (motivo === null) return; 
    datosActualizar.motivo_rechazo = motivo.trim() || 'No cumple con los requisitos de impresión.';
  } else {
    datosActualizar.motivo_rechazo = null; 
  }

  // Antes de aprobar: ¿hay filamento de ese material y color, y alcanza?
  let fil = null, gramos = 0;
  if (estado === 'aprobada') {
    await cargarNegocio();   // datos frescos, por si otro trabajador acaba de usar filamento
    const a = state.archivosNegocio.find(x=>x.id===id);
    if(!a){ toast('No se encontró el archivo'); return; }
    gramos = Math.ceil(a.peso);
    fil = filamentoPara(state.filamentos, a.material, a.color);
    if(!fil){
      toast(`No tienes filamento ${a.material} · ${a.color} registrado. Agrégalo en Filamentos.`);
      renderArchivosNegocio(); return;
    }
    if(fil.restante < gramos){
      toast(`No alcanza el filamento ${fil.nombre}: necesitas ${gramosTxt(gramos)} y quedan ${gramosTxt(fil.restante)}.`);
      renderArchivosNegocio(); return;
    }
  }

  const res = await supabase.from('archivos').update(datosActualizar).eq('id_archivo', id);
  if(!okDB(res, 'No se pudo actualizar')) return;

  if (fil) {
    const desc = await supabase.from('filamentos').update({ cantidad: Math.max(0, Math.round(fil.restante - gramos)) }).eq('id_filamento', fil.id);
    if(desc.error){ console.error(desc.error); toast('Archivo aprobado, pero no se pudo descontar el filamento. Revísalo en Filamentos.'); }
  }

  await cargarBase(); await cargarNegocio();
  renderArchivosNegocio(); renderFilamentosNegocio(); drawFilamentos(); renderProductosNegocio();
  toast(estado === 'aprobada' ? `Archivo aprobado · se descontaron ${gramosTxt(gramos)} de ${fil.nombre}` : 'Archivo rechazado');
}

function stockArchivo(a){
  const f = filamentoPara(state.filamentos, a.material, a.color);
  if(!f) return '<br><span class="stock-tag stock-no">Sin filamento</span>';
  const ok = f.restante >= Math.ceil(a.peso);
  return `<br><span class="stock-tag ${ok?'stock-ok':'stock-no'}">${ok?'Hay':'Faltan'} · quedan ${gramosTxt(f.restante)}</span>`;
}

function renderArchivosNegocio(){
  const tb = document.querySelector('#tblArchivosNegocio tbody');
  if(!tb) return;
  if(!state.archivosNegocio.length){ tb.innerHTML = `<tr><td colspan="7" class="empty">Aún no hay archivos de clientes.</td></tr>`; return; }
  tb.innerHTML = state.archivosNegocio.map(a => `
    <tr><td>${esc(a.cliente)}</td><td class="strong">${esc(a.nombre)}</td><td>${esc(a.material)} · ${esc(a.color)}${a.estado==='pendiente' ? stockArchivo(a) : ''}</td>
    <td>${a.peso.toFixed(1)} g · ${a.tiempo.toFixed(1)} h</td><td class="strong">${Q(a.precio)}</td><td>${badgeEstadoArchivo(a.estado)}</td>
    <td>${a.estado==='pendiente'
      ? `<button class="btn btn-sm btn-primary" onclick="revisarArchivo(${a.id}, 'aprobada')">Aprobar</button> <button class="btn btn-sm" onclick="revisarArchivo(${a.id}, 'rechazada')">Rechazar</button>`
      : `<span class="small-note">—</span>`}
      ${a.tieneArchivo ? `<button class="btn btn-sm" onclick="descargarSTL(${a.id})">Descargar STL</button>` : ''}</td></tr>
  `).join('');
}

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

// El filamento de los productos se descuenta al CONFIRMAR el carrito y se devuelve si se CANCELA.
// Eso lo hace Supabase con triggers (ver SQL), así funciona aunque el cliente no tenga permiso sobre filamentos.
async function cambiarEstadoCarrito(id, estado){
  const c = state.carritosNegocio.find(x=>x.id===id);
  if(!c || c.estado === estado) return;
  const anterior = c.estado;
  const res = await supabase.from('carritos').update({ estado }).eq('id_carrito', id);
  if(res.error){
    console.error(res.error);
    toast('No se pudo cambiar el estado: ' + res.error.message);   // p. ej. "No alcanza el filamento PLA · Negro..."
    renderPedidosNegocioTable();
    return;
  }
  await cargarBase(); await cargarNegocio();
  refrescarNegocio();
  let extra = '';
  if(estado === 'cancelado') extra = ' · el filamento de sus productos regresó al inventario';
  else if(anterior === 'cancelado') extra = ' · se volvió a apartar el filamento';
  toast((FINALIZADOS.includes(estado) ? `${c.label} pasó a «Finalizados»` : 'Estado actualizado') + extra);
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

/* ---- Gráfica de ventas: diario / semanal / mensual / anual + valor al pasar el cursor ---- */
let periodoVentas = 'mensual';
let lineaActual = null;
const PERIODOS_VENTAS = {
  diario:  { n:14, sub:'Últimos 14 días · Quetzales' },
  semanal: { n:8,  sub:'Últimas 8 semanas · Quetzales' },
  mensual: { n:6,  sub:'Últimos 6 meses · Quetzales' },
  anual:   { n:5,  sub:'Últimos 5 años · Quetzales' },
};

function calcularVentas(periodo){
  const ahora = new Date(), n = PERIODOS_VENTAS[periodo].n, slots = [];
  for(let i=n-1;i>=0;i--){
    let ini, fin, mes, largo;
    if(periodo==='diario'){
      ini = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate()-i);
      fin = new Date(ini.getFullYear(), ini.getMonth(), ini.getDate()+1);
      mes = ini.getDate() + '/' + (ini.getMonth()+1);
      largo = ini.getDate() + ' ' + MESES[ini.getMonth()] + ' ' + ini.getFullYear();
    } else if(periodo==='semanal'){
      const lunes = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate() - ((ahora.getDay()+6)%7));
      ini = new Date(lunes.getFullYear(), lunes.getMonth(), lunes.getDate() - 7*i);
      fin = new Date(ini.getFullYear(), ini.getMonth(), ini.getDate()+7);
      mes = ini.getDate() + '/' + (ini.getMonth()+1);
      largo = 'Semana del ' + ini.getDate() + ' ' + MESES[ini.getMonth()] + ' ' + ini.getFullYear();
    } else if(periodo==='anual'){
      ini = new Date(ahora.getFullYear()-i, 0, 1);
      fin = new Date(ahora.getFullYear()-i+1, 0, 1);
      mes = String(ini.getFullYear());
      largo = 'Año ' + ini.getFullYear();
    } else {
      ini = new Date(ahora.getFullYear(), ahora.getMonth()-i, 1);
      fin = new Date(ahora.getFullYear(), ahora.getMonth()-i+1, 1);
      mes = MESES[ini.getMonth()];
      largo = MESES[ini.getMonth()] + ' ' + ini.getFullYear();
    }
    slots.push({ ini:ini.getTime(), fin:fin.getTime(), mes, largo, valor:0 });
  }
  state.carritosNegocio.filter(c=>c.estado==='entregado').forEach(c=>{
    const slot = slots.find(x=>c.ts>=x.ini && c.ts<x.fin);
    if(slot) slot.valor += c.total;
  });
  return slots;
}

function cambiarPeriodoVentas(periodo){
  if(!PERIODOS_VENTAS[periodo]) return;
  periodoVentas = periodo;
  document.querySelectorAll('.seg-btn[data-periodo]').forEach(b=>{
    const on = b.dataset.periodo === periodo;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  drawLine();
}

function drawLine(){
  const svg = document.getElementById('lineChart');
  if(!svg) return;
  const sub = document.getElementById('ventasSub');
  if(sub) sub.textContent = PERIODOS_VENTAS[periodoVentas].sub;
  ocultarTipVentas();
  const data = calcularVentas(periodoVentas);
  if(!data.some(v=>v.valor>0)){
    lineaActual = null;
    svg.innerHTML = `<text x="280" y="105" text-anchor="middle" class="axis-label">Aún no hay ventas en este periodo</text>`;
    return;
  }
  const W=560, H=200, padL=40, padR=14, padT=12, padB=26;
  const max = Math.max(...data.map(v=>v.valor)) * 1.15;
  const stepX = (W-padL-padR)/(data.length-1);
  const yFor = v => padT + (1 - v/max)*(H-padT-padB);
  const xFor = i => padL + i*stepX;
  const cadaCuanto = data.length > 8 ? 2 : 1;
  let html = '';
  for(let i=0;i<=3;i++){
    const v = max/3*i, y = yFor(v);
    html += `<line x1="${padL}" y1="${y}" x2="${W-padR}" y2="${y}" class="grid-line"/>`;
    html += `<text x="4" y="${y+4}" class="axis-label">Q${Math.round(v)}</text>`;
  }
  data.forEach((v,i)=>{
    if((data.length-1-i) % cadaCuanto === 0) html += `<text x="${xFor(i)}" y="${H-6}" class="axis-label" text-anchor="middle">${v.mes}</text>`;
  });
  const linePts = data.map((v,i)=>`${xFor(i)},${yFor(v.valor)}`).join(' ');
  const areaPts = `${padL},${yFor(0)} ${linePts} ${xFor(data.length-1)},${yFor(0)}`;
  html += `<defs><linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#2BD96B" stop-opacity="0.45"/><stop offset="100%" stop-color="#2BD96B" stop-opacity="0"/></linearGradient></defs>
    <polygon points="${areaPts}" fill="url(#areaGrad)"/>
    <polyline points="${linePts}" fill="none" style="stroke:var(--text)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;
  data.forEach((v,i)=>{ html += `<circle cx="${xFor(i)}" cy="${yFor(v.valor)}" r="4.5" fill="#2BD96B" style="stroke:var(--text)" stroke-width="2"/>`; });
  html += `<g id="lineHover" style="display:none; pointer-events:none;">
      <line id="lineHoverBar" x1="0" y1="${padT}" x2="0" y2="${yFor(0)}" style="stroke:var(--text)" stroke-width="1.5" stroke-dasharray="4 4"/>
      <circle id="lineHoverDot" cx="0" cy="0" r="7" fill="#FFC21A" style="stroke:var(--text)" stroke-width="2.5"/>
    </g>
    <rect x="${padL-stepX/2}" y="0" width="${W-padL-padR+stepX}" height="${H}" fill="transparent" style="cursor:crosshair;"/>`;
  svg.innerHTML = html;
  lineaActual = { data, xFor, yFor, stepX, padL, W, H };
  if(!svg.dataset.hover){
    svg.dataset.hover = '1';
    svg.addEventListener('pointermove', moverTipVentas);
    svg.addEventListener('pointerdown', moverTipVentas);
    svg.addEventListener('pointerleave', ocultarTipVentas);
  }
}

function moverTipVentas(e){
  const svg = document.getElementById('lineChart');
  const tip = document.getElementById('lineTip');
  if(!lineaActual || !svg || !tip) return;
  const { data, xFor, yFor, stepX, padL, W, H } = lineaActual;
  const r = svg.getBoundingClientRect();
  const x = (e.clientX - r.left) * W / r.width;
  const i = Math.max(0, Math.min(data.length-1, Math.round((x - padL) / stepX)));
  const px = xFor(i), py = yFor(data[i].valor);
  const g = document.getElementById('lineHover');
  if(g){
    g.style.display = '';
    document.getElementById('lineHoverBar').setAttribute('x1', px);
    document.getElementById('lineHoverBar').setAttribute('x2', px);
    document.getElementById('lineHoverDot').setAttribute('cx', px);
    document.getElementById('lineHoverDot').setAttribute('cy', py);
  }
  tip.innerHTML = `<b>${Q(data[i].valor)}</b><span>${esc(data[i].largo)}</span>`;
  tip.hidden = false;
  const left = px * r.width / W, top = py * r.height / H;
  tip.style.left = left + 'px';
  tip.style.top = top + 'px';
  tip.classList.toggle('tip-izq', left > r.width - 90);
  tip.classList.toggle('tip-der', left < 90);
}

function ocultarTipVentas(){
  const tip = document.getElementById('lineTip');
  if(tip) tip.hidden = true;
  const g = document.getElementById('lineHover');
  if(g) g.style.display = 'none';
}

function drawDonut(){
  const svg = document.getElementById('donutChart');
  if(!svg) return;
  const counts = {pendiente:0, progreso:0, entregado:0, cancelado:0};
  state.carritosNegocio.forEach(c=>{ if(counts[c.estado]!==undefined) counts[c.estado]++; });
  const segs = [
    {estado:'Pendiente', valor:counts.pendiente, color:'#FFC21A'},
    {estado:'En progreso', valor:counts.progreso, color:'#2F6BFF'},
    {estado:'Entregado', valor:counts.entregado, color:'#2BD96B'},
    {estado:'Cancelado', valor:counts.cancelado, color:'#FF4F9A'},
  ];
  const total = segs.reduce((a,s)=>a+s.valor,0);
  const cx=100, cy=100, r=74, strokeW=30;
  const circumference = 2*Math.PI*r;
  const conValor = segs.filter(x=>x.valor>0).length;
  const hueco = conValor > 1 ? 3 : 0;   // pequeña separación entre segmentos
  let offsetAcc = 0;
  let html = `<circle cx="${cx}" cy="${cy}" r="${r + strokeW/2 + 2}" style="fill:none; stroke:var(--stroke)" stroke-width="2.5"/>
    <circle cx="${cx}" cy="${cy}" r="${r - strokeW/2 - 2}" style="fill:var(--bg-raised); stroke:var(--stroke)" stroke-width="2.5"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" style="stroke:var(--bg-inset)" stroke-width="${strokeW}"/>`;
  if(total > 0){
    segs.forEach(seg=>{
      if(!seg.valor) return;
      const len = (seg.valor/total)*circumference;
      const visible = Math.max(0, len - hueco);
      html += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${seg.color}" stroke-width="${strokeW}" stroke-dasharray="${visible} ${circumference-visible}" stroke-dashoffset="${-offsetAcc}" transform="rotate(-90 ${cx} ${cy})" stroke-linecap="butt"/>`;
      offsetAcc += len;
    });
  }
  html += `<text x="${cx}" y="${cy+8}" text-anchor="middle" font-family="Outfit, sans-serif" font-size="44" font-weight="800" style="fill:var(--text)">${total}</text>`;
  html += `<text x="${cx}" y="${cy+30}" text-anchor="middle" font-family="Outfit, sans-serif" font-size="13" font-weight="700" letter-spacing="1" style="fill:var(--text-dim)">CARRITOS</text>`;
  svg.innerHTML = html;
  const legend = document.getElementById('donutLegend');
  if(legend) legend.innerHTML = segs.map(s=>{
    const pct = total ? Math.round(s.valor/total*100) : 0;
    return `
    <div class="legend-item"><span class="left"><span class="legend-dot" style="background:${s.color}"></span>${s.estado}</span><span class="val">${s.valor}<small>${pct}%</small></span></div>`;
  }).join('');
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
    <div class="bar-row"><div class="top-row"><span class="name">${esc(f.nombre)}</span><span class="num">${gramosTxt(f.restante)}</span></div>
    <div class="bar-track"><div class="bar-fill ${f.restante<200?'warn':''}" style="width:${Math.min(100, f.restante/GRAMOS_CARRETE*100)}%"></div></div></div>
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

let vistaCarritos = 'curso';
const FINALIZADOS = ['entregado','cancelado'];
function cambiarVistaCarritos(vista){
  vistaCarritos = vista === 'finalizados' ? 'finalizados' : 'curso';
  renderPedidosNegocioTable();
}

function renderPedidosNegocioTable(){
  const tb = document.querySelector('#tblCarritosNegocio tbody');
  if(!tb) return;
  const enCurso = state.carritosNegocio.filter(c=>!FINALIZADOS.includes(c.estado));
  const finalizados = state.carritosNegocio.filter(c=>FINALIZADOS.includes(c.estado));
  const nC = document.getElementById('cntCurso'), nF = document.getElementById('cntFinal');
  if(nC) nC.textContent = enCurso.length;
  if(nF) nF.textContent = finalizados.length;
  document.querySelectorAll('.seg-btn[data-vista]').forEach(b=>{
    const on = b.dataset.vista === vistaCarritos;
    b.classList.toggle('active', on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  const lista = vistaCarritos === 'curso' ? enCurso : finalizados;
  if(!lista.length){
    tb.innerHTML = `<tr><td colspan="6" class="empty">${vistaCarritos==='curso' ? 'No hay pedidos en curso. Los entregados y cancelados están en «Finalizados».' : 'Aún no hay pedidos entregados ni cancelados.'}</td></tr>`;
    return;
  }
  const opciones = ['pendiente','progreso','entregado','cancelado'];
  const etiquetas = { pendiente:'Pendiente', progreso:'En progreso', entregado:'Entregado', cancelado:'Cancelado' };
  tb.innerHTML = lista.map(c=>`
    <tr><td class="strong">${c.label}</td><td>${esc(c.cliente)}</td>
    <td>${esc(c.items.map(i=>`${i.nombre} x ${i.cantidad}`).join(', '))}</td>
    <td class="strong">${Q(c.total)}</td>
    <td><select class="estado-sel estado-${c.estado}" onchange="cambiarEstadoCarrito(${c.id}, this.value)" aria-label="Estado de ${c.label}">
      ${opciones.map(o=>`<option value="${o}" ${o===c.estado?'selected':''}>${etiquetas[o]}</option>`).join('')}
    </select></td><td>${c.fecha}</td></tr>
  `).join('');
}

/* ===================== MODO OSCURO ===================== */
function aplicarTema(tema){
  const oscuro = tema === 'oscuro';
  document.documentElement.setAttribute('data-theme', oscuro ? 'oscuro' : 'claro');
  document.querySelectorAll('.theme-btn').forEach(b=>{
    b.setAttribute('aria-pressed', oscuro ? 'true' : 'false');
    b.setAttribute('aria-label', oscuro ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro');
    b.title = oscuro ? 'Modo claro' : 'Modo oscuro';
  });
}
function alternarTema(){
  const nuevo = document.documentElement.getAttribute('data-theme') === 'oscuro' ? 'claro' : 'oscuro';
  try { localStorage.setItem('estudio3d-tema', nuevo); } catch(e) {}
  aplicarTema(nuevo);
}
document.addEventListener('DOMContentLoaded', () => {
  aplicarTema(document.documentElement.getAttribute('data-theme') === 'oscuro' ? 'oscuro' : 'claro');
});


/* ===================== DETALLE DE PRODUCTO (carrusel) ===================== */
let modalProd = null;   // { id, idx, color }

function abrirProducto(id){
  const p = state.productos.find(x=>x.id===id);
  const back = document.getElementById('prod-modal');
  if(!p || !back) return;
  const cols = coloresProducto(p);
  const primero = cols.find(c=>c.piezas>0);
  modalProd = { id, idx:0, color: primero ? primero.color : (p.color || '') };
  back.hidden = false;
  document.body.classList.add('sin-scroll');
  pintarModalProducto();
  const cerrar = document.getElementById('pm-cerrar');
  if(cerrar) cerrar.focus();
}
function cerrarProducto(){
  const back = document.getElementById('prod-modal');
  if(back) back.hidden = true;
  document.body.classList.remove('sin-scroll');
  modalProd = null;
}

function pintarModalProducto(){
  if(!modalProd) return;
  const p = state.productos.find(x=>x.id===modalProd.id);
  if(!p) return cerrarProducto();
  const fotos = p.imagenes.length ? p.imagenes : [];
  const n = fotos.length;
  modalProd.idx = n ? ((modalProd.idx % n) + n) % n : 0;

  const vis = document.getElementById('pm-visor');
  if(vis){
    vis.innerHTML = n
      ? `<img src="${esc(fotos[modalProd.idx])}" alt="${esc(p.nombre)} · foto ${modalProd.idx+1} de ${n}">`
      : '<span class="prod-img-vacia" aria-hidden="true"></span>';
  }
  const prev = document.getElementById('pm-prev'), next = document.getElementById('pm-next');
  if(prev) prev.hidden = n < 2;
  if(next) next.hidden = n < 2;
  const cont = document.getElementById('pm-contador');
  if(cont){ cont.hidden = n < 2; cont.textContent = `${modalProd.idx+1} / ${n}`; }
  const mini = document.getElementById('pm-miniaturas');
  if(mini){
    mini.hidden = n < 2;
    mini.innerHTML = fotos.map((u,i)=>`<button type="button" class="pm-mini ${i===modalProd.idx?'activa':''}" onclick="irAFoto(${i})" aria-label="Ver foto ${i+1}"><img src="${esc(u)}" alt=""></button>`).join('');
  }

  document.getElementById('pm-nombre').textContent = p.nombre;
  document.getElementById('pm-precio').textContent = Q(p.precio);
  document.getElementById('pm-desc').textContent = p.desc || 'Sin descripción.';

  const cols = coloresProducto(p);
  const zona = document.getElementById('pm-colores');
  zona.innerHTML = cols.length
    ? cols.map(c=>`<button type="button" class="color-opt ${mismoTexto(c.color, modalProd.color)?'activa':''}" ${c.piezas>0?'':'disabled'} onclick="elegirColorModal('${esc(c.color).replace(/'/g,"&#39;")}')" aria-pressed="${mismoTexto(c.color, modalProd.color)}">
        <span class="color-dot" style="background:${colorCSS(c.color)}"></span>${esc(c.color)}${c.piezas>0?'':' · agotado'}</button>`).join('')
    : '<span class="small-note">Sin colores disponibles por ahora.</span>';

  const max = modalProd.color ? maxAgregable(p, modalProd.color) : 0;
  const input = document.getElementById('pm-cant');
  input.max = Math.max(1, max);
  if((parseInt(input.value)||1) > max) input.value = Math.max(1, max);
  const enCarrito = state.carrito.filter(l=>l.tipo==='producto' && l.ref===p.id && mismoTexto(l.color, modalProd.color)).reduce((a,l)=>a+l.cantidad,0);
  document.getElementById('pm-stock').textContent = max > 0
    ? `${max} disponible(s) en ${modalProd.color}${enCarrito ? ` · ya tienes ${enCarrito} en el carrito` : ''}`
    : (enCarrito ? `Ya agregaste todas las disponibles en ${modalProd.color}` : 'Agotado en este color');
  document.getElementById('pm-material').textContent = p.material ? `Material: ${p.material}` : '';
  document.getElementById('pm-agregar').disabled = max < 1;
  document.querySelector('#prod-modal .stepper').classList.toggle('deshabilitado', max < 1);
  actualizarTotalModal();
}
function actualizarTotalModal(){
  if(!modalProd) return;
  const p = state.productos.find(x=>x.id===modalProd.id);
  const n = Math.max(1, parseInt(document.getElementById('pm-cant').value) || 1);
  document.getElementById('pm-total').textContent = p ? `Total: ${Q(p.precio * n)}` : '';
}
function irAFoto(i){ if(modalProd){ modalProd.idx = i; pintarModalProducto(); } }
function moverFoto(d){ if(modalProd){ modalProd.idx += d; pintarModalProducto(); } }
function elegirColorModal(color){ if(modalProd){ modalProd.color = color; pintarModalProducto(); } }
function agregarDesdeModal(){
  if(!modalProd) return;
  const n = document.getElementById('pm-cant').value;
  if(agregarProductoAlCarrito(modalProd.id, n, modalProd.color)){
    document.getElementById('pm-cant').value = 1;
    cerrarProducto();
  }
}

// Teclado (Esc cierra, flechas cambian de foto) y deslizar con el dedo
document.addEventListener('keydown', e => {
  if(!modalProd) return;
  if(e.key === 'Escape') cerrarProducto();
  else if(e.key === 'ArrowLeft') moverFoto(-1);
  else if(e.key === 'ArrowRight') moverFoto(1);
});
(function(){
  let x0 = null;
  document.addEventListener('pointerdown', e => { if(e.target.closest && e.target.closest('#pm-visor')) x0 = e.clientX; });
  document.addEventListener('pointerup', e => {
    if(x0 === null) return;
    const dx = e.clientX - x0; x0 = null;
    if(Math.abs(dx) > 40) moverFoto(dx < 0 ? 1 : -1);
  });
})();

document.addEventListener('keydown', e => { if(e.key === 'Escape' && productoFotoId !== null) cerrarGestorFotos(); });
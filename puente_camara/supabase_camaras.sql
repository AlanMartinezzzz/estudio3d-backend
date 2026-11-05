-- Ejecutar UNA vez en Supabase > SQL Editor.

-- 1) Cada cámara apunta a la pieza (archivo) que está imprimiendo.
alter table public.camaras
  add column if not exists id_archivo bigint references public.archivos(id_archivo) on delete set null;

-- 2) Un cliente puede LEER una cámara solo si puede ver la pieza asignada.
--    La subconsulta respeta las reglas RLS que ya tiene "archivos",
--    así que cada cliente solo encuentra la cámara de SUS piezas.
--    (El negocio sigue viendo todas por la regla que ya tenga.)
drop policy if exists "cliente ve la camara de su pieza" on public.camaras;
create policy "cliente ve la camara de su pieza"
  on public.camaras for select
  to authenticated
  using (
    id_archivo is not null
    and exists (select 1 from public.archivos a where a.id_archivo = camaras.id_archivo)
  );

-- IMPORTANTE: revisa en Authentication > Policies que "camaras" NO tenga una regla
-- de UPDATE/INSERT/DELETE abierta a cualquier usuario: solo el negocio debe poder
-- cambiar a qué pieza apunta una cámara.

-- 3) COMPRUEBA que "camaras" tenga RLS encendido:
--      select relrowsecurity from pg_class where relname = 'camaras';
--    Si sale "false", hoy CUALQUIER usuario puede leer todas las cámaras.
--    En ese caso ejecuta también esto (da al negocio acceso total y enciende RLS):
--
--    create policy "negocio maneja camaras" on public.camaras for all to authenticated
--      using (exists (select 1 from public.negocio n where n.auth_id = auth.uid()))
--      with check (exists (select 1 from public.negocio n where n.auth_id = auth.uid()));
--    alter table public.camaras enable row level security;

-- =====================================================================
-- Inventario Hachiko · Fase 1 · Storage
-- Bucket PRIVADO `product-images`: solo usuarios autenticados suben y leen.
-- La app guarda la ruta del archivo en products.image_url y genera URLs
-- firmadas (temporales) para mostrarlas o exportarlas.
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy "product-images: authenticated puede leer"
  on storage.objects for select to authenticated
  using (bucket_id = 'product-images');

create policy "product-images: authenticated puede subir"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'product-images');

-- Remove thin spikes and slivers left on coastal barangay outlines (morphological opening, 35 m) and keep only parts over 3 ha.
update public.barangays b set boundary = coalesce((
  select extensions.st_multi(extensions.st_collect(extensions.st_makepolygon(extensions.st_exteriorring(d.geom))))
  from extensions.st_dump(extensions.st_transform(extensions.st_buffer(extensions.st_buffer(extensions.st_transform(b.boundary, 32651), -35, 'join=mitre mitre_limit=2'), 35, 'join=mitre mitre_limit=2'), 4326)) d
  where extensions.st_geometrytype(d.geom) = 'ST_Polygon' and extensions.st_area(extensions.st_transform(d.geom, 32651)) > 30000
), b.boundary);

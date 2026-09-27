-- Raising the project cap must not broaden existing image bucket limits.
update storage.buckets
set file_size_limit = 52428800
where id <> 'guide-videos' and file_size_limit is null;

update storage.buckets
set file_size_limit = 100000000
where id = 'guide-videos';

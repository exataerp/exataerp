-- Eventos produtivos sao evidencia historica e nunca podem desaparecer por
-- exclusao em cascata de apontamento ou empresa.

begin;

set local lock_timeout = '3s';
set local statement_timeout = '120s';

alter table public.production_order_events
  drop constraint if exists production_order_events_apontamento_id_fkey;
alter table public.production_order_events
  add constraint production_order_events_apontamento_id_fkey
  foreign key (apontamento_id) references public.apontamentos(id)
  on delete restrict;

alter table public.production_order_events
  drop constraint if exists production_order_events_tenant_id_fkey;
alter table public.production_order_events
  add constraint production_order_events_tenant_id_fkey
  foreign key (tenant_id) references public.empresas(id)
  on delete restrict;

commit;
